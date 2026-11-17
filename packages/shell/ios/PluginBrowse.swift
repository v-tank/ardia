import ArdiaCore
import Foundation

final class PluginBrowse {
  static let outputLimit = 64 * 1024
  static let errorLimit = 4 * 1024
  static let killGrace: TimeInterval = 2
  private static let queue = DispatchQueue(label: "ardia.plugins.browse", qos: .userInitiated)

  private let lock = NSLock()
  private var output = Data()
  private var errors = Data()
  private var truncated = false

  static func cliPath() -> String? {
    guard let home = CliInstaller.home else { return nil }
    let path = home.appendingPathComponent("current/bin/ardia").path
    return FileManager.default.isExecutableFile(atPath: path) ? path : nil
  }

  static func environment(dataDirectory: String) -> [String: String] {
    let home = LaunchConfig.shared.isolated ? CliInstaller.home?.appendingPathComponent("home", isDirectory: true).path : NSHomeDirectory()
    if let home { try? FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true) }
    return [
      "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": home ?? NSHomeDirectory(), "TMPDIR": NSTemporaryDirectory(), "LANG": "en_US.UTF-8",
      "ARDIA_DATA_DIR": dataDirectory, "ARDIA_TELEMETRY": "0", "NO_COLOR": "1",
    ]
  }

  private func take(_ data: Data, error: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if error {
      errors.append(data.prefix(max(0, Self.errorLimit - errors.count)))
      return
    }
    let room = max(0, Self.outputLimit - output.count)
    if data.count > room { truncated = true }
    output.append(data.prefix(room))
  }

  private func drain(_ pipe: Pipe, error: Bool) {
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        return
      }
      self?.take(data, error: error)
    }
  }

  static func run(session: String, argv: [String], timeoutMs: Int, done: @escaping ([String: Any]) -> Void) {
    queue.async {
      guard let cli = cliPath() else { return done(["ok": false, "missing": true]) }
      guard let folders = PluginFolders.current() else { return done(["ok": false, "reason": "Ardia has no data folder"]) }
      PluginBrowse().launch(cli: cli, dataDirectory: folders.appData, session: session, argv: argv, timeoutMs: timeoutMs, done: done)
    }
  }

  private func launch(cli: String, dataDirectory: String, session: String, argv: [String], timeoutMs: Int, done: @escaping ([String: Any]) -> Void) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: cli)
    process.arguments = ["browse", "--session", session] + argv
    process.environment = Self.environment(dataDirectory: dataDirectory)
    process.currentDirectoryURL = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    process.standardInput = FileHandle.nullDevice
    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    drain(out, error: false)
    drain(err, error: true)
    var timedOut = false
    let timer = DispatchSource.makeTimerSource(queue: Self.queue)
    timer.schedule(deadline: .now() + .milliseconds(max(1000, timeoutMs)))
    timer.setEventHandler {
      guard process.isRunning else { return }
      timedOut = true
      process.terminate()
      let pid = process.processIdentifier
      Self.queue.asyncAfter(deadline: .now() + Self.killGrace) { if process.isRunning { kill(pid, SIGKILL) } }
    }
    process.terminationHandler = { [self] finished in
      timer.cancel()
      out.fileHandleForReading.readabilityHandler = nil
      err.fileHandleForReading.readabilityHandler = nil
      take(out.fileHandleForReading.readDataToEndOfFile(), error: false)
      take(err.fileHandleForReading.readDataToEndOfFile(), error: true)
      Self.queue.async { [self] in
        lock.lock()
        let reply: [String: Any] = [
          "ok": true, "status": Int(finished.terminationStatus), "timedOut": timedOut, "truncated": truncated,
          "stdout": String(decoding: output, as: UTF8.self), "stderr": String(decoding: errors, as: UTF8.self),
        ]
        lock.unlock()
        done(reply)
      }
    }
    do {
      try process.run()
      timer.resume()
    } catch {
      timer.cancel()
      done(["ok": false, "reason": "the ardia command couldn't start (\(error.localizedDescription))"])
    }
  }
}

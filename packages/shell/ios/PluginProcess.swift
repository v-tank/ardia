import Darwin
import Foundation

final class PluginProcess {
  static let channelFd: Int32 = 3
  static let memoryCheckInterval: TimeInterval = 10
  static let logLimit: off_t = 1 << 20

  let name: String
  let run: Int
  let pid: pid_t
  private let queue: DispatchQueue
  private let memoryLimit: UInt64
  private(set) var connection: ControlConnection?
  private var exitSource: DispatchSourceProcess?
  private var memoryTimer: DispatchSourceTimer?
  private var killTimer: DispatchWorkItem?
  private var stopWaiters: [() -> Void] = []
  private(set) var exited = false
  private var overMemory = false
  private var log: Int32

  struct Spec {
    let name: String
    let run: [String]
    let memoryMB: Int
    let network: Bool
  }

  enum Failure: Error {
    case refused(String)
    var reason: String {
      switch self {
      case .refused(let text): return text
      }
    }
  }

  private init(name: String, run: Int, pid: pid_t, queue: DispatchQueue, memoryLimit: UInt64, log: Int32) {
    self.log = log
    self.name = name
    self.run = run
    self.pid = pid
    self.queue = queue
    self.memoryLimit = memoryLimit
  }

  static func errnoText(_ code: Int32 = errno) -> String { String(cString: strerror(code)) }

  static func openLog(_ folder: String) -> Int32 {
    let path = (folder as NSString).appendingPathComponent("plugin.log")
    var info = stat()
    if lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size > logLimit {
      rename(path, path + ".1")
    }
    return open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC | O_NOFOLLOW, 0o600)
  }

  static func environment(name: String, data: String) -> [String] {
    [
      "PATH=" + PluginSandbox.searchPath.joined(separator: ":"),
      "HOME=" + (data as NSString).appendingPathComponent("home"),
      "TMPDIR=" + (data as NSString).appendingPathComponent("tmp") + "/",
      "LANG=en_US.UTF-8",
      "ARDIA_PLUGIN_NAME=" + name,
      "ARDIA_PLUGIN_FD=\(channelFd)",
      "ARDIA_PLUGIN_PROTOCOL=1",
    ]
  }

  static func spawn(
    _ spec: Spec, run: Int, folders: PluginFolders, queue: DispatchQueue,
    onLine: @escaping (PluginProcess, String) -> Void, onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void
  ) -> Result<PluginProcess, Failure> {
    guard let pluginFolder = folders.pluginFolder(spec.name) else { return .failure(.refused("its folder is missing")) }
    guard let data = folders.dataFolder(spec.name) else { return .failure(.refused("its data folder couldn't be made")) }
    guard let first = spec.run.first, let program = PluginSandbox.program(first, pluginFolder: pluginFolder) else {
      return .failure(.refused("\(spec.run.first ?? "") wasn't found"))
    }
    let sandbox = PluginSandbox(
      home: PluginSandbox.resolved(NSHomeDirectory()) ?? NSHomeDirectory(), appData: folders.appData, configFolder: folders.config,
      pluginFolder: pluginFolder, pluginData: data, program: program, network: spec.network)
    let sandboxArguments: [String]
    do {
      sandboxArguments = try sandbox.arguments()
    } catch PluginSandbox.Refusal.unsafe(let why) {
      return .failure(.refused(why))
    } catch {
      return .failure(.refused("its sandbox couldn't be set up"))
    }
    var pair: [Int32] = [-1, -1]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &pair) == 0 else { return .failure(.refused("no channel (\(errnoText()))")) }
    for fd in pair { _ = fcntl(fd, F_SETFD, FD_CLOEXEC) }
    var noSigPipe: Int32 = 1
    setsockopt(pair[0], SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
    _ = fcntl(pair[0], F_SETFL, fcntl(pair[0], F_GETFL) | O_NONBLOCK)
    let log = openLog(data)
    defer { Darwin.close(pair[1]) }
    guard log >= 0 else {
      Darwin.close(pair[0])
      return .failure(.refused("its log couldn't be opened (\(errnoText()))"))
    }
    var actions: posix_spawn_file_actions_t?
    var attributes: posix_spawnattr_t?
    posix_spawn_file_actions_init(&actions)
    posix_spawnattr_init(&attributes)
    defer {
      posix_spawn_file_actions_destroy(&actions)
      posix_spawnattr_destroy(&attributes)
    }
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_adddup2(&actions, log, 1)
    posix_spawn_file_actions_adddup2(&actions, log, 2)
    posix_spawn_file_actions_adddup2(&actions, pair[1], channelFd)
    posix_spawn_file_actions_addchdir_np(&actions, pluginFolder)
    var none = sigset_t()
    var all = sigset_t()
    sigemptyset(&none)
    sigfillset(&all)
    posix_spawnattr_setsigmask(&attributes, &none)
    posix_spawnattr_setsigdefault(&attributes, &all)
    posix_spawnattr_setpgroup(&attributes, 0)
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF))
    let argv = ["/usr/bin/sandbox-exec"] + sandboxArguments + [program] + spec.run.dropFirst()
    let env = environment(name: spec.name, data: data)
    var pid: pid_t = 0
    let result = withCStrings(argv) { cArgv in withCStrings(env) { cEnv in posix_spawn(&pid, "/usr/bin/sandbox-exec", &actions, &attributes, cArgv, cEnv) } }
    guard result == 0 else {
      Darwin.close(pair[0])
      Darwin.close(log)
      return .failure(.refused("it couldn't start (\(errnoText(result)))"))
    }
    let limit = UInt64(max(64, spec.memoryMB)) << 20
    let process = PluginProcess(name: spec.name, run: run, pid: pid, queue: queue, memoryLimit: limit, log: log)
    process.watch(channel: pair[0], onLine: onLine, onExit: onExit)
    return .success(process)
  }

  private static func withCStrings<T>(_ strings: [String], _ body: ([UnsafeMutablePointer<CChar>?]) -> T) -> T {
    let pointers = strings.map { strdup($0) } + [nil]
    defer { pointers.forEach { free($0) } }
    return body(pointers)
  }

  private func watch(channel: Int32, onLine: @escaping (PluginProcess, String) -> Void, onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void) {
    let connection = ControlConnection(
      id: run, fd: channel, queue: queue,
      onLine: { [weak self] _, line in
        guard let self else { return }
        onLine(self, line)
      },
      onClose: { _ in }, onWritten: { _ in })
    self.connection = connection
    connection.open()
    let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: queue)
    source.setEventHandler { [weak self] in self?.reap(onExit) }
    exitSource = source
    source.activate()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + Self.memoryCheckInterval, repeating: Self.memoryCheckInterval)
    timer.setEventHandler { [weak self] in self?.checkMemory() }
    memoryTimer = timer
    timer.activate()
    queue.async { [weak self] in self?.reapIfGone(onExit) }
  }

  private func reapIfGone(_ onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void) {
    var status: Int32 = 0
    if !exited, waitpid(pid, &status, WNOHANG) == pid { finish(status, onExit) }
  }

  private func reap(_ onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void) {
    guard !exited else { return }
    var status: Int32 = 0
    var got = waitpid(pid, &status, WNOHANG)
    while got < 0 && errno == EINTR { got = waitpid(pid, &status, WNOHANG) }
    if got == pid { finish(status, onExit) } else if got < 0 { finishUnknown(onExit) }
  }

  private func finishUnknown(_ onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void) {
    exited = true
    cleanUp()
    onExit(self, nil, nil, overMemory)
  }

  private func finish(_ status: Int32, _ onExit: @escaping (PluginProcess, Int32?, Int32?, Bool) -> Void) {
    exited = true
    kill(-pid, SIGKILL)
    cleanUp()
    let signaled = (status & 0x7f) != 0 && (status & 0x7f) != 0x7f
    onExit(self, signaled ? nil : (status >> 8) & 0xff, signaled ? status & 0x7f : nil, overMemory)
  }

  private func cleanUp() {
    exitSource?.cancel()
    exitSource = nil
    memoryTimer?.cancel()
    memoryTimer = nil
    killTimer?.cancel()
    killTimer = nil
    connection?.close()
    connection = nil
    if log >= 0 {
      Darwin.close(log)
      log = -1
    }
    let waiters = stopWaiters
    stopWaiters = []
    waiters.forEach { $0() }
  }

  private func capLog() {
    var info = stat()
    if log >= 0, fstat(log, &info) == 0, info.st_size > Self.logLimit * 2 { ftruncate(log, 0) }
  }

  private func checkMemory() {
    guard !exited else { return }
    capLog()
    var info = rusage_info_v4()
    let got = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
    }
    guard got == 0, info.ri_phys_footprint > memoryLimit else { return }
    overMemory = true
    kill(-pid, SIGKILL)
    kill(pid, SIGKILL)
  }

  func stop(graceMs: Int, done: @escaping () -> Void) {
    guard !exited else { return done() }
    stopWaiters.append(done)
    connection?.close()
    kill(-pid, SIGTERM)
    kill(pid, SIGTERM)
    guard killTimer == nil else { return }
    let item = DispatchWorkItem { [weak self] in
      guard let self, !self.exited else { return }
      kill(-self.pid, SIGKILL)
      kill(self.pid, SIGKILL)
    }
    killTimer = item
    queue.asyncAfter(deadline: .now() + .milliseconds(max(0, graceMs)), execute: item)
  }

  func killNow() {
    guard !exited else { return }
    kill(-pid, SIGKILL)
    kill(pid, SIGKILL)
  }

  func terminateForQuit(within seconds: TimeInterval) {
    guard !exited else { return }
    connection?.close()
    kill(-pid, SIGTERM)
    kill(pid, SIGTERM)
    let deadline = Date().addingTimeInterval(seconds)
    var status: Int32 = 0
    while Date() < deadline {
      if waitpid(pid, &status, WNOHANG) == pid {
        exited = true
        kill(-pid, SIGKILL)
        return
      }
      usleep(20_000)
    }
    kill(-pid, SIGKILL)
    kill(pid, SIGKILL)
  }
}

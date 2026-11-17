import Foundation
import UniformTypeIdentifiers
import WebKit

final class PluginSchemeHandler: NSObject, WKURLSchemeHandler {
  static let scheme = "ardia-plugin"
  static let maxFile = 10 << 20

  let plugin: String
  let policy: String?

  init(plugin: String, policy: String?) {
    self.plugin = plugin
    self.policy = policy
  }

  static func file(for url: URL, plugin: String) -> (folder: String, path: String)? {
    guard url.scheme == scheme, url.host == plugin, url.user == nil, url.port == nil else { return nil }
    let parts = url.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
    guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\0") }) else { return nil }
    guard let folder = PluginFolders.current()?.pluginFolder(plugin) else { return nil }
    return (folder, (folder as NSString).appendingPathComponent(parts.joined(separator: "/")))
  }

  static func openedPath(_ fd: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
    guard fcntl(fd, F_GETPATH, &buffer) == 0 else { return nil }
    return String(cString: buffer)
  }

  static func read(_ path: String, inside folder: String) -> Data? {
    let fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW)
    guard fd >= 0 else { return nil }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size <= maxFile else { return nil }
    guard let opened = openedPath(fd), PluginSandbox.isInside(opened, folder), opened != folder else { return nil }
    let data = FileHandle(fileDescriptor: fd, closeOnDealloc: false).readData(ofLength: maxFile + 1)
    return data.count <= maxFile ? data : nil
  }

  static func mimeType(_ path: String) -> String {
    let ext = (path as NSString).pathExtension.lowercased()
    if ext == "js" || ext == "mjs" { return "text/javascript" }
    return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
    guard let target = Self.file(for: url, plugin: plugin), let data = Self.read(target.path, inside: target.folder) else {
      let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
      task.didReceive(response)
      task.didReceive(Data("Not found".utf8))
      return task.didFinish()
    }
    var headers = ["Content-Type": Self.mimeType(target.path), "Content-Length": String(data.count), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"]
    if let policy { headers["Content-Security-Policy"] = policy }
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

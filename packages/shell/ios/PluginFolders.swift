import AppKit
import ArdiaCore
import Foundation

struct PluginFolders {
  static let maxPlugins = 64
  static let manifestName = "plugin.json"
  private static let namePattern = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9-]{0,39}$")

  let config: String
  let appData: String
  let pluginsLexical: String

  static func current() -> PluginFolders? {
    guard let marker = try? DocumentStore.url("plugins.json") else { return nil }
    let appData = marker.deletingLastPathComponent().path
    let config = LaunchConfig.shared.configDirectory
    return PluginFolders(
      config: PluginSandbox.resolved(config) ?? config, appData: PluginSandbox.resolved(appData) ?? appData,
      pluginsLexical: (config as NSString).appendingPathComponent("plugins"))
  }

  static func isName(_ name: String) -> Bool {
    namePattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
  }

  func pluginFolder(_ name: String) -> String? {
    guard Self.isName(name), let real = PluginSandbox.resolved((pluginsLexical as NSString).appendingPathComponent(name)) else { return nil }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: real, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
    return real
  }

  func dataRoot() -> String { (appData as NSString).appendingPathComponent("PluginData") }

  func dataFolder(_ name: String) -> String? {
    guard Self.isName(name) else { return nil }
    let folder = (dataRoot() as NSString).appendingPathComponent(name)
    for sub in ["home", "tmp"] {
      let path = (folder as NSString).appendingPathComponent(sub)
      do {
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      } catch {
        return nil
      }
    }
    var info = stat()
    guard lstat(folder, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR, info.st_uid == geteuid() else { return nil }
    return PluginSandbox.resolved(folder)
  }

  func list() -> [[String: Any]] {
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: pluginsLexical) else { return [] }
    return names.filter(Self.isName).sorted().prefix(Self.maxPlugins).map { name in
      let manifest = ((pluginsLexical as NSString).appendingPathComponent(name) as NSString).appendingPathComponent(Self.manifestName)
      var entry = ConfigFolder.readRegularFile(manifest)
      entry["name"] = name
      return entry
    }
  }

  func remove(_ name: String) -> String? {
    guard Self.isName(name) else { return "That isn't a plugin's name." }
    let link = (pluginsLexical as NSString).appendingPathComponent(name)
    var info = stat()
    if lstat(link, &info) == 0 {
      do {
        if LaunchConfig.shared.dataDirectory != nil {
          try FileManager.default.removeItem(atPath: link)
        } else {
          try FileManager.default.trashItem(at: URL(fileURLWithPath: link), resultingItemURL: nil)
        }
      } catch {
        return "Its folder couldn't be moved to the Trash (\(error.localizedDescription))."
      }
    }
    let data = (dataRoot() as NSString).appendingPathComponent(name)
    if lstat(data, &info) == 0 { try? FileManager.default.removeItem(atPath: data) }
    return nil
  }
}

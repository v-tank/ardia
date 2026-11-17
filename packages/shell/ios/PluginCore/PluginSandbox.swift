import Foundation

struct PluginSandbox {
  let home: String
  let appData: String
  let configFolder: String
  let pluginFolder: String
  let pluginData: String
  let program: String
  let network: Bool
  var grants: [Grant] = []

  struct Grant: Equatable {
    let path: String
    let link: String
    let write: Bool
  }

  static let protectedInHome = [
    ".config/ardia", "Library/Application Support/com.ardia.browser", "Library/Application Support/Ardia",
    "Library/Application Support/Google", "Library/Application Support/Chromium", "Library/Application Support/Arc", "Library/Application Support/Dia",
    "Library/Application Support/Comet", "Library/Application Support/BraveSoftware", "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Vivaldi", "Library/Application Support/com.operasoftware.Opera", "Library/Application Support/net.imput.helium",
    "Library/Application Support/Firefox", "Library/Application Support/zen", "Library/Application Support/Orion", "Library/Safari",
    "Library/Containers/com.apple.Safari", "Library/Cookies", "Library/Keychains",
  ]
  static let maxGrants = 16

  static let searchPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"]

  static let profile = """
    (version 1)
    (allow default)
    (deny appleevent-send)
    (deny file-read* file-write* (subpath (param "HOME")) (subpath (param "APP_DATA")) (subpath (param "CONFIG")))
    (deny file-write* (subpath "/"))
    (allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (subpath "/dev/fd"))
    (deny network-outbound (remote unix-socket (subpath (param "HOME"))) (remote unix-socket (subpath (param "APP_DATA"))))
    (allow file-read* (subpath (param "PLUGIN")) (literal (param "PROGRAM")) (subpath (param "INSTALL")))
    (allow file-read* file-write* (subpath (param "DATA")))
    (allow file-read-metadata (literal (param "HOME")))
    """

  static let offline = """

    (deny network-outbound (remote ip))
    (allow network-outbound (remote ip "localhost:*"))
    """

  enum Refusal: Error {
    case unsafe(String)
  }

  static func resolved(_ path: String) -> String? {
    guard let real = realpath(path, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
  }

  static func isInside(_ path: String, _ folder: String) -> Bool {
    path == folder || path.hasPrefix(folder.hasSuffix("/") ? folder : folder + "/")
  }

  static func overlaps(_ a: String, _ b: String) -> Bool { isInside(a, b) || isInside(b, a) }

  static func overlapsIgnoringCase(_ a: String, _ b: String) -> Bool { overlaps(a.lowercased(), b.lowercased()) }

  static func grant(_ given: String, write: Bool, home: String) -> Grant? {
    guard given.hasPrefix("~/"), !given.contains("\0") else { return nil }
    let parts = given.dropFirst(2).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    let trimmed = parts.last == "" ? Array(parts.dropLast()) : parts
    guard !trimmed.isEmpty, !trimmed.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return nil }
    let link = trimmed.reduce(home) { ($0 as NSString).appendingPathComponent($1) }
    var existing = link
    var missing: [String] = []
    while resolved(existing) == nil {
      guard isInside(existing, home), existing != home else { return nil }
      missing.insert((existing as NSString).lastPathComponent, at: 0)
      existing = (existing as NSString).deletingLastPathComponent
    }
    guard let base = resolved(existing) else { return nil }
    return Grant(path: missing.reduce(base) { ($0 as NSString).appendingPathComponent($1) }, link: link, write: write)
  }

  static func ancestors(of path: String, below home: String) -> [String] {
    var chain: [String] = []
    var current = (path as NSString).deletingLastPathComponent
    while isInside(current, home) && current != home {
      chain.append(current)
      current = (current as NSString).deletingLastPathComponent
    }
    return chain
  }

  static func program(_ first: String, pluginFolder: String) -> String? {
    if first.hasPrefix("/") { return resolved(first) }
    if first.contains("/") {
      guard let real = resolved((pluginFolder as NSString).appendingPathComponent(first)), isInside(real, pluginFolder) else { return nil }
      return real
    }
    for dir in searchPath {
      let candidate = (dir as NSString).appendingPathComponent(first)
      if FileManager.default.isExecutableFile(atPath: candidate) { return resolved(candidate) }
    }
    return nil
  }

  private var protected: [String] { [home, appData, configFolder] }

  func installFolder() -> String {
    let parent = (program as NSString).deletingLastPathComponent
    let folder = (parent as NSString).lastPathComponent == "bin" ? (parent as NSString).deletingLastPathComponent : parent
    if folder == "/" || folder.split(separator: "/").count < 2 || protected.contains(where: { Self.overlaps($0, folder) }) { return program }
    return folder
  }

  func checked() throws {
    for path in [pluginFolder, pluginData, program] where path.isEmpty || path.contains("\0") {
      throw Refusal.unsafe("a path the sandbox can't name")
    }
    let pluginsRoot = (configFolder as NSString).appendingPathComponent("plugins")
    let inPluginsRoot = Self.isInside(pluginFolder, pluginsRoot) && pluginFolder != pluginsRoot
    if pluginFolder == "/" || [home, configFolder, appData].contains(where: { Self.isInside($0, pluginFolder) }) {
      throw Refusal.unsafe("its folder takes in Ardia's data, its settings or your home folder")
    }
    if (Self.isInside(pluginFolder, configFolder) || Self.isInside(pluginFolder, appData)) && !inPluginsRoot {
      throw Refusal.unsafe("its folder is in Ardia's data or config folder")
    }
    if !Self.isInside(program, pluginFolder) && (Self.isInside(program, appData) || Self.isInside(program, configFolder)) {
      throw Refusal.unsafe("its program is in Ardia's data or config folder")
    }
    guard Self.isInside(pluginData, appData), !Self.isInside(appData, pluginData) else { throw Refusal.unsafe("its data folder is in the wrong place") }
    try checkGrants()
  }

  func checkGrants() throws {
    guard grants.count <= Self.maxGrants else { throw Refusal.unsafe("it asks for more than \(Self.maxGrants) folders") }
    let shielded = [appData, configFolder] + Self.protectedInHome.map { (home as NSString).appendingPathComponent($0) }.flatMap { [$0, Self.resolved($0)].compactMap { $0 } }
    for grant in grants {
      let shown = grant.link.replacingOccurrences(of: home, with: "~", options: .anchored)
      guard !grant.path.isEmpty, !grant.path.contains("\0"), Self.isInside(grant.path, home), Self.isInside(grant.link, home) else {
        throw Refusal.unsafe("\(shown) leads outside your home folder")
      }
      if grant.path.lowercased() == home.lowercased() || grant.link.lowercased() == home.lowercased() { throw Refusal.unsafe("\(shown) is your whole home folder") }
      if let clash = shielded.first(where: { Self.overlapsIgnoringCase(grant.path, $0) || Self.overlapsIgnoringCase(grant.link, $0) }) {
        throw Refusal.unsafe("\(shown) takes in \(clash.replacingOccurrences(of: home, with: "~", options: .anchored)), Ardia's own data or another browser's profiles")
      }
    }
  }

  func grantRules() -> (text: String, parameters: [String: String]) {
    var text = ""
    var parameters: [String: String] = [:]
    for (index, grant) in grants.enumerated() {
      let name = "GRANT_\(index)"
      parameters[name] = grant.path
      text += "\n(allow file-read* process-exec* (subpath (param \"\(name)\")))"
      if grant.write { text += "\n(allow file-write* (subpath (param \"\(name)\")))" }
      var chain = Self.ancestors(of: grant.path, below: home)
      if grant.link != grant.path { chain = [grant.link] + chain + Self.ancestors(of: grant.link, below: home) }
      for (step, folder) in Array(Set(chain)).sorted().enumerated() {
        let up = "\(name)_UP_\(step)"
        parameters[up] = folder
        text += "\n(allow file-read-metadata (literal (param \"\(up)\")))"
      }
    }
    return (text, parameters)
  }

  func arguments() throws -> [String] {
    try checked()
    let rules = grantRules()
    let parameters = [
      "HOME": home, "APP_DATA": appData, "CONFIG": configFolder, "PLUGIN": pluginFolder, "DATA": pluginData, "PROGRAM": program,
      "INSTALL": installFolder(),
    ].merging(rules.parameters) { first, _ in first }
    return ["-p", Self.profile + (network ? "" : Self.offline) + rules.text] + parameters.sorted { $0.key < $1.key }.flatMap { ["-D", "\($0.key)=\($0.value)"] }
  }
}

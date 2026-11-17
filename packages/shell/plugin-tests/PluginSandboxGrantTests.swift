import XCTest

@testable import ArdiaPluginCore

extension PluginSandboxTests {
  func granted(_ access: [(String, Bool)], appData: String? = nil, pluginData: String? = nil) throws -> PluginSandbox {
    var box = PluginSandbox(
      home: home, appData: appData ?? data, configFolder: config, pluginFolder: plugin, pluginData: pluginData ?? self.pluginData, program: "/bin/sh",
      network: false)
    for (path, write) in access {
      guard let grant = PluginSandbox.grant(path, write: write, home: home) else { throw PluginSandbox.Refusal.unsafe("\(path) isn't in the home folder") }
      box.grants.append(grant)
    }
    return box
  }

  func grantRefusal(_ access: [(String, Bool)], appData: String? = nil, pluginData: String? = nil) -> String? {
    do {
      try granted(access, appData: appData, pluginData: pluginData).checked()
      return nil
    } catch PluginSandbox.Refusal.unsafe(let why) {
      return why
    } catch {
      return "\(error)"
    }
  }

  func makeGrantedHome() throws {
    for folder in [".granted", ".writable", ".other", ".target", "Library/Application Support/Google/Default"] {
      try FileManager.default.createDirectory(atPath: "\(home)/\(folder)", withIntermediateDirectories: true)
    }
    for file in [".granted/secret.txt", ".other/secret.txt", ".target/secret.txt"] {
      try "secret".write(toFile: "\(home)/\(file)", atomically: true, encoding: .utf8)
    }
    try "#!/bin/sh\necho ran\n".write(toFile: "\(home)/.granted/tool.sh", atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: "\(home)/.granted/tool.sh")
    try FileManager.default.createSymbolicLink(atPath: "\(home)/.link", withDestinationPath: "\(home)/.target")
    try FileManager.default.createSymbolicLink(atPath: "\(home)/.sneaky", withDestinationPath: "\(home)/Library/Application Support/Google")
  }

  func testGrantsOpenOnlyTheirPathsToReadRunAndWrite() throws {
    try makeGrantedHome()
    let box = try granted([("~/.granted", false), ("~/.writable", true), ("~/.link", false)])
    XCTAssertFalse(try box.arguments()[1].contains(home), "granted paths go in as parameters too")
    XCTAssertEqual(try run(box, "cat '\(home)/.granted/secret.txt'"), 0, "reads a read grant")
    XCTAssertEqual(try run(box, "ls '\(home)/.granted'"), 0, "lists a read grant")
    XCTAssertEqual(try run(box, "'\(home)/.granted/tool.sh'"), 0, "runs a program under a read grant")
    XCTAssertEqual(try run(box, "cat '\(home)/.link/secret.txt'"), 0, "follows a granted link to its folder")
    XCTAssertEqual(try run(box, "echo hi > '\(home)/.writable/new.txt'"), 0, "writes a write grant")
    XCTAssertNotEqual(try run(box, "echo hi > '\(home)/.granted/new.txt'"), 0, "a read grant stays read-only")
    XCTAssertNotEqual(try run(box, "cat '\(home)/.other/secret.txt'"), 0, "a folder beside a grant stays unreadable")
    XCTAssertNotEqual(try run(box, "cat '\(home)/notes.txt'"), 0, "the rest of home stays unreadable")
    XCTAssertNotEqual(try run(box, "ls '\(home)'"), 0, "home can't be listed")
    XCTAssertNotEqual(try run(box, "cat '\(data)/plugins.json'"), 0, "Ardia's data stays unreadable")
    XCTAssertNotEqual(try run(sandbox(), "cat '\(home)/.granted/secret.txt'"), 0, "without the grant the same file is unreadable")
  }

  func testAGrantMayNameAFolderThatIsntMadeYet() throws {
    let box = try granted([("~/.later/sub", true)])
    XCTAssertNil(grantRefusal([("~/.later/sub", true)]))
    XCTAssertNotEqual(try run(box, "mkdir -p '\(home)/.later/sub' && echo hi > '\(home)/.later/sub/x'"), 0, "the folders above a grant aren't writable")
    try FileManager.default.createDirectory(atPath: "\(home)/.later/sub", withIntermediateDirectories: true)
    XCTAssertEqual(try run(box, "echo hi > '\(home)/.later/sub/x'"), 0)
  }

  func testGrantsThatAreOrTakeInHomeArdiaOrABrowsersProfilesAreRefused() throws {
    try makeGrantedHome()
    for path in ["~", "~/", "~/.", "~/a/../..", "/etc", "~//"] {
      XCTAssertThrowsError(try granted([(path, false)]), path)
    }
    for path in ["~/Library", "~/Library/Application Support", "~/library/application support/google/Default", "~/.sneaky", "~/.config", "~/Library/Keychains"] {
      XCTAssertNotNil(grantRefusal([(path, false)]), path)
    }
    let inside = "\(home)/Data"
    try FileManager.default.createDirectory(atPath: "\(inside)/PluginData/example", withIntermediateDirectories: true)
    XCTAssertNotNil(grantRefusal([("~/Data", false)], appData: inside, pluginData: "\(inside)/PluginData/example"), "Ardia's data folder")
    XCTAssertNotNil(grantRefusal([("~/Data/PluginData", true)], appData: inside, pluginData: "\(inside)/PluginData/example"), "inside Ardia's data folder")
    XCTAssertNotNil(grantRefusal(Array(repeating: ("~/.granted", false), count: PluginSandbox.maxGrants + 1)))
    try FileManager.default.createSymbolicLink(atPath: "\(home)/.out", withDestinationPath: root)
    XCTAssertNotNil(grantRefusal([("~/.out", false)]), "a link that leads outside home")
  }
}

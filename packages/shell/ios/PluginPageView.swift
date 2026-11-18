import AppKit
import ArdiaCore
import CryptoKit
import ExpoModulesCore
import WebKit

struct PluginGlassRegion: Equatable {
  static let limit = 32
  let id: String
  let frame: CGRect
  let radius: Double
  let panel: Bool
  let state: String

  static func parse(_ body: Any) -> [PluginGlassRegion]? {
    guard let doc = body as? [String: Any], let list = doc["regions"] as? [[String: Any]], list.count <= limit else { return nil }
    var out: [PluginGlassRegion] = []
    for item in list {
      guard let id = item["id"] as? String, id.count <= 64,
        let x = (item["x"] as? NSNumber)?.doubleValue, let y = (item["y"] as? NSNumber)?.doubleValue,
        let w = (item["width"] as? NSNumber)?.doubleValue, let h = (item["height"] as? NSNumber)?.doubleValue,
        [x, y, w, h].allSatisfy({ $0.isFinite && abs($0) < 100_000 }), w > 0, h > 0
      else { return nil }
      let radius = min(max((item["radius"] as? NSNumber)?.doubleValue ?? 0, 0), min(w, h) / 2)
      let state = ["rest", "lit", "active"].contains(item["state"] as? String ?? "") ? item["state"] as! String : "rest"
      out.append(PluginGlassRegion(id: id, frame: CGRect(x: x, y: y, width: w, height: h), radius: radius.isFinite ? radius : 0, panel: item["kind"] as? String == "panel", state: state))
    }
    return out
  }
}

final class PluginGlassMessages: NSObject, WKScriptMessageHandler {
  weak var session: PluginPageSession?
  init(_ session: PluginPageSession) { self.session = session }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let session, message.frameInfo.isMainFrame, message.webView === session.web, let url = session.web.url, session.isAllowed(url),
      let regions = PluginGlassRegion.parse(message.body)
    else { return }
    session.glass = regions
    session.view?.placeGlass()
  }
}

final class PluginPageSession: NSObject, WKNavigationDelegate, WKUIDelegate {
  let plugin: String
  let network: Bool
  let web: WKWebView
  weak var view: PluginPageView?
  var parkedAt = Date.distantPast
  var glass: [PluginGlassRegion] = []
  private var allowedOrigin: (scheme: String, host: String, port: Int?)?
  private var watches: [NSKeyValueObservation] = []

  init(plugin: String, network: Bool) {
    self.plugin = plugin
    self.network = network
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: PluginPageView.storeIdentifier(plugin))
    configuration.setURLSchemeHandler(PluginSchemeHandler(plugin: plugin, policy: network ? nil : PluginPageView.offlinePolicy), forURLScheme: PluginSchemeHandler.scheme)
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    web = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    if LaunchConfig.shared.background && !LaunchConfig.shared.instanceFlag("allowOcclusion") { Self.call(web, "_setWindowOcclusionDetectionEnabled:", false) }
    Self.stopRubberBanding(web)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    web.configuration.userContentController.add(PluginGlassMessages(self), name: PluginPageView.glassMessage)
    watches = [
      web.observe(\.title, options: [.new]) { [weak self] _, _ in self?.sendTitle() },
      web.observe(\.url, options: [.new]) { [weak self] _, _ in self?.sendNavigation() },
      web.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.sendNavigation() },
      web.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.sendNavigation() },
    ]
  }

  private static func call(_ web: WKWebView, _ selector: String, _ value: Bool) {
    let sel = NSSelectorFromString(selector)
    guard web.responds(to: sel) else { return NSLog("[plugins] page view can't \(selector)") }
    typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
    unsafeBitCast(web.method(for: sel), to: Setter.self)(web, sel, value)
  }

  private static func stopRubberBanding(_ web: WKWebView) {
    let sel = NSSelectorFromString("_setRubberBandingEnabled:")
    guard web.responds(to: sel) else { return NSLog("[plugins] page view rubber-banding can't be turned off") }
    typealias Setter = @convention(c) (AnyObject, Selector, UInt) -> Void
    unsafeBitCast(web.method(for: sel), to: Setter.self)(web, sel, 0)
  }

  func close() {
    watches = []
    web.configuration.userContentController.removeScriptMessageHandler(forName: PluginPageView.glassMessage)
    web.stopLoading()
    web.navigationDelegate = nil
    web.uiDelegate = nil
    web.removeFromSuperview()
  }

  static func origin(of url: URL) -> (scheme: String, host: String, port: Int?)? {
    guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
    return (scheme, host, url.port)
  }

  func isAllowed(_ target: URL) -> Bool {
    guard let mine = allowedOrigin, let theirs = Self.origin(of: target) else { return false }
    return mine.scheme == theirs.scheme && mine.host == theirs.host && mine.port == theirs.port
  }

  private static func place(_ url: URL) -> String {
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
    parts.fragment = nil
    parts.queryItems = parts.queryItems?.filter { $0.name != "ardiaContext" }
    if parts.queryItems?.isEmpty == true { parts.queryItems = nil }
    return parts.string ?? url.absoluteString
  }

  func load(_ url: String) {
    guard let target = URL(string: url), let origin = Self.origin(of: target) else { return }
    let isPage = origin.scheme == PluginSchemeHandler.scheme && origin.host == plugin
    let isLoopback = origin.scheme == "http" && ["127.0.0.1", "localhost", "::1", "[::1]"].contains(origin.host) && origin.port != nil
    guard isPage || isLoopback else { return }
    let sameOrigin = isAllowed(target)
    allowedOrigin = origin
    if sameOrigin, let shown = web.url, Self.place(shown) == Self.place(target) { return }
    web.load(URLRequest(url: target))
  }

  func go(_ action: String) {
    switch action {
    case "back": web.goBack()
    case "forward": web.goForward()
    case "reload": web.reload()
    default: break
    }
  }

  func sendTitle() {
    guard let view, let title = web.title, !title.isEmpty, web.url.map(isAllowed) == true else { return }
    view.onTitle(["title": String(title.prefix(200))])
  }

  func sendNavigation() {
    guard let view, let url = web.url, isAllowed(url) else { return }
    var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    parts?.fragment = nil
    view.onNavigate([
      "path": String((parts?.percentEncodedPath ?? "/").prefix(1024)),
      "query": String((parts?.percentEncodedQuery ?? "").prefix(1024)),
      "canGoBack": web.canGoBack,
      "canGoForward": web.canGoForward,
    ])
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let target = action.request.url else { return decisionHandler(.cancel) }
    if isAllowed(target) && action.targetFrame != nil { return decisionHandler(.allow) }
    if target.scheme == "about" && action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
    if action.navigationType == .linkActivated, let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" {
      view?.onOpenUrl(["url": target.absoluteString])
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    view?.onLoaded(["url": webView.url?.absoluteString ?? "", "title": webView.title ?? ""])
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if action.navigationType == .linkActivated, let target = action.request.url, let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" {
      view?.onOpenUrl(["url": target.absoluteString])
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }
}

final class PluginPageView: ExpoView {
  static var live: [String: PluginPageView] = [:]
  static var byTab: [String: PluginPageView] = [:]
  private static var parked: [String: PluginPageSession] = [:]
  static let parkedLimit = 12
  static let glassMessage = "ardiaGlass"

  let onOpenUrl = EventDispatcher()
  let onLoaded = EventDispatcher()
  let onTitle = EventDispatcher()
  let onNavigate = EventDispatcher()

  var plugin = "" { didSet { if plugin != oldValue { needsSync() } } }
  var url = "" { didSet { if url != oldValue { needsSync() } } }
  var network = false { didSet { if network != oldValue { needsSync() } } }
  var tabKey = "" { didSet { if tabKey != oldValue { needsSync() } } }
  var look: [String: String] = [:] { didSet { if look != oldValue { applyLook() } } }
  var colorScheme = "" { didSet { if colorScheme != oldValue { applyLook() } } }
  var glassTints: [String: String] = [:] { didSet { if glassTints != oldValue { restyleGlass() } } }
  private var glassViews: [String: NSView] = [:]

  static let offlinePolicy =
    "default-src 'self' ardia-plugin: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ardia-plugin: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; form-action 'self'; worker-src 'none'"

  static func offlineScript() -> WKUserScript {
    let source = """
      (() => { if (location.protocol === "ardia-plugin:") return; const m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy"; m.content = \(String(reflecting: offlinePolicy)); (document.head || document.documentElement || document).prepend(m); })();
      """
    return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
  }

  static func lookSource(_ vars: [String: String], appearance: String) -> String {
    let pairs = vars.filter { $0.key.hasPrefix("--ardia-") && $0.key.count <= 64 && $0.value.count <= 512 }
    let mode = appearance == "dark" || appearance == "light" ? appearance : ""
    guard let json = try? JSONSerialization.data(withJSONObject: ["vars": pairs, "appearance": mode], options: [.sortedKeys]),
      let text = String(data: json, encoding: .utf8)
    else { return "" }
    return "(() => { const look = \(text); const apply = () => { const root = document.documentElement; if (!root) return false; "
      + "for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v); "
      + "if (look.appearance) { root.dataset.ardiaAppearance = look.appearance; root.style.colorScheme = look.appearance; } "
      + "else { delete root.dataset.ardiaAppearance; root.style.removeProperty(\"color-scheme\"); } return true; }; "
      + "if (!apply()) document.addEventListener(\"readystatechange\", apply, { once: true }); })();"
  }

  private var session: PluginPageSession?
  private var syncQueued = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  static func storeIdentifier(_ plugin: String) -> UUID {
    let scope = LaunchConfig.shared.dataDirectory ?? ""
    var bytes = Array(SHA256.hash(data: Data("ardia.plugin-page|\(scope)|\(plugin)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return bytes.withUnsafeBufferPointer { NSUUID(uuidBytes: $0.baseAddress!) as UUID }
  }

  static func removeData(_ plugin: String, done: @escaping () -> Void) {
    releasePlugin(plugin)
    WKWebsiteDataStore.remove(forIdentifier: storeIdentifier(plugin)) { _ in done() }
  }

  static func release(tab key: String) {
    parked.removeValue(forKey: key)?.close()
  }

  static func releasePlugin(_ plugin: String) {
    for (key, session) in parked where session.plugin == plugin {
      session.close()
      parked.removeValue(forKey: key)
    }
  }

  static func go(tab key: String, _ action: String) -> Bool {
    guard let view = byTab[key], let session = view.session else { return false }
    session.go(action)
    return true
  }

  private func needsSync() {
    guard !syncQueued else { return }
    syncQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.syncQueued = false
      self.sync()
    }
  }

  private func sync() {
    guard superview != nil, PluginFolders.isName(plugin) else { return }
    if let current = session, current.plugin != plugin || current.network != network {
      detach(keep: false)
    }
    if session == nil { attach() }
    session?.load(url)
  }

  private func attach() {
    let adopted = tabKey.isEmpty ? nil : Self.parked.removeValue(forKey: tabKey)
    let reuse = adopted.flatMap { $0.plugin == plugin && $0.network == network ? $0 : nil }
    if let adopted, reuse == nil { adopted.close() }
    let next = reuse ?? PluginPageSession(plugin: plugin, network: network)
    next.view = self
    next.web.frame = bounds
    addSubview(next.web)
    session = next
    Self.live[plugin] = self
    if !tabKey.isEmpty { Self.byTab[tabKey] = self }
    applyLook()
    placeGlass()
    if reuse != nil {
      next.sendTitle()
      next.sendNavigation()
    }
  }

  private func detach(keep: Bool) {
    guard let current = session else { return }
    session = nil
    current.view = nil
    current.web.removeFromSuperview()
    clearGlass()
    if Self.live[current.plugin] === self { Self.live[current.plugin] = nil }
    if !tabKey.isEmpty, Self.byTab[tabKey] === self { Self.byTab[tabKey] = nil }
    guard keep, !tabKey.isEmpty else { return current.close() }
    Self.parked.removeValue(forKey: tabKey)?.close()
    current.parkedAt = Date()
    Self.parked[tabKey] = current
    while Self.parked.count > Self.parkedLimit, let oldest = Self.parked.min(by: { $0.value.parkedAt < $1.value.parkedAt }) {
      oldest.value.close()
      Self.parked.removeValue(forKey: oldest.key)
    }
  }

  func placeGlass() {
    guard #available(macOS 26.0, *), LiquidGlass.available, let current = session else { return clearGlass() }
    let wanted = Set(current.glass.map(\.id))
    for (id, view) in glassViews where !wanted.contains(id) {
      view.removeFromSuperview()
      glassViews.removeValue(forKey: id)
    }
    for region in current.glass {
      let view = (glassViews[region.id] as? NSGlassEffectView) ?? NSGlassEffectView()
      if glassViews[region.id] == nil {
        glassViews[region.id] = view
        addSubview(view, positioned: .below, relativeTo: current.web)
      }
      let y = isFlipped ? region.frame.minY : bounds.height - region.frame.maxY
      view.frame = CGRect(x: region.frame.minX, y: y, width: region.frame.width, height: region.frame.height)
      style(view, region)
    }
  }

  @available(macOS 26.0, *)
  private func style(_ view: NSGlassEffectView, _ region: PluginGlassRegion) {
    let key = region.panel ? "panel" : "control-\(region.state)"
    LiquidGlass.apply(view, cornerRadius: region.radius, tint: glassTints[key].flatMap { RGBA(hex: $0)?.srgb }, clear: !region.panel)
    view.alphaValue = region.panel ? 1 : CGFloat(Double(glassTints["controlStrength"] ?? "") ?? 0.5)
    view.appearance = colorScheme == "dark" ? NSAppearance(named: .darkAqua) : colorScheme == "light" ? NSAppearance(named: .aqua) : nil
  }

  private func restyleGlass() {
    guard #available(macOS 26.0, *), let current = session else { return }
    for region in current.glass { if let view = glassViews[region.id] as? NSGlassEffectView { style(view, region) } }
  }

  private func clearGlass() {
    for view in glassViews.values { view.removeFromSuperview() }
    glassViews = [:]
  }

  private func applyLook() {
    guard let web = session?.web else { return }
    web.appearance = colorScheme == "dark" ? NSAppearance(named: .darkAqua) : colorScheme == "light" ? NSAppearance(named: .aqua) : nil
    let controller = web.configuration.userContentController
    controller.removeAllUserScripts()
    if !network { controller.addUserScript(Self.offlineScript()) }
    let source = Self.lookSource(look, appearance: colorScheme)
    guard !source.isEmpty else { return }
    controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web.evaluateJavaScript(source, completionHandler: nil)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    session?.web.frame = bounds
    placeGlass()
  }

  override func viewDidMoveToSuperview() {
    super.viewDidMoveToSuperview()
    if superview != nil { needsSync() }
  }

  override func removeFromSuperview() {
    detach(keep: true)
    super.removeFromSuperview()
  }

  func snapshot(to path: String, done: @escaping (Bool) -> Void) {
    guard let web = session?.web else { return done(false) }
    web.takeSnapshot(with: nil) { image, _ in
      guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
        return done(false)
      }
      done((try? png.write(to: URL(fileURLWithPath: path))) != nil)
    }
  }
}

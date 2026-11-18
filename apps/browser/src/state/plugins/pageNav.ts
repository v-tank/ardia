import { goPluginPage, releasePluginPage } from "../../platform/plugins";
import { useBrowser } from "../browser/store";
import { updateLive, updateTab } from "../tabs/actions";
import { isPagePath, pluginPageOf, pluginPageUrl } from "./pageNames";

export type PageNavigation = { path: string; query: string; canGoBack: boolean; canGoForward: boolean };

const HOST_PARAMS = new Set(["ardiaContext"]);

export function pageAddress(name: string, nav: Pick<PageNavigation, "path" | "query">): string | null {
  const params = new URLSearchParams(nav.query);
  for (const key of HOST_PARAMS) params.delete(key);
  const query = params.toString();
  const path = `${nav.path === "/" ? "" : nav.path}${query ? `?${query}` : ""}`;
  return isPagePath(path) ? pluginPageUrl(name, path) : null;
}

export function followPage(tabId: string, name: string, nav: PageNavigation) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab || pluginPageOf(tab.url) !== name) return;
  const address = pageAddress(name, nav);
  if (address && address !== tab.url) updateTab(tabId, { url: address });
  const live = useBrowser.getState().live[tabId];
  if (live?.canGoBack !== nav.canGoBack || live?.canGoForward !== nav.canGoForward) updateLive(tabId, { canGoBack: nav.canGoBack, canGoForward: nav.canGoForward });
}

export function goInPage(tabId: string, action: "back" | "forward"): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  if (!tab || !pluginPageOf(tab.url)) return false;
  if (action === "back" ? !live?.canGoBack : !live?.canGoForward) return false;
  void goPluginPage(tabId, action);
  return true;
}

let watching = false;

export function watchPluginPageTabs() {
  if (watching) return;
  watching = true;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id in prev.tabs) if (!s.tabs[id] && pluginPageOf(prev.tabs[id]!.url)) releasePluginPage(id);
  });
}

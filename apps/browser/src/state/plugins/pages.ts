import { create } from "zustand";
import type { PageSide } from "../../lib/pluginManifest";
import { minimizedUrl, webUrl } from "../../lib/urlParts";
import { openUrls } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { activeTabId, viewTabIds } from "../browser/model";
import { openSplitPane } from "../splits/actions";
import { notePlugin } from "../telemetry/pluginCounts";
import { isPagePath, pluginPageOf, pluginPagePath, pluginPageUrl } from "./pageNames";
import { activeManifest, currentPlugins, type PluginsStore } from "./store";

export { isPagePath, pluginPageOf, pluginPagePath, pluginPageUrl };

export type PageContext = { tabId: string; url: string; title: string };

export const usePluginPages = create<{ contexts: Record<string, PageContext> }>()(() => ({ contexts: {} }));


function withParam(url: string, key: string, value: string): string {
  const cut = url.indexOf("#");
  const [head, fragment] = cut < 0 ? [url, ""] : [url.slice(0, cut), url.slice(cut)];
  return `${head}${head.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${fragment}`;
}

function servedAt(served: string, path: string): string {
  if (!path) return served;
  const origin = /^http:\/\/[^/?#]+/.exec(served)?.[0] ?? served;
  const cut = served.indexOf("#");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}${cut < 0 ? "" : served.slice(cut)}`;
}

export function pageViewUrl(s: Pick<PluginsStore, "listings" | "records" | "servedUrls">, name: string, context: PageContext | null, path = ""): string | null {
  const page = activeManifest(s, name)?.page;
  if (!page || !isPagePath(path)) return null;
  const file = "file" in page.source ? `ardia-plugin://${name}/${page.source.file.split("/").map(encodeURIComponent).join("/")}` : null;
  const served = file ? null : (s.servedUrls[name] ?? null);
  let url = file ? (path ? withParam(file, "ardiaPath", path) : file) : served ? servedAt(served, path) : null;
  if (url && context) url = withParam(url, "ardiaContext", JSON.stringify(context));
  return url;
}

function contextOf(name: string, tabId: string | null): PageContext | null {
  const m = activeManifest(currentPlugins(), name);
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (!m || !tab || !m.permissions.includes("tabs") || pluginPageOf(tab.url)) return null;
  return { tabId: tab.id, url: m.permissions.includes("fullUrls") ? tab.url : minimizedUrl(tab.url), title: tab.customTitle || tab.title };
}

export function openPluginPage(windowId: string, name: string, how: { split?: boolean; side?: PageSide; context?: boolean; path?: string } = {}): string | null {
  if (!activeManifest(currentPlugins(), name)?.page) return null;
  const path = how.path ?? "";
  if (!isPagePath(path)) return null;
  const s = useBrowser.getState();
  if (!s.windows[windowId]) return null;
  const url = pluginPageUrl(name, path);
  const anchor = activeTabId(s, windowId);
  const existing = viewTabIds(s, windowId).find((id) => {
    const at = s.tabs[id]?.url ?? "";
    return pluginPageOf(at) === name && pluginPagePath(at) === path;
  }) ?? null;
  const context = how.context ? contextOf(name, anchor ?? null) : null;
  let tabId: string | null;
  if (how.split && anchor && anchor !== existing) {
    tabId = openSplitPane(windowId, existing ? { tabId: existing, anchorTabId: anchor, side: how.side ?? "right" } : { url, anchorTabId: anchor, side: how.side ?? "right" });
    if (tabId) notePlugin("plugin_split_opens");
  } else if (existing) {
    s.activate(existing);
    tabId = existing;
  } else {
    tabId = s.newTab(windowId, { url });
  }
  if (!tabId) return null;
  notePlugin("plugin_page_opens");
  usePluginPages.setState((p) => {
    const contexts = { ...p.contexts };
    if (context) contexts[tabId] = context;
    else delete contexts[tabId];
    return { contexts };
  });
  return tabId;
}

export function openPageLink(windowId: string, url: string) {
  if (webUrl(url)) openUrls([url], windowId);
}

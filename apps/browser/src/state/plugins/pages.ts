import { create } from "zustand";
import type { PageSide } from "../../lib/pluginManifest";
import { minimizedUrl, webUrl } from "../../lib/urlParts";
import { openUrls } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { activeTabId, viewTabIds } from "../browser/model";
import { openSplitPane } from "../splits/actions";
import { notePlugin } from "../telemetry/pluginCounts";
import { pluginPageOf, pluginPageUrl } from "./pageNames";
import { activeManifest, currentPlugins, type PluginsStore } from "./store";

export { pluginPageOf, pluginPageUrl };

export type PageContext = { tabId: string; url: string; title: string };

export const usePluginPages = create<{ contexts: Record<string, PageContext> }>()(() => ({ contexts: {} }));


export function pageViewUrl(s: Pick<PluginsStore, "listings" | "records" | "servedUrls">, name: string, context: PageContext | null): string | null {
  const page = activeManifest(s, name)?.page;
  if (!page) return null;
  const base = "file" in page.source ? `ardia-plugin://${name}/${page.source.file.split("/").map(encodeURIComponent).join("/")}` : (s.servedUrls[name] ?? null);
  if (!base || !context) return base;
  return `${base}${base.includes("?") ? "&" : "?"}ardiaContext=${encodeURIComponent(JSON.stringify(context))}`;
}

function contextOf(name: string, tabId: string | null): PageContext | null {
  const m = activeManifest(currentPlugins(), name);
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (!m || !tab || !m.permissions.includes("tabs") || pluginPageOf(tab.url)) return null;
  return { tabId: tab.id, url: m.permissions.includes("fullUrls") ? tab.url : minimizedUrl(tab.url), title: tab.customTitle || tab.title };
}

export function openPluginPage(windowId: string, name: string, how: { split?: boolean; side?: PageSide; context?: boolean } = {}): string | null {
  if (!activeManifest(currentPlugins(), name)?.page) return null;
  const s = useBrowser.getState();
  if (!s.windows[windowId]) return null;
  const url = pluginPageUrl(name);
  const anchor = activeTabId(s, windowId);
  const existing = viewTabIds(s, windowId).find((id) => pluginPageOf(s.tabs[id]?.url) === name) ?? null;
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

import { create } from "zustand";
import type { PluginManifest } from "../../lib/pluginManifest";
import { sendToPlugin } from "../../platform/plugins";
import { useBrowser } from "../browser/store";
import { failure } from "../automation/automationMethods";
import { isEligibleTab, ownEntry } from "../automation/automationWindows";
import type { Body } from "../automation/controlSocket";
import { notePlugin } from "../telemetry/pluginCounts";
import { onProcessStopped } from "./process";
import { currentPlugins } from "./store";

export const BANNER_TEXT_MAX = 80;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

export type PluginBanner = { plugin: string; text: string; stopping: boolean };

export const usePluginBanners = create<{ banners: Record<string, PluginBanner> }>()(() => ({ banners: {} }));

export const usePluginBanner = (tabId: string) => usePluginBanners((s) => s.banners[tabId] ?? null);

function setBanners(change: (banners: Record<string, PluginBanner>) => Record<string, PluginBanner>) {
  usePluginBanners.setState((s) => ({ banners: change({ ...s.banners }) }));
}

export function clearPluginBanners(plugin: string) {
  if (!Object.values(usePluginBanners.getState().banners).some((b) => b.plugin === plugin)) return;
  setBanners((banners) => Object.fromEntries(Object.entries(banners).filter(([, b]) => b.plugin !== plugin)));
}

export function setBanner(name: string, m: PluginManifest, params: Record<string, unknown>): Body {
  if (!m.permissions.includes("pages")) return failure("refused", "tab.banner needs the pages permission.");
  const { tab, text } = params;
  const s = useBrowser.getState();
  if (typeof tab !== "string" || !ownEntry(s.tabs, tab)) return failure("bad_request", "tab is the id of one of your tabs.");
  if (!isEligibleTab(s, tab)) return failure("refused", `Tab ${tab} is private, in Peek or in a window plugins can't use.`);
  if (text !== null && (typeof text !== "string" || !text.trim() || text.length > BANNER_TEXT_MAX || UNSAFE_TEXT.test(text)))
    return failure("bad_request", `text is 1 to ${BANNER_TEXT_MAX} characters without control characters, or null to clear the banner.`);
  const held = usePluginBanners.getState().banners[tab];
  if (held && held.plugin !== name) return failure("refused", `Another plugin shows a banner on tab ${tab}.`);
  if (text === null) {
    if (held) setBanners((banners) => (delete banners[tab], banners));
    return { result: { ok: true } };
  }
  if (!held) notePlugin("plugin_banners_shown");
  setBanners((banners) => ({ ...banners, [tab]: { plugin: name, text: text as string, stopping: false } }));
  return { result: { ok: true } };
}

export function pressBannerStop(tabId: string) {
  const banner = usePluginBanners.getState().banners[tabId];
  if (!banner || banner.stopping) return;
  const process = currentPlugins().processes[banner.plugin];
  notePlugin("plugin_banner_stops");
  setBanners((banners) => ({ ...banners, [tabId]: { ...banner, stopping: true } }));
  if (process?.state === "running") sendToPlugin(banner.plugin, process.run, JSON.stringify({ event: "plugin.bannerAction", time: Date.now(), data: { tab: tabId } }));
}

let started = false;

export function startBanners() {
  if (started) return;
  started = true;
  onProcessStopped(clearPluginBanners);
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    const banners = usePluginBanners.getState().banners;
    if (Object.keys(banners).some((id) => !s.tabs[id])) setBanners((all) => Object.fromEntries(Object.entries(all).filter(([id]) => s.tabs[id])));
  });
}

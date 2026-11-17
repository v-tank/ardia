import { create } from "zustand";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import type { PluginManifest } from "../../lib/pluginManifest";
import type { BrowserState } from "../browser/store";
import { useBrowser } from "../browser/store";
import { innermostGroupOf } from "../groups/groups";
import { splitOf } from "../splits/splits";
import { failure } from "../automation/automationMethods";
import { isEligibleTab, ownEntry } from "../automation/automationWindows";
import type { Body } from "../automation/controlSocket";
import { onProcessStopped } from "./process";
import { pluginPageOf } from "./pageNames";

export function pageHeadOf(s: Pick<BrowserState, "groups" | "tabs" | "splits">, groupId: string): string | null {
  if (!PLATFORM_FEATURES.plugins) return null;
  const first = s.groups[groupId]?.tabIds.find((id) => s.tabs[id]);
  if (!first || !pluginPageOf(s.tabs[first]!.url)) return null;
  if (innermostGroupOf(s.groups, first)?.id !== groupId || splitOf(s, first)) return null;
  return first;
}

export const usePageActivity = create<{ running: Record<string, string> }>()(() => ({ running: {} }));

export const usePageRunning = (tabId: string | null) => usePageActivity((s) => (tabId ? !!s.running[tabId] : false));

function setRunning(change: (running: Record<string, string>) => Record<string, string>) {
  usePageActivity.setState((s) => ({ running: change({ ...s.running }) }));
}

export function setTabActivity(name: string, m: PluginManifest, params: Record<string, unknown>): Body {
  if (!m.permissions.includes("tabs")) return failure("refused", "tab.activity needs the tabs permission.");
  const { tab, running } = params;
  const s = useBrowser.getState();
  const t = ownEntry(s.tabs, tab);
  if (typeof tab !== "string" || !t || typeof running !== "boolean") return failure("bad_request", "tab.activity needs tab (one of this plugin's page tabs) and running (true or false).");
  if (!isEligibleTab(s, tab) || pluginPageOf(t.url) !== name) return failure("refused", `Tab ${tab} isn't one of this plugin's page tabs.`);
  if (running !== !!usePageActivity.getState().running[tab]) setRunning((all) => (running ? { ...all, [tab]: name } : (delete all[tab], all)));
  return { result: { ok: true } };
}

let started = false;

export function startPageActivity() {
  if (started) return;
  started = true;
  onProcessStopped((name) => {
    if (Object.values(usePageActivity.getState().running).includes(name)) setRunning((all) => Object.fromEntries(Object.entries(all).filter(([, owner]) => owner !== name)));
  });
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    if (Object.keys(usePageActivity.getState().running).some((id) => !s.tabs[id])) setRunning((all) => Object.fromEntries(Object.entries(all).filter(([id]) => s.tabs[id])));
  });
}

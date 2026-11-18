import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { foldedGroupHeight, entryHeight } from "./geometry";
import { entryId, entryKey, parseEntry } from "./entryKey";
import { holdsTab } from "./entries";
import { splitRowPanes } from "../splits/splits";
import { windowRootSize } from "../windows/rootSize";

const NO_TABS: string[] = [];

export type EntryDragSpec =
  | { kind: "row" | "split"; tabIds: string[] }
  | { kind: "group"; tabIds: string[]; groupId: string; collapsed: boolean; foldedHeight: () => number };

const heightsKey = (s: BrowserState, windowId: string, profileId: string, boxes: string[]) => boxes.map((e) => entryHeight(s, windowId, profileId, e)).join(",");

export const useBoxHeights = (windowId: string, profileId: string, boxes: string[]) => useBrowser((s) => heightsKey(s, windowId, profileId, boxes));

function keptTabs(s: BrowserState, windowId: string, profileId: string): string {
  const active = activeTabId(s, windowId, profileId);
  const selected = s.selection[windowId] ?? NO_TABS;
  return active ? [active, ...selected].join("\n") : selected.join("\n");
}

export const useKeptTabs = (windowId: string, profileId: string) => useBrowser((s) => keptTabs(s, windowId, profileId));

export function entryHeightsNow(windowId: string, profileId: string, list: string[]): number[] {
  const s = useBrowser.getState();
  return list.map((e) => entryHeight(s, windowId, profileId, e));
}

export const windowRootHeightNow = (windowId: string): number | undefined => windowRootSize(useBrowser.getState(), windowId)?.height;

export function keptEntryIndices(list: string[], index: Map<string, number>, tabIds: string[], keys: string[]): number[] {
  const s = useBrowser.getState();
  const ofTab = (tabId: string) => {
    const direct = index.get(entryKey("tab", tabId));
    if (direct !== undefined) return direct;
    for (let i = 0; i < list.length; i++) if (holdsTab(s, list[i]!, tabId)) return i;
    return -1;
  };
  const ofKey = (key: string) => {
    const known = index.get(key);
    if (known !== undefined) return known;
    const groupId = entryId(key, "group");
    const tabId = entryId(key, "tab") ?? (groupId === null ? null : (s.groups[groupId]?.tabIds[0] ?? null));
    return tabId === null ? -1 : ofTab(tabId);
  };
  return [...tabIds.map(ofTab), ...keys.map(ofKey)];
}

export function entryDragSpecNow(windowId: string, profileId: string, entry: string): EntryDragSpec | null {
  const s = useBrowser.getState();
  const { kind, id } = parseEntry(entry);
  if (kind === "tab") return s.tabs[id] ? { kind: "row", tabIds: [id] } : null;
  if (kind === "split") return s.splits[id] ? { kind: "split", tabIds: splitRowPanes(s, s.splits[id]) } : null;
  if (kind !== "group") return null;
  const group = s.groups[id];
  return group ? { kind: "group", tabIds: group.tabIds, groupId: id, collapsed: !!group.collapsed, foldedHeight: () => foldedGroupHeight(windowId, profileId, id) } : null;
}

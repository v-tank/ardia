import { GROUP_MEMBERS_PAD_BOTTOM, SIDEBAR_GROUP, SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { useBrowser, type BrowserState } from "../browser/store";
import { live } from "../live/store";
import { ancestorIds } from "../groups/groups";
import { groupOf } from "../pins/tabGrouping";
import { splitOf } from "../splits/splits";
import { groupEntries, holdsTab, keptEntries, sidebarEntries } from "./entries";
import { shownPinnedEntries } from "./pinnedFold";
import { entryId, entryKey } from "./entryKey";
import { pinSection } from "../browser/model";

const GROUP_BORDER = SIDEBAR_GROUP.border;

export type Section = "pinnedGroups" | "list";

export const headGap = (first: string | null | undefined): number => (first && entryId(first, "group") !== null ? SIDEBAR_ROW.gap : 0);

function stackHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  return entries.length ? headGap(entries[0]) + entriesHeight(s, windowId, profileId, entries) + GROUP_MEMBERS_PAD_BOTTOM : 0;
}

function membersHeight(s: BrowserState, windowId: string, profileId: string, groupId: string): number {
  const collapsed = !!s.groups[groupId]?.collapsed;
  return stackHeight(s, windowId, profileId, collapsed ? keptEntries(s, windowId, profileId, groupId) : groupEntries(s, groupId));
}

export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string): number {
  const groupId = entryId(entry, "group");
  if (groupId === null) return SIDEBAR_ROW.height;
  return GROUP_BORDER * 2 + SIDEBAR_ROW.height + membersHeight(s, windowId, profileId, groupId);
}

export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e) + SIDEBAR_ROW.gap, 0) - (entries.length ? SIDEBAR_ROW.gap : 0);
}

export const FIRST_PAINT_HEIGHT = 2400;

export const startsOffScreen = (lazy: boolean, current: boolean) => lazy && !current;

export function rowSpan(
  s: BrowserState,
  windowId: string,
  profileId: string,
  tabId: string,
  newTabAtTop: boolean,
): { section: Section; top: number; height: number } | null {
  const { pinned, list } = sidebarEntries(s, windowId, profileId);
  const sections: [Section, string[], number][] = [
    ["pinnedGroups", shownPinnedEntries(s, windowId, profileId, pinned), 0],
    ["list", list, newTabAtTop ? SIDEBAR_ROW.height + SIDEBAR_ROW.gap : 0],
  ];
  const within = (entries: string[], top: number): number | null => {
    for (const entry of entries) {
      if (holdsTab(s, entry, tabId)) {
        const id = entryId(entry, "group");
        if (id === null) return top;
        const members = groupEntries(s, id);
        const header = top + GROUP_BORDER;
        if (!s.groups[id]!.collapsed) return within(members, header + SIDEBAR_ROW.height + headGap(members[0]));
        const kept = keptEntries(s, windowId, profileId, id);
        return within(kept, header + SIDEBAR_ROW.height + headGap(kept[0])) ?? header;
      }
      top += entryHeight(s, windowId, profileId, entry) + SIDEBAR_ROW.gap;
    }
    return null;
  };
  for (const [section, entries, start] of sections) {
    const top = within(entries, start);
    if (top !== null) return { section, top, height: SIDEBAR_ROW.height };
  }
  return null;
}

export const entryHeightNow = (windowId: string, profileId: string, entry: string): number => entryHeight(useBrowser.getState(), windowId, profileId, entry);

export function foldedGroupHeight(windowId: string, profileId: string, groupId: string): number {
  const s = useBrowser.getState();
  return GROUP_BORDER * 2 + SIDEBAR_ROW.height + stackHeight(s, windowId, profileId, keptEntries(s, windowId, profileId, groupId));
}

export type RevealSpot = { span: { section: Section; top: number; height: number } } | { keys: string[] } | null;

export function revealSpot(windowId: string, tabId: string, tilesFixed: boolean, newTabAtTop: boolean): RevealSpot {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId;
  if (!profileId) return null;
  const pinned = s.tabs[tabId];
  if (tilesFixed && pinSection(pinned) === "tile") return null;
  const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
  const pinnedHasLive = span?.section === "pinnedGroups" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
  if (span && !pinnedHasLive) return { span };
  const split = splitOf(s, tabId);
  const inner = groupOf(s, tabId);
  return { keys: [tabId, ...(split ? [entryKey("split", split.id)] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])] };
}

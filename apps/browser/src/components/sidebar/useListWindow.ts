import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type StoreApi } from "zustand";
import { entryId, entryKey } from "../../state/sidebar/entryKey";
import { entryHeightsNow, keptEntryIndices, useBoxHeights, useKeptTabs } from "../../state/sidebar/listWindow";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { noDragMarks, type DragMarks } from "../../state/sidebar/dragMarks";
import { useScreenReader } from "../../state/app/screenReader";
import { noteSidebarRowsMounted } from "../../state/telemetry/sidebarScrollCounts";
import { layout } from "../ui/theme";
import { shiftedBand, type ListBand, type ListViewport } from "./listViewport";
import { listGeometry, mountedIndices, nextWindow, windowPieces, type ListGeometry } from "./listWindow";
export const ASIDE_SETTLE_MS = 1500;
const ASIDE_AHEAD = { above: 0, below: 0.25 } as const;

export type ListWindow = { mounted: string[]; before: Map<string, number>; after: number; geometry: ListGeometry };

type Options = {
  windowId: string;
  profileId: string;
  list: string[];
  viewport: ListViewport | null;
  above: number;
  current: boolean;
  firstPaint: number;
  marks: StoreApi<DragMarks> | undefined;
  moving: (entry: string) => boolean;
};

const NO_TABS: string[] = [];

export function useListWindow({ windowId, profileId, list, viewport, above, current, firstPaint, marks, moving }: Options): ListWindow | null {
  const reader = useScreenReader();
  const shown = useRef<{ geometry: ListGeometry; indices: number[]; window: ListWindow } | null>(null);
  const boxes = useMemo(() => list.filter((e) => entryId(e, "group") !== null), [list]);
  const boxHeights = useBoxHeights(windowId, profileId, boxes);
  const rowGap = layout.rowGap;
  const geometry = useMemo(() => listGeometry(entryHeightsNow(windowId, profileId, list), rowGap), [list, boxHeights, rowGap, windowId, profileId]);
  const index = useMemo(() => new Map(list.map((e, i) => [e, i])), [list]);
  const tabs = useKeptTabs(windowId, profileId);
  const renaming = useSidebarUi((u) => (u.renaming?.windowId === windowId && u.renaming.kind !== "folder" ? entryKey(u.renaming.kind, u.renaming.id) : null));
  const hovered = useSidebarUi((u) => (u.hover?.windowId === windowId && u.hover.kind === "tab" ? u.hover.id : null));
  const dragged = useStore(marks ?? noDragMarks, (m) => [...m.sources].join("\n"));

  const read = () => shiftedBand(viewport?.band() ?? null, above);
  const [aside, setAside] = useState(!current);
  useEffect(() => {
    if (current) return setAside(false);
    const timer = setTimeout(() => setAside(true), ASIDE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [current]);
  const [band, setBand] = useState<ListBand>(() => nextWindow(null, read(), firstPaint));
  const latest = useRef({ read, firstPaint, aside, dragging: !!dragged });
  latest.current = { read, firstPaint, aside, dragging: !!dragged };
  useEffect(() => {
    if (!viewport) return;
    const follow = () => {
      const { read, firstPaint, aside, dragging } = latest.current;
      const view = read();
      setBand((was) => (aside && view ? asideBand(view) : nextWindow(was, view, firstPaint, dragging)));
    };
    follow();
    return viewport.watch(follow);
  }, [viewport, aside, !!dragged]);

  if (reader) return null;
  const keys = [...(hovered ? [entryKey("tab", hovered)] : []), ...(renaming ? [renaming] : []), ...(dragged ? dragged.split("\n") : NO_TABS)];
  const kept = new Set(keptEntryIndices(list, index, tabs ? tabs.split("\n") : NO_TABS, keys));
  for (let i = 0; i < list.length; i++) if (moving(list[i]!)) kept.add(i);
  const mounted = mountedIndices(geometry, band, kept);
  const was = shown.current;
  if (was && was.geometry === geometry && sameIndices(was.indices, mounted)) return was.window;
  const { pieces, after } = windowPieces(geometry, rowGap, mounted);
  const before = new Map<string, number>();
  for (const p of pieces) if (p.before > 0) before.set(list[p.index]!, p.before);
  const next = { mounted: pieces.map((p) => list[p.index]!), before, after, geometry };
  shown.current = { geometry, indices: mounted, window: next };
  if (current) noteSidebarRowsMounted(next.mounted.length);
  return next;
}

const sameIndices = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function asideBand(view: ListBand): ListBand {
  const screen = view.bottom - view.top;
  return { top: view.top - screen * ASIDE_AHEAD.above, bottom: view.bottom + screen * ASIDE_AHEAD.below };
}

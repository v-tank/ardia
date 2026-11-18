import { useEffect, useRef } from "react";
import { entryDragSpecNow } from "../../state/sidebar/listWindow";
import { SIDEBAR_GROUP, SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { usePageDragItems } from "./DragProvider";
import type { Item, ItemSpec } from "./dragModel";
import type { ListWindow } from "./useListWindow";

export function useModelDragItems(windowId: string, profileId: string, all: string[], windowed: ListWindow | null, above: number) {
  const items = usePageDragItems();
  const made = useRef(new Map<string, Item>()).current;
  useEffect(() => {
    if (!items || !windowed) return;
    const mounted = new Set(windowed.mounted);
    const stops: (() => void)[] = [];
    all.forEach((entry, i) => {
      if (mounted.has(entry)) return;
      const found = entryDragSpecNow(windowId, profileId, entry);
      if (!found) return;
      const spec: ItemSpec = { ...found, section: "list" };
      const item = made.get(entry) ?? items.controller.create(entry);
      made.set(entry, item);
      Object.assign(item, spec, {
        view: null,
        header: null,
        place: { top: above + windowed.geometry.tops[i]!, height: windowed.geometry.heights[i]!, header: spec.kind === "group" ? SIDEBAR_ROW.height + SIDEBAR_GROUP.border : 0 },
      });
      stops.push(items.add(entry, item));
    });
    const listed = new Set(all);
    for (const key of made.keys()) if (!listed.has(key)) made.delete(key);
    return () => stops.forEach((stop) => stop());
  }, [items, windowed, all, above, windowId, profileId, made]);
}

import { memo, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, View } from "react-native";
import { radius, space, Symbol, Text } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useSettings } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCapturedSidebarEntries, useOffersTidyTabs, usePinnedCollapsed, usePinnedKept } from "../../state/sidebar/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { useNewTabAtTop } from "../../state/sidebar/chrome";
import { ClearDivider } from "./ClearDivider";
import { PinnedSectionHeader } from "./PinnedSectionHeader";
import { DragScope, useDragController, useDragItem } from "./DragProvider";
import { Fold, useFold } from "./Fold";
import { SidebarEntry } from "./GroupBlock";
import { GhostSlot, ListMotionContext, useListMotion, type ListSlot } from "./ListMotion";
import { PinnedGrid } from "./PinnedGrid";
import { usePinnedSequence } from "../../state/sidebar/pinnedOrder";
import { SCROLL_EDGE } from "./ScrollEdge";
import { entryHeightNow, FIRST_PAINT_HEIGHT } from "../../state/sidebar/geometry";
import { INCOGNITO_ICON } from "../ntp/IncognitoHeading";
import { rowPitch, type SidebarGeometry } from "./pageLayout";
import { NewTabRow } from "./NewTabRow";
import { CleanUpUpsell } from "./CleanUpUpsell";
import { sidebarTokens, TAB_ROW } from "./tokens";
import { tailKey } from "./dragModel";
import type { ListViewport } from "./listViewport";
import { useListWindow, type ListWindow } from "./useListWindow";
import { useModelDragItems } from "./modelDragItems";
import { keepSlots } from "./listWindow";
import { entryId } from "../../state/sidebar/entryKey";
import { windowRootHeightNow } from "../../state/sidebar/listWindow";

type PageRowsProps = {
  windowId: string;
  profileId: string;
  current: boolean;
  lazy: boolean;
  offScreen: boolean;
  tiles: string[];
  underDockedTiles: boolean;
  innerWidth: number;
  inlineNewTab: boolean;
  controller: ReturnType<typeof useDragController>;
  geometry: RefObject<SidebarGeometry> | undefined;
  regions: SidebarGeometry["regions"];
  viewport: ListViewport | null;
  onListHeight: (height: number) => void;
};

const DOCKED_TILES_GAP = SCROLL_EDGE.gap + SCROLL_EDGE.line + SCROLL_EDGE.inset;

export function PageRows({ windowId, profileId, current, lazy, offScreen, tiles, underDockedTiles, innerWidth, inlineNewTab, controller, geometry, regions, viewport, onListHeight }: PageRowsProps) {
  const [captured] = useState(newCapture);
  const { list: all } = useCapturedSidebarEntries(windowId, profileId, captured);
  const showClear = useSettings((s) => s.showClearButton);
  const clearable = showClear && !offScreen && all.length > 0;
  const tidyTabs = useSettings((s) => s.tidyTabs);
  const tidy = useOffersTidyTabs(windowId, profileId, offScreen || !tidyTabs);
  const pinned = usePinnedSequence(windowId, profileId, offScreen);
  const pinnedSection = pinned.length > 0;
  const divided = clearable || tidy || pinnedSection;
  const collapsed = usePinnedCollapsed(profileId);
  const pinnedFold = useFold(collapsed);
  const kept = usePinnedKept(windowId, profileId, pinned);
  const pinnedGap = collapsed && !kept && !pinnedFold.moving ? 0 : layout.rowGap;
  const newTabButtonAtTop = useNewTabAtTop();
  const animated = current && !offScreen;
  const above = newTabButtonAtTop && inlineNewTab ? rowPitch() : 0;
  const motion = useListMotion(windowId, profileId, all, captured, animated, viewport, above);
  const [rootHeight] = useState(() => windowRootHeightNow(windowId));
  const windowed = useListWindow({
    windowId,
    profileId,
    list: offScreen ? NO_ENTRIES : all,
    viewport,
    above,
    current,
    firstPaint: lazy ? (rootHeight ?? FIRST_PAINT_HEIGHT) : FIRST_PAINT_HEIGHT,
    marks: controller?.marks,
    moving: motion.sliding,
  });
  const list = offScreen ? NO_ENTRIES : (windowed?.mounted ?? all);
  useModelDragItems(windowId, profileId, offScreen ? NO_ENTRIES : all, windowed, above);
  const slots: ListSlot[] = motion.fading ? motion.slots(list) : list.map((entry) => ({ entry }));
  const rowSlots = useRef(new Map<string, number>());
  rowSlots.current = windowed ? keepSlots(list.filter((e) => entryId(e, "tab") !== null), rowSlots.current) : new Map();
  const keyOf = (entry: string) => {
    const slot = rowSlots.current.get(entry);
    return slot === undefined ? entry : `row:${slot}`;
  };
  const scope = useMemo(() => ({ slideBelow: motion.slideBelow }), [motion.slideBelow]);
  const pinnedHeaderRegion = useCallback((view: View | null) => void controller?.regions.set("pinnedHeader", view), [controller]);
  if (geometry) geometry.current.newTabAtTop = newTabButtonAtTop && inlineNewTab;
  return (
    <ListMotionContext.Provider value={scope}>
      <View
        onLayout={(e) => onListHeight(e.nativeEvent.layout.height + SCROLL_EDGE.inset - (inlineNewTab ? rowPitch() : 0))}
      >
        {isIncognitoProfile(profileId) ? <IncognitoBadge /> : null}
        {tiles.length ? (
          <DragScope enabled={current}>
            <PinnedGrid tabs={tiles} innerWidth={innerWidth} flush />
          </DragScope>
        ) : null}
        {pinnedSection ? <PinnedSectionHeader windowId={windowId} profileId={profileId} collapsed={collapsed} open={pinnedFold.open} top={tiles.length ? space.s : 0} bottom={pinnedGap} dragRegion={pinnedHeaderRegion} /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("pinnedGroups", v);
          }}
          onLayout={(e) => void (regions.pinnedGroups = e.nativeEvent.layout.y)}
          style={{ gap: pinnedGap }}
        >
          {pinnedSection ? (
            <Fold
              fold={pinnedFold}
              collapsed={collapsed}
              entries={pinned.map((entry) => ({ key: entry, node: <SidebarEntry entry={entry} section="pinnedGroups" rowSection="pinnedRows" /> }))}
              keep={kept}
              estimate={(key) => entryHeightNow(windowId, profileId, key)}
            />
          ) : null}
          <Tail section="pinnedGroups" />
        </View>
        {divided ? (
          <ClearDivider
            windowId={windowId}
            profileId={profileId}
            lift={underDockedTiles && !pinnedSection && !isIncognitoProfile(profileId) ? DOCKED_TILES_GAP : 0}
            clear={clearable}
            tidy={tidy}
          />
        ) : null}
        <View
          ref={(v) => {
            controller?.regions.set("list", v);
          }}
          onLayout={(e) => {
            regions.list = e.nativeEvent.layout.y;
            viewport?.changed();
          }}
          style={{ gap: layout.rowGap }}
        >
          {newTabButtonAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
          {withSpacers(slots, windowed, (slot) =>
            "ghost" in slot ? (
              <GhostSlot key={slot.ghost.key} snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} />
            ) : (
              <SidebarEntry key={keyOf(slot.entry)} entry={slot.entry} section="list" motion={motion.motion(slot.entry)} />
            ),
          )}
          <Tail section="list" />
          {!newTabButtonAtTop && inlineNewTab ? <NewTabRow windowId={windowId} shift={motion.tail} clip={motion.tailClip} /> : null}
        </View>
        {current ? <CleanUpUpsell windowId={windowId} shift={motion.tail} /> : null}
      </View>
    </ListMotionContext.Provider>
  );
}

const NO_ENTRIES: string[] = [];

function withSpacers(slots: ListSlot[], windowed: ListWindow | null, draw: (slot: ListSlot) => ReactNode): ReactNode[] {
  if (!windowed) return slots.map(draw);
  const out: ReactNode[] = [];
  const spaced = new Set<string>();
  let trailing = windowed.after > 0;
  const space = (key: string, height: number) => out.push(<View key={key} style={{ height }} />);
  for (const slot of slots) {
    const anchor = "ghost" in slot ? slot.ghost.anchor : slot.entry;
    if (anchor === null) {
      if (trailing) space("space:end", windowed.after);
      trailing = false;
    } else if (!spaced.has(anchor)) {
      spaced.add(anchor);
      const height = windowed.before.get(anchor);
      if (height) space(`space:${anchor}`, height);
    }
    out.push(draw(slot));
  }
  if (trailing) space("space:end", windowed.after);
  return out;
}

const Tail = memo(function Tail({ section }: { section: "list" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(tailKey(section), { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

function IncognitoBadge() {
  const theme = useTheme();
  if (!useAddressBarInSidebar()) return null;
  return (
    <View style={{ height: 30, marginBottom: space.xs, paddingHorizontal: TAB_ROW.contentLeft, flexDirection: "row", alignItems: "center", gap: space.m, borderRadius: radius.tile, backgroundColor: sidebarTokens(theme).incognitoBadge }}>
      <Symbol name={INCOGNITO_ICON} size={13} weight="semibold" color={theme.textPrimary} style={{ width: 18, height: 16 }} />
      <Text size="small" weight="semibold">
        Incognito
      </Text>
    </View>
  );
}

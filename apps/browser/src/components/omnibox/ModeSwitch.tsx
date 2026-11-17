import { memo } from "react";
import { View } from "react-native";
import { KeyCap, Segmented, type SegmentOption } from "../ui";
import type { NewTabModeOption } from "../../state/plugins/hooks";
import { BAR, MODE_SWITCH } from "./tokens";

export const SEARCH_MODE = "";

export const ModeSwitch = memo(function ModeSwitch({ modes, chosen, onChange }: { modes: readonly NewTabModeOption[]; chosen: string | null; onChange(plugin: string | null): void }) {
  const options: SegmentOption<string>[] = [{ value: SEARCH_MODE, title: "Search" }, ...modes.map((m) => ({ value: m.plugin, title: m.title }))];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: MODE_SWITCH.gap, paddingLeft: BAR.panel.heroIconLeft, paddingTop: MODE_SWITCH.top }}>
      <Segmented look="quiet" options={options} value={chosen ?? SEARCH_MODE} onChange={(value) => onChange(value === SEARCH_MODE ? null : value)} />
      <KeyCap keys={["tab"]} scale={MODE_SWITCH.keyScale} />
    </View>
  );
});

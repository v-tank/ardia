import { displayUrl } from "@ardia/core";
import { memo } from "react";
import { Animated, Pressable, View } from "react-native";
import { Symbol, Text, useHover, useTheme } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";
import { ADD_CHIP } from "./tokens";
import { pickFiles } from "../../state/app/system";
import { chooseFromMenu } from "../../state/app/menuChoice";
import { otherOpenTabs, switchFromBar } from "../../state/omnibox/openFromBar";

export const AddChip = memo(function AddChip({ onPress }: { onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const glass = useGlass();
  const pressMotion = usePressScaleMotion(true, buttonMotion.controlPressScale);
  const scaleStyle = pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : undefined;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} onPressIn={pressMotion.onPressIn} onPressOut={pressMotion.onPressOut}>
        <Animated.View
          style={[{
            height: ADD_CHIP.height,
            borderRadius: ADD_CHIP.radius,
            borderWidth: glass ? 0 : ADD_CHIP.border,
            borderColor: theme.chipBorder,
            backgroundColor: !glass && hovered ? theme.rowHover : undefined,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: ADD_CHIP.left,
            paddingRight: ADD_CHIP.right,
            gap: ADD_CHIP.gap,
          }, scaleStyle]}
        >
          {glass ? <GlassFill radius={ADD_CHIP.radius} state={hovered ? "lit" : "rest"} /> : null}
          <Symbol name="arrow.up.right" size={ADD_CHIP.glyph} weight="medium" color={theme.chipText} style={{ width: ADD_CHIP.glyphBox, height: ADD_CHIP.glyphBox }} />
          <Text tone="chipText">Open a tab or file</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
});

export async function openTabOrFile(windowId: string, tabId: string, onGo: (url: string) => void) {
  const others = otherOpenTabs(windowId, ADD_CHIP.otherTabs);
  const choice = await chooseFromMenu<{ tab: string }, "files">([
    ...others.map((t) => ({ value: { tab: t.id }, title: t.title || displayUrl(t.url) })),
    ...(others.length ? [{ separator: true as const }] : []),
    { id: "files", title: "Open File…", symbol: "doc" },
  ]);
  if (choice && typeof choice === "object") switchFromBar(choice.tab, "", tabId, "current");
  if (choice === "files") {
    const [file] = await pickFiles();
    if (file) onGo(file);
  }
}

import { devRegister } from "../dev/devRegister";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { PERSONALIZE_COPY, TabLayoutPicker } from "../onboarding/Personalize";
import { ThemePicker } from "../settings/ThemeEditor";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import { Box, Panel, proseLineHeight, shadow, space, Text } from "../ui";
import { NTP_ROUND_BUTTON, PERSONALIZE_PANEL } from "./tokens";
import { NtpRoundButton } from "./NtpRoundButton";
import { closePersonalizePanelOf, setPersonalizePanel as setOpen, usePersonalizePanel } from "../../state/pages/personalizePanel";
import { perLook } from "../ui/tokens";

export const INSET = space.xl;
const PANEL_WIDTH = 352;
const EDITING_PANEL_WIDTH = 432;

export function PersonalizeButton({ windowId }: { windowId: string }) {
  const open = usePersonalizePanel((s) => s.windowId === windowId);
  useEffect(() => () => closePersonalizePanelOf(windowId), [windowId]);
  return (
    <>
      {open ? <PersonalizePanel windowId={windowId} onClose={() => setOpen(null)} /> : null}
      <NtpRoundButton icon="paintpalette" label="Personalize" active={open} onPress={() => setOpen(open ? null : windowId)} style={{ position: "absolute", right: INSET, bottom: INSET - NTP_ROUND_BUTTON.glyphDrop }} />
    </>
  );
}

function PersonalizePanel({ windowId, onClose }: { windowId: string; onClose: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const editing = useWindowProfileValue(windowId, (p) => !!p?.theme);
  useEffect(() => {
    Animated.spring(t, { toValue: 1, ...PERSONALIZE_PANEL.spring, useNativeDriver: true }).start();
  }, []);
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close Personalize" />
      <Animated.View
        style={{
          position: "absolute",
          right: INSET,
          bottom: INSET + NTP_ROUND_BUTTON.size + space.m,
          width: editing ? EDITING_PANEL_WIDTH : PANEL_WIDTH,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
        }}
      >
        <Panel radius={PERSONALIZE_PANEL.radius} shadow={shadow.dialog}>
          <Box pad="xl" gap="xl">
            <Box gap="xs">
              <Text size="title" weight="semibold">
                {PERSONALIZE_COPY.title}
              </Text>
              <Text size="small" tone="textSecondary" style={SUBTITLE()}>
                {PERSONALIZE_COPY.subtitle}
              </Text>
            </Box>
            <ThemePicker windowId={windowId} size={28} gap={space.xs} />
            <Box gap="m">
              <Text size="small" tone="textSecondary">
                {PERSONALIZE_COPY.layouts}
              </Text>
              <TabLayoutPicker windowId={windowId} />
            </Box>
          </Box>
        </Panel>
      </Animated.View>
    </>
  );
}

const SUBTITLE = perLook(() => ({ lineHeight: proseLineHeight.small }) as const);

devRegister("acPersonalize", "open", setOpen);

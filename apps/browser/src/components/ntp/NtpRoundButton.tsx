import { Animated, Pressable, View, type ViewStyle } from "react-native";
import { capsule, Symbol, useHover, useTheme } from "../ui";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";
import { NTP_ROUND_BUTTON } from "./tokens";

export function NtpRoundButton({ icon, label, active = false, onPress, style }: { icon: string; label: string; active?: boolean; onPress: () => void; style?: ViewStyle }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const pressMotion = usePressScaleMotion(true, buttonMotion.iconPressScale);
  const lit = hovered || active;
  return (
    <View {...hoverProps} tooltip={label} style={style}>
      <Pressable onPress={onPress} onPressIn={pressMotion.onPressIn} onPressOut={pressMotion.onPressOut} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: active }}>
        {({ pressed }) => (
          <View style={[PLATE, { backgroundColor: pressed ? theme.toolbarPressed : lit ? theme.toolbarHover : undefined }]}>
            <Animated.View style={[GLYPH, pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : null]}>
              <Symbol name={icon} size={NTP_ROUND_BUTTON.glyph} color={lit ? theme.icon : theme.textTertiary} style={GLYPH} />
            </Animated.View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const PLATE = { width: NTP_ROUND_BUTTON.size, height: NTP_ROUND_BUTTON.size, borderRadius: capsule(NTP_ROUND_BUTTON.size), alignItems: "center", justifyContent: "center" } as const;
const GLYPH = { width: NTP_ROUND_BUTTON.size, height: NTP_ROUND_BUTTON.size, alignItems: "center", justifyContent: "center" } as const;

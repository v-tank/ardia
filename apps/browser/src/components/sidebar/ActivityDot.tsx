import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { useTheme } from "../ui/theme";
import { curve, period } from "../ui/motion";
import { reduceMotion } from "../ui/reduceMotion";
import { space } from "../ui";
import { usePageRunning } from "../../state/plugins/hooks";

const DOT = 6;
const DIM = 0.45;

export function ActivityDot({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const running = usePageRunning(tabId);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!running || reduceMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: DIM, duration: period.pulse, easing: curve.pulse, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: period.pulse, easing: curve.pulse, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [running]);
  if (!running) return null;
  return (
    <Animated.View
      accessibilityLabel="Running"
      style={{ width: DOT, height: DOT, borderRadius: DOT / 2, marginHorizontal: space.xs, backgroundColor: theme.goButton, opacity: pulse }}
    />
  );
}

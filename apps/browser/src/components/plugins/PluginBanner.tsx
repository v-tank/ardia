import { View } from "react-native";
import { Button, Symbol, Text, useTheme } from "../ui";
import { space } from "../ui/tokens";
import { usePluginBanner } from "../../state/plugins/hooks";
import { pressBannerStop } from "../../state/plugins/actions";

const BANNER_HEIGHT = 32;
const FLEX = { flex: 1 } as const;

export function PluginBanner({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const banner = usePluginBanner(tabId);
  if (!banner) return null;
  return (
    <View
      accessibilityRole="summary"
      style={{
        height: BANNER_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingLeft: space.l,
        paddingRight: space.m,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.divider,
      }}
    >
      <Symbol name="sparkles" size={12} color={theme.icon} />
      <Text lines={1} tone="textSecondary" style={FLEX}>
        {banner.text}
      </Text>
      {banner.stopping ? <Text tone="textTertiary">Stopping…</Text> : <Button variant="pill" title="Stop" onPress={() => pressBannerStop(tabId)} />}
    </View>
  );
}

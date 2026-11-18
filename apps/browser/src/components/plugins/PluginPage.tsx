import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Box, Button, PluginPageView, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { usePluginActive, usePluginNetwork, usePluginPageContext, usePluginPageSpec, usePluginPageUrl, usePluginProcess } from "../../state/plugins/hooks";
import { openPageLink, pluginPagePath } from "../../state/plugins/actions";
import { updateTab } from "../../state/tabs/actions";
import { openSettings } from "../../state/settings/settingsWindows";
import { pageLook } from "../../state/plugins/pageLook";
import { controlGlassTint, panelGlassTint, useGlass, useGlassLook } from "../ui/Glass";
import { followPage } from "../../state/plugins/pageNav";
import { activeLook } from "../../lib/activeLook";

function Notice({ title, detail, name }: { title: string; detail: string; name: string }) {
  return (
    <Box pad="xl" gap="m" style={CENTER}>
      <Text size="title" weight="semibold">
        {title}
      </Text>
      <Text tone="textSecondary">{detail}</Text>
      <Button title="Open Plugin Settings" onPress={() => openSettings("plugins", null, name)} />
    </Box>
  );
}

export function PluginPage({ tabId, name }: { tabId: string; name: string }) {
  const theme = useTheme();
  const windowId = useTab(tabId, (t) => t?.windowId ?? "");
  const path = useTab(tabId, (t) => pluginPagePath(t?.url ?? ""));
  const spec = usePluginPageSpec(name);
  const active = usePluginActive(name);
  const context = usePluginPageContext(tabId);
  const url = usePluginPageUrl(name, context, path);
  const process = usePluginProcess(name);
  const network = usePluginNetwork(name);
  const look = activeLook();
  const glass = useGlass("controls");
  const { tint } = useGlassLook();
  const passed = useMemo(() => pageLook(theme, look, glass), [theme, look, glass]);
  const glassTints = useMemo(
    () => ({
      "control-rest": controlGlassTint(theme, "rest", tint),
      "control-lit": controlGlassTint(theme, "lit", tint),
      "control-active": controlGlassTint(theme, "active", tint),
      panel: panelGlassTint(theme, theme.ntpBarSolid, tint),
      controlStrength: "0.5",
    }),
    [theme, tint],
  );
  if (!spec || !active) return <Notice name={name} title={`${spec?.title ?? name} is off`} detail="Turn the plugin on in Settings › Plugins to use its page." />;
  if (!url) {
    const failed = process?.state === "crashed" || process?.state === "failed";
    return <Notice name={name} title={failed ? `${spec.title} stopped` : `${spec.title} is starting…`} detail={failed ? "Its program isn't running. Restart it from Settings › Plugins." : "Its program is getting the page ready."} />;
  }
  return (
    <View style={[StyleSheet.absoluteFill, spec.background === "window" ? null : { backgroundColor: theme.card }]}>
      <PluginPageView style={StyleSheet.absoluteFill} plugin={name} url={url} network={network} look={passed.vars} colorScheme={passed.appearance} onOpenUrl={(e) => openPageLink(windowId, e.nativeEvent.url)} tabKey={tabId} glassTints={glassTints} onTitle={(e) => updateTab(tabId, { title: e.nativeEvent.title })} onNavigate={(e) => followPage(tabId, name, e.nativeEvent)} />
    </View>
  );
}

const CENTER = { flex: 1, alignItems: "center", justifyContent: "center" } as const;

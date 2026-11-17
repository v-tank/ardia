import { StyleSheet, View } from "react-native";
import { Box, Button, PluginPageView, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { usePluginActive, usePluginNetwork, usePluginPageContext, usePluginPageSpec, usePluginPageUrl, usePluginProcess } from "../../state/plugins/hooks";
import { openPageLink } from "../../state/plugins/actions";
import { openSettings } from "../../state/settings/settingsWindows";

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
  const spec = usePluginPageSpec(name);
  const active = usePluginActive(name);
  const context = usePluginPageContext(tabId);
  const url = usePluginPageUrl(name, context);
  const process = usePluginProcess(name);
  const network = usePluginNetwork(name);
  if (!spec || !active) return <Notice name={name} title={`${spec?.title ?? name} is off`} detail="Turn the plugin on in Settings › Plugins to use its page." />;
  if (!url) {
    const failed = process?.state === "crashed" || process?.state === "failed";
    return <Notice name={name} title={failed ? `${spec.title} stopped` : `${spec.title} is starting…`} detail={failed ? "Its program isn't running. Restart it from Settings › Plugins." : "Its program is getting the page ready."} />;
  }
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.card }]}>
      <PluginPageView style={StyleSheet.absoluteFill} plugin={name} url={url} network={network} onOpenUrl={(e) => openPageLink(windowId, e.nativeEvent.url)} />
    </View>
  );
}

const CENTER = { flex: 1, alignItems: "center", justifyContent: "center" } as const;

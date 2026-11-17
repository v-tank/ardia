import { memo } from "react";
import { View } from "react-native";
import { Button } from "../ui";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { pressPluginToolbarButton, type PluginToolbarButton } from "../../state/plugins/actions";
import { usePluginToolbarButtons } from "../../state/plugins/hooks";
import { PLUGIN_BUTTONS } from "./tokens";

export const PluginToolbarButtons = memo(function PluginToolbarButtons({ windowId, palette, top, right, onFocus }: { windowId: string; palette: ToolbarPalette; top: number; right: number; onFocus: () => void }) {
  const buttons = usePluginToolbarButtons();
  if (!buttons.length) return null;
  return (
    <View style={{ position: "absolute", top, right, flexDirection: "row", gap: PLUGIN_BUTTONS.gap }}>
      {buttons.map((b) => (
        <PluginButton key={b.id} button={b} windowId={windowId} palette={palette} onFocus={onFocus} />
      ))}
    </View>
  );
});

function PluginButton({ button, windowId, palette, onFocus }: { button: PluginToolbarButton; windowId: string; palette: ToolbarPalette; onFocus: () => void }) {
  const hint = useShortcutHint(`runPluginCommand:${button.id}`);
  return (
    <Button
      variant="icon"
      toolbar
      palette={palette}
      icon={button.icon}
      look="row"
      tooltip={withShortcut(button.title, hint)}
      onPress={() => {
        onFocus();
        pressPluginToolbarButton(button.id, windowId);
      }}
    />
  );
}

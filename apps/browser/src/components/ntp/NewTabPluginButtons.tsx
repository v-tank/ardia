import { View } from "react-native";
import { useNewTabButtons } from "../../state/plugins/hooks";
import { openNewTabButton } from "../../state/plugins/actions";
import { NtpRoundButton } from "./NtpRoundButton";
import { INSET } from "./Personalize";
import { NTP_ROUND_BUTTON } from "./tokens";

export function NewTabPluginButtons({ windowId }: { windowId: string }) {
  const buttons = useNewTabButtons();
  if (!buttons.length) return null;
  return (
    <View style={{ position: "absolute", left: INSET, bottom: INSET - NTP_ROUND_BUTTON.glyphDrop, flexDirection: "row", gap: NTP_ROUND_BUTTON.gap }}>
      {buttons.map((b) => (
        <NtpRoundButton key={b.plugin} icon={b.icon} label={b.title} onPress={() => void openNewTabButton(windowId, b.plugin)} />
      ))}
    </View>
  );
}

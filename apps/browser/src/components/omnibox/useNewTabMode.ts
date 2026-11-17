import { useState } from "react";
import { useNewTabModes, type NewTabModeOption } from "../../state/plugins/hooks";
import { newTabModeTarget, nextMode, noteNewTabModeSubmit, noteNewTabModeSwitch, shownMode, startingMode } from "../../state/plugins/actions";
import type { BarKeyEvent } from "./omniboxKeys";

const NO_MODES: readonly NewTabModeOption[] = [];
const HELD_KEYS: ReadonlySet<string> = new Set(["Tab", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]);

export function useNewTabMode(newTabBox: boolean) {
  const offered = useNewTabModes();
  const modes = newTabBox ? offered : NO_MODES;
  const [picked, setPicked] = useState<{ plugin: string | null } | null>(null);
  const chosen = picked ? picked.plugin : startingMode(modes);
  const mode = shownMode(chosen, modes);
  const switchTo = (plugin: string | null) => {
    noteNewTabModeSwitch();
    setPicked({ plugin });
  };
  const keyDown = (e: BarKeyEvent, empty: boolean, submit: () => void): boolean => {
    const { key, shiftKey, metaKey, altKey, ctrlKey } = e.nativeEvent;
    if (modes.length && key === "Tab" && !metaKey && !altKey && !ctrlKey && empty) return (switchTo(nextMode(chosen, modes, shiftKey)), true);
    if (mode && key === "Enter") return (submit(), true);
    return !!mode && HELD_KEYS.has(key);
  };
  const ask = (text: string, go: (url: string) => void) => {
    const target = mode && newTabModeTarget(mode.plugin, text);
    if (!target) return;
    if (target.asked) noteNewTabModeSubmit();
    go(target.url);
  };
  return { modes, mode, switchTo, keyDown, ask };
}

import { PLUGIN_BUTTONS } from "./tokens";

export function pluginButtonsWidth(count: number, button: number): number {
  return count ? count * button + (count - 1) * PLUGIN_BUTTONS.gap : 0;
}

export function toolbarTrailingWidth(extensionsWidth: number, pluginCount: number, button: number): number {
  if (!pluginCount) return extensionsWidth;
  return extensionsWidth + pluginButtonsWidth(pluginCount, button) + (extensionsWidth ? PLUGIN_BUTTONS.besideExtensions : PLUGIN_BUTTONS.alone);
}

export function pluginButtonsRight(trailingStart: number, extensionsWidth: number): number {
  return trailingStart + (extensionsWidth ? extensionsWidth - PLUGIN_BUTTONS.extensionsInset + PLUGIN_BUTTONS.gap : 0);
}

import { fixupUrl } from "@ardia/core";
import { modePagePath, modeStartsOn, pagePathOf } from "../../lib/pluginSurfaces";
import { randomUuid } from "../../platform/secureRandom";
import { notePlugin } from "../telemetry/pluginCounts";
import { openPluginPage } from "./pages";
import { pluginPageOf, pluginPagePath, pluginPageUrl } from "./pageNames";
import { useBrowser } from "../browser/store";
import { activeTabId, viewTabIds } from "../browser/model";
import { activeManifest, activeNames, currentPlugins, usePlugins, type PluginsStore } from "./store";
import { valuesOf } from "./values";

export type NewTabModeOption = { plugin: string; title: string; placeholder: string; icon: string; startsOn: boolean };
export type NewTabButtonOption = { plugin: string; title: string; icon: string };

type Plugins = Pick<PluginsStore, "listings" | "records" | "order">;

export function pluginNewTabModes(s: Plugins): NewTabModeOption[] {
  return activeNames(s).flatMap((plugin) => {
    const m = activeManifest(s, plugin)!;
    const mode = m.newTab?.mode;
    return mode ? [{ plugin, title: mode.title, placeholder: mode.placeholder, icon: m.page?.icon ?? "puzzlepiece", startsOn: modeStartsOn(mode, valuesOf(s, plugin)) }] : [];
  });
}

export function pluginNewTabButtons(s: Plugins): NewTabButtonOption[] {
  return activeNames(s).flatMap((plugin) => {
    const button = activeManifest(s, plugin)!.newTab?.button;
    return button ? [{ plugin, title: button.title, icon: button.icon }] : [];
  });
}

export const startingMode = (modes: readonly NewTabModeOption[]): string | null => modes.find((m) => m.startsOn)?.plugin ?? null;

export const shownMode = (chosen: string | null, modes: readonly NewTabModeOption[]): NewTabModeOption | null => modes.find((m) => m.plugin === chosen) ?? null;

export function nextMode(chosen: string | null, modes: readonly NewTabModeOption[], back = false): string | null {
  const order = [null, ...modes.map((m) => m.plugin)];
  const at = Math.max(0, order.indexOf(shownMode(chosen, modes)?.plugin ?? null));
  return order[(at + (back ? order.length - 1 : 1)) % order.length] ?? null;
}

export function newTabModeUrl(plugin: string, text: string, id: string = randomUuid()): string | null {
  const mode = activeManifest(currentPlugins(), plugin)?.newTab?.mode;
  return mode ? pluginPageUrl(plugin, modePagePath(mode, id, text)) : null;
}

export function newTabModeTarget(plugin: string, text: string): { url: string; asked: boolean } | null {
  const typed = fixupUrl(text.trim());
  if (typed) return { url: typed, asked: false };
  const url = text.trim() ? newTabModeUrl(plugin, text) : null;
  return url ? { url, asked: true } : null;
}

export const noteNewTabModeSubmit = () => notePlugin("plugin_newtab_asks");
export const noteNewTabModeSwitch = () => notePlugin("plugin_newtab_mode_switches");

export function openNewTabButton(windowId: string, plugin: string): string | null {
  const button = activeManifest(currentPlugins(), plugin)?.newTab?.button;
  if (!button) return null;
  notePlugin("plugin_newtab_button_presses");
  const path = pagePathOf(button.path, randomUuid());
  const s = useBrowser.getState();
  const active = activeTabId(s, windowId);
  const open = viewTabIds(s, windowId).some((id) => pluginPageOf(s.tabs[id]?.url) === plugin && pluginPagePath(s.tabs[id]?.url ?? "") === path);
  if (!active || s.tabs[active]?.url || open) return openPluginPage(windowId, plugin, { path });
  notePlugin("plugin_page_opens");
  s.navigate(active, pluginPageUrl(plugin, path));
  return active;
}

const stable = <T>() => {
  let last: { key: string; value: T[] } | null = null;
  return (value: T[]) => {
    const key = JSON.stringify(value);
    if (last?.key !== key) last = { key, value };
    return last.value;
  };
};
const stableModes = stable<NewTabModeOption>();
const stableButtons = stable<NewTabButtonOption>();

export const useNewTabModes = () => usePlugins((s) => stableModes(pluginNewTabModes(s)));
export const useNewTabButtons = () => usePlugins((s) => stableButtons(pluginNewTabButtons(s)));

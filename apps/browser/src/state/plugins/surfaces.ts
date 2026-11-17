import { comboKey, type Shortcut, type ShortcutSource } from "../commands/shortcuts";
import { setPluginShortcutSources } from "../commands/commandShortcuts";
import { parseConfigShortcut } from "../config/configShortcuts";
import { notePlugin } from "../telemetry/pluginCounts";
import { PLUGIN_ACTION_PREFIX, runPluginAction } from "./commands";
import { activeManifest, activeNames, currentPlugins, usePlugins, type PluginsStore } from "./store";

export const PLUGIN_COMMAND = "runPluginCommand";

export type PluginToolbarButton = { id: string; plugin: string; title: string; icon: string };

type Plugins = Pick<PluginsStore, "listings" | "records" | "order">;

export function pluginToolbarButtons(s: Plugins): PluginToolbarButton[] {
  return activeNames(s).flatMap((plugin) => {
    const toolbar = activeManifest(s, plugin)!.toolbar;
    return toolbar ? [{ id: `${plugin}/${toolbar.command}`, plugin, title: toolbar.title, icon: toolbar.icon }] : [];
  });
}

export const pluginMenuCommands = (s: Plugins = currentPlugins()) => pluginToolbarButtons(s).map(({ id, title, icon }) => ({ id, title, icon }));

export function pluginShortcutSources(s: Plugins): ShortcutSource[] {
  const taken = new Set<string>();
  return activeNames(s).flatMap((plugin) => {
    const toolbar = activeManifest(s, plugin)!.toolbar;
    if (!toolbar) return [];
    const parsed: Shortcut | null = toolbar.shortcut ? parseConfigShortcut(toolbar.shortcut) : null;
    const free = parsed && !taken.has(comboKey(parsed)) ? parsed : null;
    if (free) taken.add(comboKey(free));
    return [{ id: `${PLUGIN_COMMAND}:${plugin}/${toolbar.command}`, keys: free ? [free] : [] }];
  });
}

export function runPluginCommand(id: string, windowId: string, from: "toolbar" | "menu") {
  notePlugin(from === "toolbar" ? "plugin_toolbar_presses" : "plugin_menu_runs");
  return runPluginAction(`${PLUGIN_ACTION_PREFIX}${id}`, windowId);
}

let watching = false;

export function watchPluginSurfaces() {
  if (watching) return;
  watching = true;
  let last = "";
  const push = (s: Plugins) => {
    const sources = pluginShortcutSources(s);
    const key = JSON.stringify(sources);
    if (key === last) return;
    last = key;
    setPluginShortcutSources(sources);
  };
  push(currentPlugins());
  usePlugins.subscribe((s, prev) => {
    if (s.listings !== prev.listings || s.records !== prev.records || s.order !== prev.order) push(s);
  });
}

export const usePluginToolbarButtons = () => usePlugins((s) => stableToolbarButtons(s));

const toolbarCache = new Map<string, PluginToolbarButton[]>();

function stableToolbarButtons(s: Plugins): PluginToolbarButton[] {
  const buttons = pluginToolbarButtons(s);
  const key = JSON.stringify(buttons);
  const cached = toolbarCache.get(key);
  if (cached) return cached;
  toolbarCache.clear();
  toolbarCache.set(key, buttons);
  return buttons;
}

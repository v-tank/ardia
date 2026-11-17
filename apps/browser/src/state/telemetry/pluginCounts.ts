import { contributionsOf, CONTRIBUTIONS, type PluginManifest } from "../../lib/pluginManifest";
import { isFirstPartyPlugin } from "../../lib/pluginTelemetry";
import { activeManifest, usePlugins } from "../plugins/store";

const NONE = {
  plugin_enables: 0,
  plugin_disables: 0,
  plugin_process_starts: 0,
  plugin_process_crashes: 0,
  plugin_commands_run: 0,
  plugin_tool_calls: 0,
  plugin_tool_failures: 0,
  plugin_page_opens: 0,
  plugin_split_opens: 0,
  plugin_arrange_calls: 0,
  plugin_arrange_failures: 0,
  plugin_browse_calls: 0,
  plugin_browse_failures: 0,
  plugin_browse_leases: 0,
  plugin_banners_shown: 0,
  plugin_banner_stops: 0,
  plugin_values_set: 0,
  plugin_toolbar_presses: 0,
  plugin_menu_runs: 0,
};

export type PluginCount = keyof typeof NONE;

let counts = { ...NONE };
let ownCounters: Record<string, number> = {};

export const notePlugin = (what: PluginCount) => void counts[what]++;

export function notePluginCounter(plugin: string, counter: string, n: number): boolean {
  if (!isFirstPartyPlugin(plugin)) return false;
  const key = `plugin_${plugin}_${counter}`;
  ownCounters[key] = (ownCounters[key] ?? 0) + n;
  return true;
}

export function takePluginCounts(): typeof NONE & Record<string, number> {
  const taken = { ...ownCounters, ...counts };
  counts = { ...NONE };
  ownCounters = {};
  return taken;
}

export function pluginsSetting(installed: number, active: readonly PluginManifest[]): Record<string, string> {
  const used = Object.fromEntries(CONTRIBUTIONS.map((c) => [`plugins_with_${c}`, 0]));
  for (const m of active) for (const c of contributionsOf(m)) used[`plugins_with_${c}`]! += 1;
  return {
    plugins_installed: String(installed),
    plugins_enabled: String(active.length),
    ...Object.fromEntries(Object.entries(used).map(([k, v]) => [k, String(v)])),
  };
}

export function pluginsSnapshot(): Record<string, string> {
  const plugins = usePlugins.getState();
  if (!plugins.loaded) return {};
  return pluginsSetting(plugins.order.length, plugins.order.flatMap((name) => activeManifest(plugins, name) ?? []));
}

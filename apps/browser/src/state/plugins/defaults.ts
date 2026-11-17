import { isFields } from "../../lib/decode";
import type { PluginManifest } from "../../lib/pluginManifest";
import { readConfigFile } from "../../platform/configFolder";
import { useBrowser } from "../browser/store";
import { checkedSettings, CONFIG_FILE, sameValue } from "../config/configSettings";
import type { Settings } from "../settings/settings";
import type { PluginRecord } from "./store";

export function keysConfigSets(): ReadonlySet<string> {
  try {
    const read = readConfigFile(CONFIG_FILE);
    if (read.status !== "ok") return new Set();
    const doc: unknown = JSON.parse(read.text);
    return isFields(doc) && isFields(doc.settings) ? new Set(Object.keys(doc.settings)) : new Set();
  } catch {
    return new Set();
  }
}

type Step = PluginRecord["applied"][string];
export type Claims = ReadonlyMap<string, Step>;

export function claimsOf(records: Record<string, PluginRecord>, except: string): Claims {
  const claims = new Map<string, Step>();
  for (const [name, record] of Object.entries(records)) {
    if (name === except || !record.enabled) continue;
    for (const [key, step] of Object.entries(record.applied)) claims.set(key, step);
  }
  return claims;
}

export function planDefaults(m: PluginManifest, settings: Settings, fileKeys: ReadonlySet<string>, claims: Claims = new Map()): { patch: Partial<Settings>; applied: PluginRecord["applied"] } {
  const { values } = checkedSettings("plugin.json", m.settings.defaults, settings);
  const patch: Record<string, unknown> = {};
  const applied: PluginRecord["applied"] = {};
  for (const [key, value] of Object.entries(values)) {
    if (fileKeys.has(key)) continue;
    const previous = settings[key as keyof Settings];
    const claim = claims.get(key);
    if (sameValue(previous, value)) {
      if (claim && sameValue(claim.value, value)) applied[key] = { value, previous: claim.previous };
      continue;
    }
    patch[key] = value;
    applied[key] = { value, previous };
  }
  return { patch: patch as Partial<Settings>, applied };
}

export function planRestore(applied: PluginRecord["applied"], settings: Settings, claims: Claims = new Map()): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const [key, { value, previous }] of Object.entries(applied)) {
    if (!(key in settings)) continue;
    const claim = claims.get(key);
    if (claim && sameValue(claim.value, settings[key as keyof Settings])) continue;
    if (sameValue(settings[key as keyof Settings], value)) patch[key] = previous;
  }
  return patch as Partial<Settings>;
}

export function spliceApplied(records: Record<string, PluginRecord>, leaving: string): Record<string, PluginRecord> {
  const gone = records[leaving]?.applied ?? {};
  const out = { ...records };
  for (const [name, record] of Object.entries(records)) {
    if (name === leaving || !record.enabled) continue;
    let applied = record.applied;
    for (const [key, step] of Object.entries(gone)) {
      const mine = applied[key];
      if (mine && sameValue(mine.previous, step.value)) applied = { ...applied, [key]: { value: mine.value, previous: step.previous } };
    }
    if (applied !== record.applied) out[name] = { ...record, applied };
  }
  return out;
}

export function applyDefaults(m: PluginManifest, claims: Claims = new Map()): PluginRecord["applied"] {
  const s = useBrowser.getState();
  const { patch, applied } = planDefaults(m, s.settings, keysConfigSets(), claims);
  if (Object.keys(patch).length) s.updateSettings(patch);
  return applied;
}

export function restoreDefaults(applied: PluginRecord["applied"], claims: Claims = new Map()) {
  const s = useBrowser.getState();
  const patch = planRestore(applied, s.settings, claims);
  if (Object.keys(patch).length) s.updateSettings(patch);
}

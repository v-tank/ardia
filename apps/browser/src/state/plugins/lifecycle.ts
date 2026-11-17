import { defaultValues, rowValue } from "../../lib/pluginManifest";
import { listPluginFolders, removePluginFiles, type PluginFolderEntry } from "../../platform/plugins";
import { systemInfo } from "../../platform/app";
import { onConfigChange } from "../../platform/configFolder";
import { useBrowser } from "../browser/store";
import { notePlugin } from "../telemetry/pluginCounts";
import { listingOf } from "./appChecks";
import { applyDefaults, claimsOf, restoreDefaults, spliceApplied } from "./defaults";
import { writePluginRecords } from "./savedState";
import { activeManifest, currentPlugins, NO_RECORD, recordOf, usePlugins, type PluginListing, type PluginRecord } from "./store";
import { stopProcess, superviseProcess, supervisedNames } from "./process";
import { dropCalls } from "./tools";
import { sendValues } from "./channel";

export const MAX_PLUGINS = 64;

const READ_PROBLEMS: Record<Exclude<PluginFolderEntry["status"], "ok">, string> = {
  missing: "The folder has no plugin.json",
  notFile: "plugin.json isn't a file",
  tooBig: "plugin.json is over 1 MB",
  unreadable: "plugin.json couldn't be read",
};

export function listingsOf(entries: PluginFolderEntry[]): PluginListing[] {
  const settings = useBrowser.getState().settings;
  const version = systemInfo().appVersion;
  return entries
    .slice(0, MAX_PLUGINS)
    .map((e) => listingOf(e.name, e.status === "ok" ? (e.text ?? "") : null, e.status === "ok" ? null : READ_PROBLEMS[e.status], settings, version, e.folderId ?? ""));
}

function saveRecords(records: Record<string, PluginRecord>): boolean {
  if (!writePluginRecords(records)) return false;
  usePlugins.setState({ records });
  return true;
}

function updateRecord(name: string, change: (r: PluginRecord) => PluginRecord | null): boolean {
  const records = { ...currentPlugins().records };
  const next = change(recordOf(currentPlugins(), name));
  if (next) records[name] = next;
  else delete records[name];
  return saveRecords(records);
}

export function reconcilePlugins() {
  const s = currentPlugins();
  const active = new Set<string>();
  for (const name of s.order) {
    const manifest = activeManifest(s, name);
    if (!manifest) continue;
    active.add(name);
    if (manifest.process) superviseProcess(name, s.listings[name]!.hash!, manifest);
    else stopProcess(name);
  }
  for (const name of supervisedNames()) if (!active.has(name)) stopProcess(name);
  for (const name of Object.keys(s.servedUrls)) if (!active.has(name)) withdraw(name);
}

function withdraw(name: string) {
  dropCalls(name);
  usePlugins.setState((s) => {
    const servedUrls = { ...s.servedUrls };
    delete servedUrls[name];
    return { servedUrls };
  });
}

export function applyListings(listings: PluginListing[]) {
  const byName = Object.fromEntries(listings.map((l) => [l.name, l]));
  usePlugins.setState({ listings: byName, order: listings.map((l) => l.name).sort() });
  reconcilePlugins();
}

let scanning: Promise<void> | null = null;
let again = false;

export function rescanPlugins(): Promise<void> {
  if (scanning) {
    again = true;
    return scanning;
  }
  scanning = (async () => {
    do {
      again = false;
      const entries = await listPluginFolders().catch((error: unknown) => {
        console.warn("[plugins] couldn't list the plugins folder", error);
        return null;
      });
      if (entries) applyListings(listingsOf(entries));
    } while (again);
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

export function requestPluginConsent(name: string): boolean {
  const listing = currentPlugins().listings[name];
  if (!listing?.manifest || !listing.hash) return false;
  usePlugins.setState({ consent: { name, hash: listing.hash } });
  return true;
}

export const dismissPluginConsent = () => usePlugins.setState({ consent: null });

export function enablePlugin(name: string, hash: string): boolean {
  const listing = currentPlugins().listings[name];
  if (!listing?.manifest || listing.hash !== hash) return false;
  const manifest = listing.manifest;
  const before = recordOf(currentPlugins(), name);
  const values = { ...defaultValues(manifest), ...before.values };
  const kept = before.enabled && before.approved === hash;
  const claims = claimsOf(currentPlugins().records, name);
  if (!kept) restoreDefaults(before.applied, claims);
  const applied = kept ? before.applied : applyDefaults(manifest, claims);
  const saved = updateRecord(name, () => ({ enabled: true, approved: hash, values, applied }));
  if (!saved) return false;
  usePlugins.setState({ consent: null });
  notePlugin("plugin_enables");
  reconcilePlugins();
  return true;
}

export function disablePlugin(name: string): boolean {
  const before = recordOf(currentPlugins(), name);
  if (!before.enabled) return true;
  restoreDefaults(before.applied, claimsOf(currentPlugins().records, name));
  const records = spliceApplied(currentPlugins().records, name);
  const saved = saveRecords({ ...records, [name]: { ...before, enabled: false, applied: {} } });
  notePlugin("plugin_disables");
  reconcilePlugins();
  return saved;
}

export async function removePlugin(name: string): Promise<{ ok: boolean; reason?: string }> {
  disablePlugin(name);
  const removed = await removePluginFiles(name).catch((error: unknown) => ({ ok: false as const, reason: String(error) }));
  if (!removed.ok) return removed;
  updateRecord(name, () => null);
  await rescanPlugins();
  return { ok: true };
}

export function setPluginValue(name: string, key: string, value: string | boolean) {
  const row = currentPlugins().listings[name]?.manifest?.settings.rows.find((r) => r.key === key);
  if (!row || rowValue(row, value) !== value) return;
  if (!updateRecord(name, (r) => ({ ...(r === NO_RECORD ? { ...NO_RECORD } : r), values: { ...r.values, [key]: value } }))) return;
  if (activeManifest(currentPlugins(), name)) sendValues(name);
}

let started = false;

export { loadPluginRecords } from "./records";

export function watchPluginFolder() {
  if (started) return;
  started = true;
  onConfigChange(() => void rescanPlugins());
}

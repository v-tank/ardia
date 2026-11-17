import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { loadPluginRecords } from "./records";
import { usePlugins } from "./store";

const PAGE_URL = /^ardia:\/\/([a-z0-9][a-z0-9-]{0,39})\/?(?:[?#].*)?$/i;

export const pluginPageUrl = (name: string) => `ardia://${name}`;

export function pluginPageOf(url: string | null | undefined): string | null {
  if (!url || !PLATFORM_FEATURES.plugins) return null;
  const name = PAGE_URL.exec(url)?.[1]?.toLowerCase();
  if (!name) return null;
  loadPluginRecords();
  const s = usePlugins.getState();
  return s.listings[name]?.manifest?.page || s.records[name] ? name : null;
}

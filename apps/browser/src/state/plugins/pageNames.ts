import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { loadPluginRecords } from "./records";
import { usePlugins } from "./store";

const PAGE_URL = /^ardia:\/\/([a-z0-9][a-z0-9-]{0,39})(\/[^?#]*)?(\?[^#]*)?(?:#.*)?$/i;
const PAGE_PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*(\?[^#\s]*)?$/;
export const MAX_PAGE_PATH = 512;

export const isPagePath = (path: string) => path.length <= MAX_PAGE_PATH && (path === "" || PAGE_PATH.test(path)) && !path.split(/[/?]/).some((part) => part === "..");

export const pluginPageUrl = (name: string, path = "") => `ardia://${name}${path}`;

export function pluginPagePath(url: string): string {
  const m = PAGE_URL.exec(url);
  const path = `${m?.[2] && m[2] !== "/" ? m[2] : ""}${m?.[3] ?? ""}`;
  return isPagePath(path) ? path : "";
}

export function pluginPageOf(url: string | null | undefined): string | null {
  if (!url || !PLATFORM_FEATURES.plugins) return null;
  const name = PAGE_URL.exec(url)?.[1]?.toLowerCase();
  if (!name) return null;
  loadPluginRecords();
  const s = usePlugins.getState();
  return s.listings[name]?.manifest?.page || s.records[name] ? name : null;
}

import { useShallow } from "zustand/react/shallow";
import { activeManifest, needsReview, recordOf, usePlugins, type PluginsStore } from "./store";
import { pageViewUrl, usePluginPages } from "./pages";
import { valuesOf } from "./values";

export const usePluginOrder = () => usePlugins((s) => s.order);
export const usePluginListing = (name: string) => usePlugins((s) => s.listings[name]);
export const usePluginRecord = (name: string) => usePlugins((s) => recordOf(s, name));
export const usePluginActive = (name: string) => usePlugins((s) => !!activeManifest(s, name));
export const usePluginNeedsReview = (name: string) => usePlugins((s) => needsReview(s, name));
export const usePluginProcess = (name: string) => usePlugins((s) => s.processes[name]);
export const usePluginConsent = () => usePlugins((s) => s.consent);
export const usePluginValues = (name: string) => usePlugins(useShallow((s: PluginsStore) => valuesOf(s, name)));
export const usePluginPageContext = (tabId: string) => usePluginPages((s) => s.contexts[tabId] ?? null);
export const usePluginPageUrl = (name: string, context: Parameters<typeof pageViewUrl>[2], path: string) => usePlugins((s) => pageViewUrl(s, name, context, path));
export const usePluginNetwork = (name: string) => usePlugins((s) => !!activeManifest(s, name)?.permissions.includes("network"));
export const usePluginPageSpec = (name: string) => usePlugins((s) => s.listings[name]?.manifest?.page ?? null);

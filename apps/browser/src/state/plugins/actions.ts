import { pluginsFolder, revealPluginLog, revealPluginsFolder } from "../../platform/plugins";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";

export { disablePlugin, dismissPluginConsent, enablePlugin, removePlugin, requestPluginConsent, setPluginValue } from "./lifecycle";
export { restartProcess as restartPlugin } from "./process";
export { openPageLink, openPluginPage } from "./pages";
export { consentLines, type ConsentLine } from "./consent";

export const showPluginLog = (name: string) => revealPluginLog(name);
export const showPluginsFolder = () => revealPluginsFolder();
export const pluginsFolderPath = () => (PLATFORM_FEATURES.plugins ? pluginsFolder() : "");

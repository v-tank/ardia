import { pluginsFolder, revealPluginLog, revealPluginsFolder } from "../../platform/plugins";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { runPluginCommand } from "./surfaces";

export { disablePlugin, dismissPluginConsent, enablePlugin, removePlugin, requestPluginConsent, setPluginValue } from "./lifecycle";
export { restartProcess as restartPlugin } from "./process";
export { openPageLink, openPluginPage, pluginPagePath } from "./pages";
export { consentLines, type ConsentLine } from "./consent";

export const showPluginLog = (name: string) => revealPluginLog(name);
export const showPluginsFolder = () => revealPluginsFolder();
export const pluginsFolderPath = () => (PLATFORM_FEATURES.plugins ? pluginsFolder() : "");
export { pressBannerStop } from "./banners";
export type { PluginToolbarButton } from "./surfaces";
export { newTabModeTarget, nextMode, noteNewTabModeSubmit, noteNewTabModeSwitch, openNewTabButton, shownMode, startingMode } from "./newTab";
export const pressPluginToolbarButton = (id: string, windowId: string) => void runPluginCommand(id, windowId, "toolbar");

import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { handlePluginSocketMethods } from "../automation/controlSocket";
import { startChannels } from "./channel";
import { loadPluginRecords, rescanPlugins, watchPluginFolder } from "./lifecycle";
import { pluginSocketMethod } from "./socketMethods";

let started = false;

export function startPlugins() {
  if (started || !PLATFORM_FEATURES.plugins) return;
  started = true;
  loadPluginRecords();
  startChannels();
  handlePluginSocketMethods(pluginSocketMethod);
  watchPluginFolder();
  void rescanPlugins();
}

import type { PluginManifest } from "../../lib/pluginManifest";
import { failure } from "../automation/automationMethods";
import type { Body } from "../automation/controlSocket";
import { notePlugin } from "../telemetry/pluginCounts";
import { groupWithPage, pluginApply, pluginWorkspace, splitToGroup } from "./arrange";
import { setBanner } from "./banners";
import { pluginBrowse } from "./browse";
import { setPluginValue } from "./lifecycle";

function setValue(name: string, params: Record<string, unknown>): Body {
  if (typeof params.key !== "string") return failure("bad_request", "values.set needs a key: one of this plugin's settings rows.");
  const problem = setPluginValue(name, params.key, params.value);
  if (problem) return failure("bad_request", problem);
  notePlugin("plugin_values_set");
  return { result: { ok: true } };
}

export function answerPluginMethod(name: string, m: PluginManifest, method: string, params: Record<string, unknown>): Body | Promise<Body> | null {
  switch (method) {
    case "workspace":
      return pluginWorkspace(m, params);
    case "apply":
      return pluginApply(name, m, params);
    case "group.withPage":
      return groupWithPage(name, m, params);
    case "split.toGroup":
      return splitToGroup(name, m, params);
    case "browse":
      return pluginBrowse(name, m, params);
    case "tab.banner":
      return setBanner(name, m, params);
    case "values.set":
      return setValue(name, params);
  }
  return null;
}

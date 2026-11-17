import type { PluginManifest } from "../../lib/pluginManifest";
import { minimizedUrl } from "../../lib/urlParts";
import { useBrowser } from "../browser/store";
import { innermostGroupOf } from "../groups/groups";
import { splitOf, splitTabIds } from "../splits/splits";
import { failure } from "../automation/automationMethods";
import { isEligibleTab, ownEntry } from "../automation/automationWindows";
import type { Body } from "../automation/controlSocket";
import { applyMethod, workspaceMethod, type ApplyResult } from "../automation/workspaceMethods";
import type { GroupNode, TabNode, Workspace } from "../automation/workspaceTree";
import { notePlugin } from "../telemetry/pluginCounts";
import { pluginPageOf } from "./pageNames";
import { activeManifest, currentPlugins } from "./store";

export const PAGE_GROUP_ICON = "symbol:sparkles";
const MAX_TABS = 100;

type Node = TabNode | GroupNode | { type: "folder"; id: string; name: string; items: TabNode[] };

const has = (m: PluginManifest, permission: PluginManifest["permissions"][number]) => m.permissions.includes(permission);

function shownNode<T extends Node>(node: T): T {
  if (node.type === "tab") return { ...node, url: minimizedUrl(node.url) };
  return { ...node, items: node.items.map((item) => shownNode(item as Node)) };
}

function shownWorkspace(w: Workspace, full: boolean): Workspace {
  if (full) return w;
  return {
    ...w,
    windows: w.windows.map((win) => ({
      ...win,
      spaces: win.spaces.map((sp) => ({ ...sp, topApps: sp.topApps.map(shownNode), pinned: sp.pinned.map(shownNode), tabs: sp.tabs.map(shownNode) })),
    })),
  };
}

const settle = (body: Body | Promise<Body>) => Promise.resolve(body);

export async function pluginWorkspace(m: PluginManifest, params: Record<string, unknown>): Promise<Body> {
  if (!has(m, "tabs")) return failure("refused", "workspace needs the tabs permission.");
  const body = await settle(workspaceMethod(params));
  return "result" in body ? { result: shownWorkspace(body.result as Workspace, has(m, "fullUrls")) } : body;
}

const countEdits = (_tabs: number, _groups: number, failures: number) => {
  notePlugin("plugin_arrange_calls");
  if (failures) notePlugin("plugin_arrange_failures");
};

function shownApply(result: ApplyResult, full: boolean): ApplyResult {
  return full ? result : { ...result, tabs: result.tabs.map((t) => ({ ...t, url: minimizedUrl(t.url) })) };
}

async function applyFor(name: string, m: PluginManifest, params: Record<string, unknown>): Promise<Body> {
  const body = await settle(applyMethod(params, () => !!activeManifest(currentPlugins(), name), countEdits));
  return "result" in body ? { result: shownApply(body.result as ApplyResult, has(m, "fullUrls")) } : body;
}

export function pluginApply(name: string, m: PluginManifest, params: Record<string, unknown>): Promise<Body> {
  if (!has(m, "arrange")) return Promise.resolve(failure("refused", "apply needs the arrange permission."));
  return applyFor(name, m, params);
}

function ownPageTab(name: string, tab: unknown): string | Body {
  const s = useBrowser.getState();
  const t = ownEntry(s.tabs, tab);
  if (typeof tab !== "string" || !t) return failure("bad_request", "tab is the id of one of this plugin's page tabs.");
  if (!isEligibleTab(s, tab) || pluginPageOf(t.url) !== name) return failure("refused", `Tab ${tab} isn't one of this plugin's page tabs.`);
  return tab;
}

function pageTitle(name: string, tab: string): string {
  const t = useBrowser.getState().tabs[tab];
  const title = (t?.customTitle || t?.title || "").trim();
  return (title || activeManifest(currentPlugins(), name)?.page?.title || name).slice(0, 200);
}

function settled(group: string): Body {
  const g = useBrowser.getState().groups[group];
  return g ? { result: { group, tabs: [...g.tabIds] } } : failure("failed", "The group didn't stay.");
}

async function grouped(name: string, m: PluginManifest, ops: Record<string, unknown>[], fallback: string | null): Promise<Body> {
  const body = await applyFor(name, m, { ops });
  if (!("result" in body)) return body;
  const result = body.result as ApplyResult;
  if (!result.ok && result.error) return failure(result.error.code, result.error.message);
  const group = result.results.at(-1)?.group ?? fallback;
  return group ? settled(group) : failure("failed", "The group couldn't be made.");
}

export function groupWithPage(name: string, m: PluginManifest, params: Record<string, unknown>): Promise<Body> | Body {
  if (!has(m, "arrange")) return failure("refused", "group.withPage needs the arrange permission.");
  const tab = ownPageTab(name, params.tab);
  if (typeof tab !== "string") return tab;
  const given = params.tabs ?? [];
  if (!Array.isArray(given) || given.length > MAX_TABS || !given.every((id) => typeof id === "string")) return failure("bad_request", `tabs is a list of at most ${MAX_TABS} tab ids.`);
  const tabs = [...new Set(given as string[])].filter((id) => id !== tab);
  const s = useBrowser.getState();
  const group = innermostGroupOf(s.groups, tab);
  if (group) return tabs.length ? grouped(name, m, [{ op: "tab.move", tabs, group: group.id, after: tab }], group.id) : settled(group.id);
  if (splitOf(s, tab)) return failure("in_split", `Tab ${tab} is in a Split View; split.toGroup turns the split into a group.`);
  return grouped(name, m, [{ op: "group.create", tabs: [tab, ...tabs], name: pageTitle(name, tab), icon: PAGE_GROUP_ICON }], null);
}

export function splitToGroup(name: string, m: PluginManifest, params: Record<string, unknown>): Promise<Body> | Body {
  if (!has(m, "arrange")) return failure("refused", "split.toGroup needs the arrange permission.");
  const tab = ownPageTab(name, params.tab);
  if (typeof tab !== "string") return tab;
  const s = useBrowser.getState();
  const split = splitOf(s, tab);
  if (!split) return failure("not_in_split", `Tab ${tab} isn't in a Split View.`);
  const panes = splitTabIds(split);
  const ordered = [tab, ...panes.filter((id) => id !== tab)];
  const group = innermostGroupOf(s.groups, tab);
  s.separateSplit(split.id);
  if (group) {
    countEdits(1, 0, 0);
    return settled(group.id);
  }
  return grouped(name, m, [{ op: "group.create", tabs: ordered, name: pageTitle(name, tab), icon: PAGE_GROUP_ICON }], null).then((body) => {
    if ("error" in body) useBrowser.getState().createSplit(panes, split.orientation);
    return body;
  });
}

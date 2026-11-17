// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off extendsNativeError:off effectFnOpportunity:off globalFetch:off
import type { BrowseResult, HostApi } from "./browserTools.ts";
import type { Channel } from "./channel.ts";
import type { Workspace } from "./tabs.ts";

type ApplyReply = { ok: boolean; results?: Array<{ tabs?: string[]; group?: string }>; tabs?: Array<{ id: string; group: string | null }>; error?: { message?: string } };

export function channelHost(channel: Channel): HostApi {
  const apply = async (ops: unknown[]) => {
    const reply = await channel.request<ApplyReply>("apply", { ops }, 60_000);
    if (!reply.ok) throw new Error(reply.error?.message ?? "Ardia couldn't change the tabs.");
    return reply;
  };
  return {
    workspace: () => channel.request<Workspace>("workspace", {}),
    browse: (tab, argv) => channel.request<BrowseResult>("browse", { tab, argv }, 90_000),
    openTab: async (url, place) => {
      const op: Record<string, unknown> = { op: "open", urls: [url], window: place.windowId, activate: place.activate };
      if (place.group) op.group = place.group;
      const reply = await apply([op]);
      const tabId = reply.results?.[0]?.tabs?.[0];
      if (!tabId) throw new Error("Ardia didn't say which tab it opened.");
      const group = reply.tabs?.find((t) => t.id === tabId)?.group ?? null;
      return { tabId, group };
    },
    closeTab: async (tabId) => void (await apply([{ op: "tab.close", tabs: [tabId] }])),
    activateTab: async (tabId) => void (await apply([{ op: "tab.activate", tab: tabId }])),
    groupWithChat: (chatTabId, tabIds) => channel.request<{ group: string }>("group.withPage", { tab: chatTabId, tabs: tabIds }),
    splitToGroup: (chatTabId) => channel.request<{ group: string }>("split.toGroup", { tab: chatTabId }),
    banner: async (tabId, text) => void (await channel.request("tab.banner", { tab: tabId, text })),
  };
}

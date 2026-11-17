// @effect-diagnostics effectFnOpportunity:off
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Tools from "./browserTools.ts";
import { ardiaHost } from "./host.ts";
import { channelHost } from "./hostApi.ts";
import { countUse, pluginState } from "./state.ts";

const TabId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({ description: "A tab id from ardia_chat_context or ardia_list_tabs." });
const Ref = Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(200)).annotate({ description: "An element ref from ardia_read_tab, such as @e12, or a CSS selector." });
const Result = Schema.Unknown;

const annotateTool = <T extends Tool.Any>(tool: T, readonly: boolean): T =>
  tool
    .annotate(Tool.Readonly, readonly)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, true)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients)
    .annotate(Tool.Meta, { "anthropic/alwaysLoad": true }) as T;

const shared = {
  success: Result,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, ThreadManagementService.ThreadManagementService],
};

const make = <const N extends string, P extends Schema.Struct.Fields>(name: N, description: string, parameters: P, readonly: boolean) =>
  annotateTool(Tool.make(name, { ...shared, description, parameters: Schema.Struct(parameters) }), readonly);

const makeBare = <const N extends string>(name: N, description: string, readonly: boolean) => annotateTool(Tool.make(name, { ...shared, description }), readonly);

const ChatContextTool = makeBare(
  "ardia_chat_context",
  "Where this chat is in the browser: its tab, its tab group (null if none), its Split View (null if none), the tabs in that group or split, the tabs the person tagged and the tabs you opened. Call it first in every turn that touches tabs.",
  true,
);
const ListTabsTool = makeBare("ardia_list_tabs", "List the person's open tabs (not private windows): id, title, address, and whether each is in this chat's group or split, tagged, or opened by you.", true);
const ReadTabTool = make(
  "ardia_read_tab",
  "Read a tab's page: its text and interactive elements as refs (@e12). Tabs in this chat's group or split, tagged tabs and tabs you opened are read at once; any other tab asks the person first.",
  { tab: TabId },
  true,
);
const ClickTool = make("ardia_click", "Click an element on a tab's page. Ardia asks the person first unless they chose Always for this site.", { tab: TabId, ref: Ref }, false);
const TypeTool = make(
  "ardia_type",
  "Type text into a field on a tab's page, replacing what's there; `submit` presses Enter after. Ardia asks the person first unless they chose Always for this site.",
  {
    tab: TabId,
    ref: Ref,
    text: Schema.String.check(Schema.isMaxLength(4000)),
    submit: Schema.optionalKey(Schema.Boolean),
  },
  false,
);
const OpenTabTool = make(
  "ardia_open_tab",
  "Open an http(s) address in a new tab in this chat's window. Pass group \"chat\" to put it in this chat's tab group. The answer says which group the tab landed in.",
  {
    url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
    group: Schema.Literals(["chat", "none"]).annotate({ description: "\"chat\": into this chat's tab group." }),
    activate: Schema.optionalKey(Schema.Boolean),
  },
  false,
);
const CloseTabTool = make("ardia_close_tab", "Close a tab. Tabs you opened or that are in this chat's group close at once; others ask the person.", { tab: TabId }, false);
const ActivateTabTool = make("ardia_activate_tab", "Show a tab in its window.", { tab: TabId }, false);
const AddToChatGroupTool = make(
  "ardia_add_to_chat_group",
  "Put tabs into this chat's tab group, creating the group (headed by this chat) if it has none. Fails while the chat is in a Split View: use ardia_split_to_group first.",
  { tabs: Schema.Array(TabId).check(Schema.isMinLength(1), Schema.isMaxLength(20)) },
  false,
);
const SplitToGroupTool = makeBare("ardia_split_to_group", "Turn the Split View this chat is in into a tab group headed by this chat, with the split's pages in it.", false);

export const ArdiaBrowserToolkit = Toolkit.make(
  ChatContextTool,
  ListTabsTool,
  ReadTabTool,
  ClickTool,
  TypeTool,
  OpenTabTool,
  CloseTabTool,
  ActivateTabTool,
  AddToChatGroupTool,
  SplitToGroupTool,
);

const FAILURE_CODES: Record<string, OrchestratorMcpFailure["code"]> = {
  refused: "capability_denied",
  denied: "capability_denied",
  stopped: "capability_denied",
  in_split: "invalid_request",
  not_in_split: "invalid_request",
  no_chat_tab: "invalid_request",
};

const failure = (error: unknown) =>
  new OrchestratorMcpFailure({
    code: error instanceof Tools.ToolFailure ? (FAILURE_CODES[error.code] ?? "orchestration_error") : "orchestration_error",
    message: error instanceof Error ? error.message : "Ardia couldn't do that.",
  });

const run = <A>(body: (ctx: Tools.ToolContext, chatId: string) => Promise<A>) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const chatId = scope.thread?.threadId;
    const host = ardiaHost();
    if (!chatId) return yield* new OrchestratorMcpFailure({ code: "thread_credential_required", message: "Only a chat can use Ardia's tabs." });
    if (!host || host.channel.isClosed) return yield* new OrchestratorMcpFailure({ code: "orchestration_error", message: "Ardia isn't connected." });
    const state = pluginState(host.dataDir);
    return yield* Effect.tryPromise({
      try: (signal) =>
        body({ host: channelHost(host.channel), asks: state.asks, memory: state.memory, grants: state.grants, onUse: (use) => countUse(state, use), onBanner: (tab, chat) => void (chat ? state.banners.set(tab, chat) : state.banners.delete(tab)), signal }, chatId),
      catch: failure,
    });
  });

const handlers = {
  ardia_chat_context: McpToolAccess.readsAsCaller(() => run((ctx, chat) => Tools.chatContext(ctx, chat))),
  ardia_list_tabs: McpToolAccess.readsAsCaller(() => run((ctx, chat) => Tools.listTabs(ctx, chat))),
  ardia_read_tab: McpToolAccess.readsAsCaller(({ tab }) => run((ctx, chat) => Tools.readTab(ctx, chat, tab))),
  ardia_click: McpToolAccess.actsAsCaller(({ tab, ref }) => run((ctx, chat) => Tools.click(ctx, chat, tab, ref))),
  ardia_type: McpToolAccess.actsAsCaller(({ tab, ref, text, submit }) => run((ctx, chat) => Tools.type(ctx, chat, tab, ref, text, submit ?? false))),
  ardia_open_tab: McpToolAccess.actsAsCaller(({ url, group, activate }) => run((ctx, chat) => Tools.openTab(ctx, chat, url, group, activate ?? false))),
  ardia_close_tab: McpToolAccess.actsAsCaller(({ tab }) => run((ctx, chat) => Tools.closeTab(ctx, chat, tab))),
  ardia_activate_tab: McpToolAccess.actsAsCaller(({ tab }) => run((ctx, chat) => Tools.activateTab(ctx, chat, tab))),
  ardia_add_to_chat_group: McpToolAccess.actsAsCaller(({ tabs }) => run((ctx, chat) => Tools.addToChatGroup(ctx, chat, [...tabs]))),
  ardia_split_to_group: McpToolAccess.actsAsCaller(() => run((ctx, chat) => Tools.splitToGroup(ctx, chat))),
} satisfies McpToolAccess.Handlers<typeof ArdiaBrowserToolkit.tools>;

export const layer = McpToolAccess.toLayer(ArdiaBrowserToolkit, handlers);

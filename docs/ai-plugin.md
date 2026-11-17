# The AI plugin

Issue #2463. AI in Ardia is a first-party plugin on the plugin host (`docs/plugins.md`, #2462): off until you turn it
on, and when it's off nothing of it exists anywhere in the browser. It runs a chat at `ardia://ai/<chat id>` on your
own Claude or ChatGPT plan, through the command line tools you already signed in to, and it reads and uses your tabs
only as described under Permissions. Everything it needs from the browser is a public plugin-host contribution.

```
plugins/ai/
  plugin.json          the manifest: page, process and its home grants, commands, toolbar, New Tab mode, rows
  skill/browser.md     the instructions the agent runs with (installed as CLAUDE.md, AGENTS.md and a skill)
  page/                the chat page: React, built with esbuild, styled from Ardia's tokens
  runtime/             T3 Code's server, pinned (UPSTREAM) and patched (series, patches/), plus src/: our code
  build.sh             builds the plugin folder: binary, its packages, the page, the manifest and the skill
  tests/               unit tests: permissions, tools, channel, page state, shell state
```

## How it runs

- **The helper** is T3 Code's server (MIT, `runtime/NOTICE`), stripped to Claude Code and Codex sessions, MCP and
  the environment protocol (#2460), as one Node executable, `bin/ardia-ai ardia`. The host starts it in its sandbox
  with the grants in the manifest: read and write `~/.claude`, `~/.claude.json`, `~/.codex` and Claude's state and
  caches, read `~/.local/bin` and `~/.local/share/claude`, with `HOME` set to your home, so `claude` and `codex` run
  with the login they already have. Nothing is copied: refresh tokens rotate, and a copy would sign you out.
- **Launch** (`runtime/src/main.ts`): it says `hello` on the channel (descriptor 3), makes a 32-byte secret, picks a
  free port on 127.0.0.1, and starts the server in T3's desktop mode with the secret as its rotating bootstrap secret
  (`desktopBootstrapSecret`, given through `--bootstrap-fd` from a file it opens and unlinks at once). Its data is
  `PluginData/ai/t3`; the agents' working folder is `PluginData/ai/workspace`, which holds the skill. When the
  server answers it sends `page.serve {url: "http://127.0.0.1:<port>/#k=<token>"}` and again every 6 hours (the
  token changes every 12). It exits when the channel closes, and T3's launcher watch stops it if Ardia dies.
- **The page** is a static app the server serves. The host shows it in a WKWebView with its own data store and keeps
  the fragment out of the address bar, history and session. The page exchanges the token at `/oauth/token` for a
  30-day bearer (kept in the page's storage for that port), gets a WebSocket ticket and speaks T3's RPC
  (`orchestration.launchThread`, `subscribeThread`, `dispatchCommand`, `subscribeShell`, `server.getConfig`). A chat's
  id is its T3 thread id, so `ardia://ai/<id>` is its address from the first moment.
- **Ardia's routes** (`/ardia/*`, `runtime/src/routes.ts`) give the page what T3's RPC doesn't: permission asks
  (long-poll `GET /ardia/events`, `POST /ardia/asks/answer`), the chat's tabs (`GET /ardia/tabs`), send and stop
  (`POST /ardia/send` tags tabs and makes the group, `POST /ardia/stop`), opening a chat or history
  (`POST /ardia/open` → `page.open`), the first-run mode (`POST /ardia/settings` → `values.set`) and sign-in
  (`POST /ardia/login` opens `claude auth login` or `codex login` in Terminal). Each request needs the page's bearer,
  checked against the server's own `/api/auth/session`, `Host: 127.0.0.1:<port>` and no foreign `Origin`.
- **Tools** (`runtime/src/browserToolkit.ts`) are an MCP toolkit in T3's MCP server, which T3 already gives every
  provider session with a bearer of its own, so a call always knows its chat (`McpInvocationContext`; a chat can't
  act as another). It replaces T3's own toolkits: an agent in Ardia gets `ardia_chat_context`, `ardia_list_tabs`,
  `ardia_read_tab`, `ardia_click`, `ardia_type`, `ardia_open_tab`, `ardia_close_tab`, `ardia_activate_tab`,
  `ardia_add_to_chat_group`, `ardia_split_to_group` and `send_to_user`, all loaded up front. Claude Code runs with only
  `WebSearch` and `WebFetch` of its built-in tools (`runtime/src/policy.ts`): no shell, no file reads or writes.
  Reading and acting on pages go through the host's `browse` method, which runs the `ardia browse` layer on the
  engine's token policy; tabs, groups and splits go through `workspace`, `apply`, `group.withPage` and
  `split.toGroup`.

## Permissions

`runtime/src/permissions.ts` decides; `tests/permissions.test.mjs` and `tests/browserTools.test.mjs` pin it.

| Action | Allowed at once | Asks (Allow ↩ / Always / Don't) | Never |
| --- | --- | --- | --- |
| Read a tab | in the chat's group or split, tagged, or opened by the agent; a site you chose Always for | any other tab | private windows (the host never lists them), Ardia's pages, chats |
| Click, type | a site you chose Always for (to act) | every other time, shown with the tab's banner while it acts | as above |
| Open a tab | http(s) only | | anything else |
| Close or regroup a tab | the agent's own, or the chat's | any other tab | as above |

- "Always" is kept per site (scheme, host and port) and per kind in `PluginData/ai/grants.json`; acting implies
  reading. An ask times out as no after 5 minutes. Stop in the tab's banner stops the chat: every tool refuses until
  you send a new message.
- Page text reaches the agent wrapped as data from the site, and the skill says it is never instructions.

## The skill

`skill/browser.md` holds the rules the agent follows, as instructions, not code, and the end-to-end test checks each:
every tab it opens goes into the chat's group; in a Split View, opening a tab first turns the split into a group.
Hard-coded in the browser, not in the skill: tagging a tab with @ and sending always makes a group headed by the chat,
and tabs tagged later join it (`POST /ardia/send`).

## Building

`plugins/ai/build.sh <out dir> [<t3code tree>]` needs Node 26.13.1 (T3's engines) with pnpm on `PATH`. It clones T3
Code at the pinned commit (or uses the tree given), runs `runtime/apply.sh` (patches once, recorded in
`.ardia-patches`; copies `runtime/src` to `apps/server/src/ardia`), installs, builds the executable with
`APP_VERSION` from `runtime/UPSTREAM`, and assembles `<out>/ai`: `plugin.json`, `skill/`, `NOTICE`, `bin/ardia-ai`,
`bin/node_modules` (undici, ffi-rs, fff-node and their binaries) and `bin/client` (the page, `page/build.mjs`).

## Updating T3 Code

1. Pick the commit: the `t3codeCommitHash` of the T3 Code app you match, or upstream `main`.
2. In a checkout of T3 Code at the new commit, run `runtime/apply.sh`. A patch that doesn't apply: apply it with
   `git apply --3way`, fix the conflict, and write the patch again with `git diff <commit> -- <files>`. The strip
   (`0001`) mostly touches `server.ts`, the composition root, and every new upstream service there needs a decision:
   keep it, or replace it with a loud `removed(...)` or an explicit layer in `stripped/disabled.ts` (never a silent
   catch-all). `0002` holds the Ardia entry (`binMain.ts`), the routes, the toolkit list, the disabled services and
   the Claude tool list.
3. Typecheck (`pnpm -C apps/server typecheck`), and run the page check: copy `page/src` into
   `apps/web/ardia-page-check/src` with the tsconfig from this doc's history, then `effect-tsgo tsrs --noEmit -p`.
4. Update `runtime/UPSTREAM` (commit and version), build, and run the end-to-end test.

## Tests

- `node --test plugins/ai/tests/*.test.mjs`: permissions, tools against a fake host, the channel, page and shell state.
- `plugins/ai/tests/e2e.mjs` (needs a Debug build, Node 26 and a signed-in `claude`): a hidden instance with the plugin
  installed and turned on, the real runtime on the cheapest model, checking each skill rule by the browser's tab
  state.

## Telemetry

Counts only, through the host's `telemetry.count`, sent only while sharing is on: `chats_started`,
`mode_browser_first`, `mode_ai_first`, `tool_read`, `tool_act`, `tool_open`, `tool_close`, `tool_group`,
`tool_split_to_group`, `permission_allowed`, `permission_always`, `permission_denied`, `permission_timed_out`,
`runtime_crashes`, `banner_stops`, `tag_groups_created`, `tag_groups_joined`, `signin_started`. Never prompts, page
content, URLs or titles. Dashboard: watch `permission_denied` against `permission_allowed` (asks that annoy),
`runtime_crashes` against `chats_started`, and `tool_split_to_group` against splits that got a tab opened.

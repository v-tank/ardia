# Plugins

A plugin is a folder with a `plugin.json` that adds to Ardia without a restart: Ardia settings it sets and rows it adds
to Settings, command bar entries, a page of its own that opens as a tab at `ardia://<name>`, a long-running helper
program, browser events delivered to that program, and tools the `ardia` command and other plugins can call. Issue
#2462.

The rule behind the design: anything a first-party plugin needs becomes a public extension point here, never a private
hook. AI features will ship as a plugin (#2463) through exactly these contributions.

Plugins run on macOS. Linux and Windows don't load them yet (`PLATFORM_FEATURES.plugins`): the Plugins pane says so,
and the `ardia` command's plugin commands still install and list files there.

## Where they live

```
<config folder>/plugins/<name>/plugin.json     the manifest, and the plugin's own files beside it
<data dir>/plugins.json                         which plugins are on, what you approved, your row values
<data dir>/PluginData/<name>/                   the helper's home, temp folder and log
```

- The config folder is `docs/config.md`'s (`~/.config/ardia/`, or `<data dir>/config` for a scratch instance), so a
  dotfiles repo can carry plugins. A folder or `plugin.json` may be a symlink; Ardia reads regular files only, at most
  1 MB per manifest, and at most 64 plugins.
- The folder name is the plugin's `name`. A folder whose name doesn't match its manifest is listed with that problem.
- Ardia watches the folder: a plugin appears, changes or disappears the moment its files do.
- Installing, enabling and the rest need no restart. Turning a plugin off withdraws everything it added at once.

## The manifest

```json
{
  "$schema": "../../plugin.schema.json",
  "manifest": 1,
  "name": "example",
  "title": "Example",
  "description": "One line on what it does.",
  "version": "1.0.0",
  "requires": "0.2.50",
  "permissions": ["tabs", "commands", "network"],
  "settings": {
    "defaults": { "commandBarStart": { "openTabs": { "limit": 5 } } },
    "rows": [
      { "key": "greeting", "title": "Greeting", "type": "text", "default": "Hello" },
      { "key": "loud", "title": "Shout", "type": "toggle", "default": false },
      { "key": "mood", "title": "Mood", "type": "choice", "default": "calm", "choices": [{ "value": "calm", "title": "Calm" }, { "value": "busy", "title": "Busy" }] }
    ]
  },
  "commands": [
    { "name": "say-hello", "title": "Say Hello", "icon": "hand.wave", "keywords": ["greet"], "tool": "hello" },
    { "name": "beside", "title": "Open Example Beside This Tab", "open": "split", "context": true, "sideSetting": "side" }
  ],
  "page": { "title": "Example", "icon": "sparkles", "file": "page/index.html" },
  "process": { "run": ["/usr/bin/python3", "helper.py"], "memoryMB": 256 },
  "hooks": ["tab.activated", "tab.navigated"],
  "tools": [{ "name": "hello", "title": "Say hello", "description": "Greets someone.", "timeout": 10 }]
}
```

- `manifest` is the schema version. A file without it is version 0, the settings-only plugins of
  github.com/ardia-browser/plugins (`name`, `title`, `description`, `requires`, `settings`, `reset`), and reads as
  version 1 with its `settings` as `settings.defaults` (`reset` is the installer's and Ardia ignores it). A newer
  version than Ardia knows is listed as "needs a newer Ardia" and never loads. The migration is
  `lib/pluginManifest.ts`'s `MIGRATIONS`, like every saved document (`docs/conventions.md`).
- `name`: 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit. `title` up to 60 characters,
  `description` up to 200, both with control and bidi characters refused. `version` and `requires` are
  `MAJOR.MINOR.PATCH` with an optional `-suffix`; a plugin that requires a newer Ardia doesn't load.
- Unknown keys anywhere are errors, so a typo never silently does nothing. Every problem is reported at once, with
  its path: `plugin.json: commands[0].tool: hello isn't one of this plugin's tools`. A manifest with any problem
  doesn't load; the Plugins pane shows the problems and `ardia plugins check` prints them.
- The app writes `plugin.schema.json` beside `config.schema.json` (`docs/config.md` › Schemas), generated from the same
  rules, for editors and the CLI. The app validates with its own code.

### settings

- `defaults` sets Ardia settings while the plugin is on. Only settings `config.json` may set are accepted (the config
  allowlist, `docs/config.md`), with the same checks, so a plugin can't turn on CLI control, add a search destination
  or change which engine shows a site. When you turn the plugin on, each default that `config.json` doesn't set is
  applied through `updateSettings` and the value it replaced is remembered; turning the plugin off puts that value back
  unless you changed the setting since. When two plugins set the same setting, turning either off leaves the other's
  value or, once both are off, the one from before either. `config.json` always wins. `omniboxProviders` and
  `launchActions` have approvals of their own (`docs/automation.md` › Approvals), so a plugin can't set them.
- `rows` (at most 20) add rows to the plugin's page in Settings › Plugins: `toggle` (boolean), `text` (up to 200
  characters, `default` a string) and `choice` (2 to 12 `choices`, `default` one of their values). `key` is 1 to 40
  letters, digits, `-` and `_`. Values are kept in `plugins.json` and sent to the helper (below). They are the plugin's
  own: nothing in Ardia reads them.

### commands

At most 20. Each adds a command bar entry titled `title` (up to 60 characters), found by its title, `keywords` (up to 8,
each up to 40 characters) and the plugin's title, drawn with `icon` (an SF Symbol name, default `puzzlepiece`). A
command does one of two things:

- `"tool": "<name>"` calls one of the plugin's own tools with `input` (an object, default `{}`), so it needs a
  `process`. A result with a `message` (up to 200 characters) shows as a toast.
- `"open": "tab"` or `"open": "split"` opens the plugin's page: as a tab (the one already open in that window, else a
  new one), or in Split View beside the current tab, on `side` (`left`, `right`, the default, `top` or `bottom`), or on
  the side a `choice` row named by `sideSetting` holds (its values must be sides). `"context": true` hands the page the
  current tab (its id, title and URL, without the query and fragment unless the plugin has `fullUrls`), and needs
  `tabs`. `path` (`/history`, `/chats/new?mode=split`) opens the page there.

A plugin with a `page` also gets "Open `<page title>`" for free.

### page

The plugin's page is a real tab at `ardia://<name>`, like `ardia://history`: it sits in the sidebar, takes a place in
Split View and in tab groups, moves between windows and comes back with the session. `title` (up to 40 characters)
names the tab and `icon` its command bar entry. The tab's content is one of:

- `"file": "page/index.html"`: a file in the plugin's folder, served as `ardia-plugin://<name>/page/index.html`.
  Only regular files inside the plugin's folder are served (checked after resolving links), at most 10 MB each, with
  their type from the extension; anything else is a 404.
- `"served": true`: the helper serves it and tells Ardia where with `page.serve` (below). The URL must be
  `http://127.0.0.1:<port>/…`, `http://localhost:<port>/…` or `http://[::1]:<port>/…`. Until it arrives the tab says the
  plugin is starting.

A page tab can have a path, `ardia://<name>/<path>?<query>` (`ardia://ai/history`, `ardia://ai/chats/42`): each path
is its own tab, and opening one that's already open in the window goes to it. A file page gets the path and query as
`ardiaPath`; a served page loads them on its helper's server. When a command hands the page a tab, the page's URL
carries it as `ardiaContext`, a JSON object `{"tabId", "url", "title"}`. Navigation inside the page doesn't change the
tab's address, title or back and forward yet (follow-up issue). While the plugin is off, changed or not running, the tab stays and says so, with a way to Settings; it is
never sent to Chrome. A plugin with a page can't take the name of one of Ardia's or Chrome's own pages (`history`,
`settings`, `flags`, `extensions`, … `lib/pluginNames.ts`).

### process

`run` is the helper's argv: its first item is a file in the plugin's folder (`bin/helper`), an absolute path
(`/usr/bin/python3`), or a bare name found on `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin`.
At most 32 items, each up to 1,024 bytes, no NUL. `memoryMB` (64 to 4,096, default 1,024) caps its memory. See
[The helper](#the-helper).

### hooks

Events from Ardia's automation event table (`docs/automation.md` › Events) delivered to the helper while it subscribes
to them. Every event the helper may subscribe to is listed here, so it shows on the consent sheet. Events about
windows, tabs, pages, media, Peek, pins, splits and profiles need the `tabs` permission. `notification.shown` and the
decide events (`tab.opening`, …) aren't available to plugins yet. Needs a `process`.

### tools

At most 32. A tool is an action the helper performs on request: `name` (like a command's), `title`, `description`
(up to 200 characters), `timeout` in seconds (1 to 300, default 30). Callers: the plugin's own commands, the `ardia`
command (`ardia plugins call`), and other plugins' helpers (`tools.call`). Input and result are JSON, at most 1 MB.
Needs a `process`.

### permissions

| Permission | What it allows |
| --- | --- |
| `tabs` | The helper may call `windows` and subscribe to tab, window and page events. URLs come without their query and fragment |
| `fullUrls` | Those URLs in full (needs `tabs`) |
| `commands` | The helper may run Ardia's commands, the same ones and with the same refusals as the `ardia` command (`docs/automation.md` › Which commands) |
| `network` | The helper may connect beyond this Mac. Without it, only to this Mac's own addresses |

Contributions grant their own reach and are shown too: running a program, adding a page, adding commands, changing
named Ardia settings, offering tools.

## Turning a plugin on

A plugin you install is off. Turning it on in Settings › Plugins shows what it gets, in words built from the
manifest ("Runs a program in the background: /usr/bin/python3 helper.py", "Sees the address and title of your tabs",
"Runs Ardia commands", "Connects to the internet", "Changes these settings: commandBarStart", "Adds a page you open as a tab", …). Turn On approves that exact manifest: Ardia keeps the SHA-256 of the manifest's text in `plugins.json`.

- **A changed manifest needs a new approval.** If `plugin.json` changes while the plugin is on, the plugin stops (its
  helper, page, commands, hooks and tools all go) and its row says it changed and asks you to review it. Settings
  defaults stay applied until you turn it off.
- Files beside the manifest (the helper's code, the page's files) aren't covered by the approval, like a hook's
  program in `hooks.json`: whoever can write your config folder can already change what Ardia runs. The approval is
  for the manifest's declarations, not for the code. `ardia plugins install --force` turns the plugin off in a running
  Ardia before replacing its files, so a replaced plugin arrives off.
- `ardia plugins enable NAME` opens the same sheet in Ardia; it never turns a plugin on by itself.
- Turning off: the helper stops, its page tabs say it's off, commands, rows, hooks and tools go, and settings defaults
  go back.
- Remove (Settings, or `ardia plugins remove`) turns it off, moves the folder to the Trash and deletes its
  `PluginData` folder and its page's website data. An instance on a scratch `ARDIA_DATA_DIR` deletes the folder
  instead, so tests never fill the Trash.

`plugins.json` (version 1): `{ "plugins": { "<name>": { "enabled", "approved" (manifest hash), "values" (row values),
"applied" ({ key: { value, previous } }) } } }`.

## The helper

- **Starts** when the plugin is turned on, at launch for plugins that are on (after the first window), and when you
  press Restart. **Stops** when it is turned off, removed, its manifest changes, or Ardia quits: Ardia closes its
  channel, sends SIGTERM to its process group and SIGKILL 3 s later (at quit, after 1 s).
- **Supervised.** A helper that exits with a failure or a signal, or whose own process goes over `memoryMB` (a watchdog:
  its physical footprint checked every 10 s, not a hard cap, and its child processes aren't counted), is restarted after
  1, 2, 4, 8 then 16 s. After 5 failures within 10 minutes it stays stopped and its row says it crashed, with Restart.
  A helper that exits with status 0 isn't restarted. Every start, restart timer, call and served page belongs to one
  run of the helper; anything from an older run is ignored.
- **Launched** with `posix_spawn` in its own process group, from the plugin's folder, through
  `/usr/bin/sandbox-exec` with Ardia's fixed profile (`PluginSandbox.swift`), the paths passed as its parameters (`-D`),
  never written into the profile's text. It inherits nothing from Ardia but stdin (`/dev/null`), stdout and stderr (its
  log, `PluginData/<name>/plugin.log`, 0600, moved to `plugin.log.1` at start past 1 MB and emptied while it runs past
  2 MB) and the channel on descriptor 3; both ends of the channel are close-on-exec from the moment they exist. Its
  environment is only `PATH` (above), `HOME` (`PluginData/<name>/home`), `TMPDIR` (`PluginData/<name>/tmp`), `LANG`,
  `ARDIA_PLUGIN_NAME`, `ARDIA_PLUGIN_FD=3` and `ARDIA_PLUGIN_PROTOCOL=1`. A sandbox Ardia can't set up means the helper
  doesn't start; it never runs unsandboxed.
- **Sandbox.** It may read and write its `PluginData` folder and read the plugin's folder, the program it runs and that
  program's install folder (the folder above the `bin` it is in, so `/opt/homebrew/opt/node/bin/node` reads its own
  libraries; `/bin/sh` or `~/bin/x` read only themselves, since that folder would be `/` or your home). Your home
  folder, Ardia's data folder and its config folder are unreadable and unwritable, wherever they are (a scratch data
  folder outside your home included): your files, every browser profile, cookies, passwords and Ardia's own state. It
  can't connect to a Unix socket in your home or Ardia's data folder, so Ardia's control socket is out of reach. It
  can't write anywhere else on disk. Without `network` its outbound connections reach only this Mac. A plugin whose
  folder (after links) would take in your home, Ardia's data or its settings, or whose program lives in Ardia's data or
  config folder, isn't started.
- **What the sandbox doesn't do.** It runs as you, so it is a containment layer around a program you chose to run, not
  a defense against one built to escape. Known gaps: Apple Events aren't blocked (`appleevent-send` isn't enforced for
  a default-allow profile), so a helper could script an app that accepts them, Ardia's own AppleScript included, which
  stays behind its own settings; files your config folder links to outside your home are readable; the system services
  every program reaches are reachable; a local server it starts may listen on any address (bind served pages to
  `127.0.0.1`); it isn't limited in CPU. If Ardia crashes, a helper that doesn't exit when its channel closes keeps
  running until it is stopped by hand. So the permissions below are what Ardia hands a helper through its channel and
  what the sandbox holds it to on disk and on the network; the gaps above are outside them. Issue #2495 moves the
  helper to a deny-by-default profile.

### The channel

Descriptor 3 is a Unix stream socket to Ardia speaking the control socket's protocol (`docs/automation.md` ›
Protocol: newline-delimited JSON, the same limits), private to this helper: nothing else can connect to it, and it
works whether or not "Let the ardia command control Ardia" is on. A helper should exit when it closes.

Requests from the helper (`{"id", "method", "params"}`):

| Method | Needs | Result |
| --- | --- | --- |
| `hello` | | `{"app", "version", "protocol": 1, "plugin", "values"}`: `values` are the row values |
| `values` | | the row values |
| `subscribe` `{"events", "idle"?}` | the events in `hooks` | `{"ok": true}`; then `{"event", "time", "data"}` lines as on the socket; `["*"]` means every event in `hooks` |
| `windows` | `tabs` | as on the socket |
| `run` `{"command", "arg"?, "window"?, "tab"?}` | `commands` | as on the socket |
| `page.serve` `{"url"}` | `page.served` | `{"ok": true}`; open page tabs load it |
| `page.open` `{"path"?, "split"?, "side"?, "context"?}` | a `page`; `context` needs `tabs` | `{"tabId", "windowId"}`: opens the plugin's page at that path in the last focused window, as a tab or in Split View beside the current tab |
| `tools.call` `{"plugin", "tool", "input"?}` | every permission the other plugin has | the tool's result, or its error; the plugin must be on and running. A plugin can't reach through another plugin's tools to what it wasn't granted itself |
| `result` `{"call", "result"? , "error"?}` | | `{"ok": true}`: the answer to a call (below) |

A method the manifest doesn't allow is `refused`. Events from Ardia: `plugin.values` (`{"values"}`) when you change a
row, plus the subscribed events. Calls to a tool arrive as `{"call": "c4", "tool": "hello", "input": {…},
"caller": {"kind": "command" | "cli" | "plugin", "plugin"?}, "deadline": ms}`; the helper answers with `result`. A
call past its deadline is answered with an error for the caller and `{"call": "c4", "cancel": true}` is sent; a late
`result` is `bad_request`. At most 16 calls wait per helper.

## The page

The page tab's content is a WebKit view (`WKWebView`), not a Chrome page, so nothing in it touches a Chrome profile,
whichever profile the tab's window shows:

- **Its own storage.** Each plugin's page has its own website data store (`WKWebsiteDataStore(forIdentifier:)`, an id
  derived from the plugin's name), apart from every profile's cookies, logins and storage, the WebKit page engine's
  stores and other plugins' pages. Removing the plugin deletes it.
- **Away from Ardia's interface.** It runs in WebKit's own processes with no script message handlers, so the page can't
  reach the interface's JavaScript, the store or any native call. It gets no camera, microphone or location, downloads
  are refused, and its JavaScript dialogs are ignored.
- **Its network follows the plugin's.** Without `network`, the page's own requests (scripts, images, `fetch`,
  WebSockets) may only reach its own origin and this Mac: a file page gets a Content Security Policy in its response
  header, a helper-served page the same policy as a meta tag at document start.
- **Stays on its origin.** Its own origin may navigate freely; a link you click to any other http(s) address opens
  as a new tab in the window's profile (where your cookies apply, as for any link you open), and every other
  navigation, a pop-up or a `window.open` included, is cancelled.

## The ardia command

`ardia plugins` works on the plugin folder of the config folder it resolves (`--data-dir`, `$ARDIA_DATA_DIR`, else
the installed app's); `enable`, `disable` and `call` need Ardia running with CLI control on.

- `ardia plugins list [--json]`: each plugin, its version, whether it's on and running, what it contributes, and its
  problems. With Ardia reachable it asks Ardia (`plugins` on the socket); otherwise it reads the files.
- `ardia plugins install PATH [--force]`: copies a plugin folder (or a lone `plugin.json`) into the plugin folder,
  after checking it against `plugin.schema.json`. `--force` replaces one already there. The plugin arrives off.
- `ardia plugins check [NAME|PATH]`: checks manifests.
- `ardia plugins remove NAME`: through Ardia when it is reachable (as Settings' Remove), else deletes the folder.
- `ardia plugins enable NAME`, `ardia plugins disable NAME`.
- `ardia plugins call NAME TOOL [JSON]`: calls a tool and prints its result as JSON (exit 1 on its error).

The control socket's protocol 4 adds `plugins`, `plugins.enable` (`{"waiting": true}` once the sheet is up),
`plugins.disable`, `plugins.remove` and `plugins.call` (`{"plugin", "tool", "input"?}`).

## Code

- `lib/pluginManifest.ts`: parsing, migration, checks and the schema; `lib/pluginManifest.test.mjs`.
- `state/plugins/`: the registry (`store.ts`), saved state (`savedState.ts`), turning on and off (`lifecycle.ts`),
  settings defaults (`defaults.ts`), the helper channel (`channel.ts`, `channelMethods.ts`), tools (`tools.ts`),
  command bar entries (`commands.ts`), page tabs (`pages.ts`, `pageNames.ts`), consent copy (`consent.ts`), socket methods
  (`socketMethods.ts`).
- `platform/plugins.ts` binds `ArdiaPlugins` (`packages/shell/ios/PluginsModule.swift`, `PluginFolder.swift`,
  `PluginProcess.swift`, `PluginSandbox.swift`, `PluginPageView.swift`, `PluginSchemeHandler.swift`).
- UI: `components/settings/panes/Plugins.tsx`, `components/plugins/PluginPage.tsx` (rendered by `components/pages/InternalPage.tsx`).
- The example plugin used by the tests: `tests/fixtures/plugins/example/`.

## Telemetry

Counts only, never plugin names, titles, URLs, row values, tool input or output:
`usage_counts.plugin_enables`, `plugin_disables`, `plugin_process_starts`, `plugin_process_crashes`,
`plugin_commands_run`, `plugin_tool_calls`, `plugin_tool_failures`, `plugin_page_opens`, `plugin_split_opens`; the daily settings snapshot's
`plugins_installed`, `plugins_enabled` and, among those on, how many use each contribution:
`plugins_with_settings`, `plugins_with_commands`, `plugins_with_page`, `plugins_with_process`,
`plugins_with_hooks`, `plugins_with_tools`. Dashboard: watch `plugin_process_crashes` against
`plugin_process_starts`.

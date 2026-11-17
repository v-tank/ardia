# Plugins

A plugin is a folder with a `plugin.json` that adds to Ardia without a restart: Ardia settings it sets and rows it adds
to Settings, command bar entries, a toolbar button with its own shortcut, a page of its own that opens as a tab at `ardia://<name>`, a long-running helper
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
  "toolbar": { "title": "Say Hello", "icon": "hand.wave", "command": "say-hello", "shortcut": "cmd+shift+e" },
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

### toolbar

One button in the window's toolbar, right of the address field (left of the extensions' buttons), with the same size,
hover and pressed plates as its neighbours. Plugins' buttons sit in the Plugins pane's order. `title` (up to 40
characters) is its tooltip, `icon` an SF Symbol name, and `command` names one of the plugin's `commands`: pressing the
button runs it exactly as the command bar would. The toolbar's layout counts the buttons, so the address field and the
extensions move over for them. With the address field in the sidebar (Settings › Appearance) there's no toolbar, so the
button shows only in the Plugins menu.

`shortcut` (optional) is written as in `config.json`'s `shortcuts` (`docs/config.md`: `"cmd+shift+e"` or `"⇧⌘E"`) and
must hold cmd or ctrl. The command gets an item in the menu bar's Plugins menu (shown only while a plugin with a
`toolbar` is on) under the button's title, carrying the shortcut, so it works whatever has focus and you can rebind it
in Settings › Keyboard Shortcuts like any other item. A shortcut Ardia already uses (a command's default, one you bound,
a profile's ⌃1 to ⌃9 or a menu bar item of macOS's own) is a manifest problem: `plugin.json: toolbar.shortcut ⌘E is taken
by Use Selection for Find`. If two plugins ask for the same free shortcut, the first in the Plugins pane's order gets it.
The menu item's id is `runPluginCommand:<plugin>/<command>`; the `ardia` command can't run it (`docs/automation.md`).

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

A group whose first tab is a plugin page tab (not in a Split View, not in a nested group), as `group.withPage` and
`split.toGroup` make, is drawn headed by that page: the group's usual block (fill and border from its color), the
page tab's own row as the header (its icon and title, the selected look when it's the active tab, a click shows it,
its menu is the tab's), and the other tabs indented under it. `tab.activity` puts the pulsing dot (`goButton`,
`period.pulse`) at the right of that row. The page tab isn't listed again among the members, and keeps its place in
⌘1–9 (`state/plugins/pageGroups.ts`, `state/sidebar/entries.ts`, `components/sidebar/GroupBlock.tsx`). Take the
page tab out of first place and the group is an ordinary group again.

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

`access` (at most 16) opens folders or files in your home to the helper, which the sandbox otherwise keeps it out of:
`[{"path": "~/.claude", "write": true}, {"path": "~/.local/share/claude"}]`. A `path` starts with `~/` and has no
empty, `.` or `..` parts; a grant reads (and runs the programs in) that path and everything under it, and `"write": true`
also writes there. The folder doesn't have to exist yet. A grant that is your home folder, or that is inside or takes
in Ardia's data folder, its config folder or another browser's profiles (`~/Library/Application Support/Google`,
`Arc`, `Dia`, `BraveSoftware`, `Firefox`, … `~/Library/Safari`, `~/Library/Cookies`, `~/Library/Keychains`; the list
is `PROTECTED_HOME_PATHS` in `lib/pluginProcess.ts` and `protectedInHome` in `PluginCore/PluginSandbox.swift`) is a manifest
problem, compared without case. Ardia checks again when it starts the helper, after following links, against the
folders this instance really uses (a scratch data folder included), and a grant that leads outside your home or into
one of those folders keeps the helper from starting. `userHome: true` makes the helper's `HOME` your home folder
instead of its own, for programs that look for their files under `~`; it reaches only what `access` grants. Both exist
so a plugin can run a provider's command line program with the login it already has, without a private hook.

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

### telemetry

`"telemetry": {"counters": ["chats_started", "tool_read"]}` names up to 32 usage counters (each a lowercase letter, then
up to 39 lowercase letters, digits and `_`) the helper adds to with `telemetry.count`. The consent sheet says "Counts how
often you use its features (no content)". Counts go out with the hourly `usage_counts`, only while sharing is on, as
`plugin_<name>_<counter>`, and only for Ardia's own plugins (`FIRST_PARTY_PLUGINS` in `lib/pluginTelemetry.ts`: `ai`),
because another plugin's name must never be sent; for any other plugin they're dropped and `telemetry.count` answers
`{"ok": true, "sent": false}`. The AI plugin's counters are named in the What's Sent copy (`state/telemetry/copy.ts`).

### permissions

| Permission | What it allows |
| --- | --- |
| `tabs` | The helper may call `windows` and subscribe to tab, window and page events. URLs come without their query and fragment |
| `fullUrls` | Those URLs in full (needs `tabs`) |
| `commands` | The helper may run Ardia's commands, the same ones and with the same refusals as the `ardia` command (`docs/automation.md` › Which commands) |
| `network` | The helper may connect beyond this Mac. Without it, only to this Mac's own addresses |
| `arrange` | The helper may call `apply`, `group.withPage` and `split.toGroup`: open, move, group and close tabs (needs `tabs`). Consent: "Opens, moves, groups and closes your tabs" |
| `pages` | The helper may call `browse` and `tab.banner`: read and act on the pages in your tabs through the `ardia browse` layer (needs `tabs`). Consent: "Reads and acts on the pages in your tabs" |

Contributions grant their own reach and are shown too: running a program, adding a page, adding commands, adding a
toolbar button and its shortcut, changing named Ardia settings, offering tools.

## Turning a plugin on

A plugin you install is off. Turning it on in Settings › Plugins shows what it gets, in words built from the
manifest ("Runs a program in the background: /usr/bin/python3 helper.py", "Sees the address and title of your tabs",
"Runs Ardia commands", "Connects to the internet", "Reads and writes ~/.claude", "Reads ~/.local/share/claude",
"Changes these settings: commandBarStart", "Adds a page you open as a tab", "Adds a toolbar button: Ask AI (⇧⌘E)", …). Turn On approves that exact manifest in that exact folder: Ardia keeps the SHA-256 of the manifest's text and the
plugin folder's identity on disk (device and inode, after links) in `plugins.json`.

- **A changed manifest needs a new approval.** If `plugin.json` changes while the plugin is on, the plugin stops (its
  helper, page, commands, hooks and tools all go) and its row says it changed and asks you to review it. Settings
  defaults stay applied until you turn it off.
- Files beside the manifest (the helper's code, the page's files) aren't covered by the approval, like a hook's
  program in `hooks.json`: whoever can write your config folder can already change what Ardia runs. The approval is
  for the manifest's declarations, not for the code. A folder replaced on disk (`ardia plugins install --force` always
  installs a new folder, then swaps it in) is a new folder, so the plugin needs a new approval even with the same
  manifest and even when Ardia wasn't running; a running Ardia is also asked to turn it off first.
- `ardia plugins enable NAME` opens the same sheet in Ardia; it never turns a plugin on by itself.
- An end-to-end test turns a plugin on in a test instance (a build not signed for distribution on a scratch `ARDIA_DATA_DIR`, `isTestInstance()`) with the dev
  harness's `ac.plugins.approve(name)`, which approves the manifest as it is now, as Turn On would. Anywhere else it
  does nothing and answers false.
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
  environment is only `PATH` (above), `HOME` (`PluginData/<name>/home`, or your home with `userHome`), `TMPDIR`
  (`PluginData/<name>/tmp`, always), `LANG`, `ARDIA_PLUGIN_NAME`, `ARDIA_PLUGIN_DATA` (`PluginData/<name>`),
  `ARDIA_PLUGIN_FD=3` and `ARDIA_PLUGIN_PROTOCOL=1`. A sandbox Ardia can't set up means the helper
  doesn't start; it never runs unsandboxed.
- **Sandbox.** It may read and write its `PluginData` folder and read the plugin's folder, the program it runs and that
  program's install folder (the folder above the `bin` it is in, so `/opt/homebrew/opt/node/bin/node` reads its own
  libraries; `/bin/sh` or `~/bin/x` read only themselves, since that folder would be `/` or your home). Your home
  folder, Ardia's data folder and its config folder are unreadable and unwritable, wherever they are (a scratch data
  folder outside your home included): your files, every browser profile, cookies, passwords and Ardia's own state.
  The paths `access` grants are the exception: each is a `-D` parameter (`GRANT_<n>`, never written into the
  profile's text) with `file-read*` and `process-exec*` allowed under it, `file-write*` too for a write grant, and
  `file-read-metadata` on each folder between your home and it (and on the link, when the grant is one) so paths
  resolve. The rules come after the profile's denials, so they win only for those paths; the denials for Ardia's
  data and config folders never overlap a grant, since such a grant is refused. Connecting to a Unix socket in your
  home stays denied, granted or not. `PluginSandboxGrantTests.swift` (in `packages/shell/plugin-tests`) runs a shell
  through the real profile with grants in a scratch home: it reads, runs and writes what's granted and nothing beside it. It
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
| `workspace` `{"window"?, "profile"?, "usage"?}` | `tabs` | the control socket's `workspace` (`docs/automation.md` › Tabs and groups), the same code: private windows and incognito never appear, Ardia's own pages show without their query. URLs come without their query and fragment unless `fullUrls`; plugin page tabs show as `ardia://<name>/<path>`. Each tab node also has `favicon`: the page's favicon URL Ardia has for it, http(s) or `data:image/` only (at most 64 KB), else null, and null for plugin pages |
| `apply` `{"ops"}` | `arrange` | the control socket's `apply`, the same operations, checks and results (URLs minimized as above). It stops before its next operation if the plugin turns off |
| `group.withPage` `{"tab", "tabs"?}` | `arrange` | `{"group", "tabs"}` (the group's tabs in order). `tab` is one of this plugin's page tabs. In a group: `tabs` move into that group right after it. Not grouped and not in Split View: a new group, the page tab first then `tabs`, named after the page tab's title, icon `symbol:sparkles`. Not grouped but in Split View: `in_split` |
| `split.toGroup` `{"tab"}` | `arrange` | `{"group", "tabs"}`: the Split View holding this plugin's page tab is taken apart and its panes become a group, the page tab first, named as above. A split already in a group leaves its panes in that group, and that group is the answer. Not in a split: `not_in_split` |
| `browse` `{"tab", "argv"}` | `pages` | `{"ok": true, "text"}` or `{"ok": false, "error"}`: runs one `ardia browse` command (below) on that tab |
| `tab.activity` `{"tab", "running"}` | `tabs` | `{"ok": true}`: on one of this plugin's page tabs, shows (or hides) a pulsing dot at the right of its sidebar row, for "working on it". It goes when the plugin stops or the tab closes |
| `tab.banner` `{"tab", "text"}` | `pages` | `{"ok": true}`: a strip at the top of that tab's page showing `text · Stop` (1 to 80 characters; `null` clears it). One plugin's banner per tab. Stop sends `{"event": "plugin.bannerAction", "data": {"tab"}}` to the helper, subscribed or not, and the strip says "Stopping…" until the helper clears it. Banners go when the plugin stops or the tab closes |
| `telemetry.count` `{"counter", "n"?}` | the counter in `telemetry.counters` | `{"ok": true, "sent"}`: adds `n` (default 1, at most 1,000 a call) to the counter; `sent` is false for a plugin that isn't Ardia's own |
| `values.set` `{"key", "value"}` | | `{"ok": true}`: sets one of the plugin's own rows, checked like a change in Settings (a toggle's boolean, a text row's up to 200 characters, one of a choice row's values), then sends `plugin.values` |

A method the manifest doesn't allow is `refused`. Events from Ardia: `plugin.values` (`{"values"}`) when you change a
row (or the helper does with `values.set`), `plugin.bannerAction` when you press a banner's Stop, plus the subscribed events. Calls to a tool arrive as `{"call": "c4", "tool": "hello", "input": {…},
"caller": {"kind": "command" | "cli" | "plugin", "plugin"?}, "deadline": ms}`; the helper answers with `result`. A
call past its deadline is answered with an error for the caller and `{"call": "c4", "cancel": true}` is sent; a late
`result` is `bad_request`. At most 16 calls wait per helper.

### browse

`browse` runs Ardia's own automation stack, never a second one: the installed `ardia` command
(`<CLI home>/current/bin/ardia`, what Settings › Advanced installs) with `ardia browse --session plugin-<name>`, first
`tab <targetId>` (the tab's DevTools page, from the engine's `cliTabTargets`, so it acts on exactly that tab, as the
user's borrowed tab: it reads, clicks and types there but never navigates it) and then the command. Ardia runs it, not
the helper: the sandbox keeps the helper away from `ArdiaControl.json` and the token. Rules:

- `tab` is an open http or https tab: never private or incognito, Peek, one of Ardia's pages or a plugin page.
- `argv[0]` is `snapshot`, `get`, `click`, `fill`, `type`, `press`, `scroll`, `wait`, `find` or `is`; 1 to 64
  arguments of up to 8,192 characters. Flags that pick another session, endpoint, data folder or file (`--session`,
  `--ws`, `--data-dir`, `--out`, `--init-script`, `--show`, …) are `bad_request`.
- One command at a time per plugin, 60 s for both steps together; the text answer (stdout) is cut at 64 KB. The
  process runs with a clean environment (`ARDIA_DATA_DIR` this instance's, `ARDIA_TELEMETRY=0`, so plugin use isn't
  counted as the user's CLI use).
- A missing `ardia` command, a tab whose page is asleep, a timeout or the command's own failure come back as
  `{"ok": false, "error"}` with the reason.

**The token server.** `ardia browse` reaches Ardia through the engine's DevTools token server (`ac_cli_control`,
`ArdiaControl.json`), which "Let the ardia command control Ardia" turns on. When that setting is on, `browse` uses it.
When it's off, Ardia starts the token server for the plugin as a lease (`state/plugins/browseServer.ts`), without
turning the setting on and without the control socket: it starts on the first `browse` call, stays while calls run
and for 60 s after the last one, then stops (unless you turned the setting on meanwhile). The engine has one token
server, so while the lease holds, a local program that can read Ardia's data folder could reach it too, exactly as when
the setting is on; that is the cost of not writing a second automation path. The "ardia is controlling Ardia" pill
shows while the plugin's session is connected, and its Stop ends the lease at once (turning the setting off does
too); the plugin's next `browse` starts a new one.

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
  WebSockets) may only reach its own origin and this Mac, and it can't start workers: a file page gets a Content Security Policy in its response
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

- `lib/pluginManifest.ts`: parsing, migration, checks and the schema (`lib/pluginProcess.ts` for `process` and its `access` grants, `lib/pluginSurfaces.ts` for `toolbar`); `lib/pluginManifest.test.mjs`, `lib/pluginSurfaces.test.mjs`.
- `state/plugins/`: the registry (`store.ts`), saved state (`savedState.ts`), turning on and off (`lifecycle.ts`),
  settings defaults (`defaults.ts`), the helper channel (`channel.ts`, `channelMethods.ts`; `arrange.ts` for workspace, apply and groups, `browse.ts` and `browseServer.ts`, `banners.ts`), tools (`tools.ts`),
  command bar entries (`commands.ts`), the toolbar button, its menu item and shortcut (`surfaces.ts`, checked against
  Ardia's own shortcuts in `appChecks.ts`; `surfaces.test.mjs`), page tabs (`pages.ts`, `pageNames.ts`), consent copy (`consent.ts`), socket methods
  (`socketMethods.ts`).
- `platform/plugins.ts` binds `ArdiaPlugins` (`packages/shell/ios/PluginsModule.swift`, `PluginFolder.swift`,
  `PluginProcess.swift`, `PluginCore/PluginSandbox.swift` (tested by `packages/shell/plugin-tests`, run by `swift test` in `packages/shell`), `PluginPageView.swift`, `PluginSchemeHandler.swift`).
- The Plugins menu: `MainMenu.swift` builds it from the menu state's `plugins`, each item the `runPluginCommand` command.
- UI: `components/toolbar/PluginToolbarButtons.tsx` (placed by `Toolbar.tsx`, its width in `trailingButtons.ts`), `components/settings/panes/Plugins.tsx`, `components/plugins/PluginPage.tsx` (rendered by `components/pages/InternalPage.tsx`), `components/plugins/PluginBanner.tsx` (in `TabPane`, under the share bar).
- The example plugin used by the tests: `tests/fixtures/plugins/example/`.

## Telemetry

Counts only, never plugin names, titles, URLs, row values, tool input or output:
`usage_counts.plugin_enables`, `plugin_disables`, `plugin_process_starts`, `plugin_process_crashes`,
`plugin_commands_run`, `plugin_tool_calls`, `plugin_tool_failures`, `plugin_page_opens`, `plugin_split_opens`,
`plugin_arrange_calls`, `plugin_arrange_failures` (`apply`, `group.withPage`, `split.toGroup`), `plugin_browse_calls`,
`plugin_browse_failures`, `plugin_browse_leases` (token server started only for a plugin), `plugin_banners_shown`,
`plugin_banner_stops`, `plugin_values_set`, `plugin_toolbar_presses` (a plugin's toolbar button), `plugin_menu_runs`
(its Plugins menu item or shortcut); the daily settings snapshot's
`plugins_installed`, `plugins_enabled` and, among those on, how many use each contribution:
`plugins_with_settings`, `plugins_with_commands`, `plugins_with_page`, `plugins_with_process`,
`plugins_with_hooks`, `plugins_with_tools`, `plugins_with_toolbar`. Dashboard: watch `plugin_toolbar_presses` and
`plugin_menu_runs` against `plugins_with_toolbar` for whether the button and shortcut get used, `plugin_process_crashes` against
`plugin_process_starts`, `plugin_browse_failures` against `plugin_browse_calls`, and `plugin_arrange_failures`
against `plugin_arrange_calls`.

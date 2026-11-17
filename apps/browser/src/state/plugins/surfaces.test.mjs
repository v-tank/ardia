import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startPlugins } = await import("./start.ts");
const { usePlugins, activeManifest } = await import("./store.ts");
const lifecycle = await import("./lifecycle.ts");
const { consentLines } = await import("./consent.ts");
const { pluginToolbarButtons, pluginShortcutSources } = await import("./surfaces.ts");
const { shortcutOf } = await import("../commands/commandShortcuts.ts");
const { menuState } = await import("../commands/menuState.ts");
const { runCommand } = await import("../commands/commands.ts");
const { takePluginCounts } = await import("../telemetry/pluginCounts.ts");

const FIXTURE = JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8"));
const S = () => useBrowser.getState();
const P = () => usePlugins.getState();
const host = stub.pluginHost;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const withToolbar = (toolbar) => JSON.stringify({ ...FIXTURE, toolbar: { ...FIXTURE.toolbar, ...toolbar } });

after(() => lifecycle.disablePlugin("example"));

async function listed(text, shortcuts = {}) {
  S().hydrate({});
  S().updateSettings({ shortcuts });
  startPlugins();
  for (const name of Object.keys(P().records)) lifecycle.disablePlugin(name);
  host.folders = [{ name: "example", status: "ok", text }];
  await lifecycle.rescanPlugins();
  return P().listings.example;
}

async function turnedOn(text) {
  await listed(text);
  assert.ok(lifecycle.requestPluginConsent("example"));
  assert.ok(lifecycle.enablePlugin("example", P().consent.hash));
  await settle();
}

test("a toolbar shortcut Ardia already uses, or one without cmd or ctrl, is a manifest problem", async () => {
  assert.deepEqual((await listed(withToolbar({ shortcut: "cmd+e" }))).problems, ["plugin.json: toolbar.shortcut ⌘E is taken by Use Selection for Find"]);
  assert.deepEqual((await listed(withToolbar({ shortcut: "cmd+q" }))).problems.length, 1, "the menu bar's own keys count");
  assert.match((await listed(withToolbar({ shortcut: "shift+e" }))).problems[0], /needs cmd or ctrl/);
  assert.match((await listed(withToolbar({ shortcut: "cmd+nope" }))).problems[0], /isn't a shortcut/);
  assert.match((await listed(withToolbar({ shortcut: "cmd+shift+e" }), { useSelectionForFind: ["e", "command", "shift"] })).problems[0], /taken by Use Selection for Find/, "a rebound command keeps its new key");
  assert.deepEqual((await listed(withToolbar({ shortcut: "cmd+e" }), { useSelectionForFind: [""] })).problems, [], "an unbound key is free");
  assert.deepEqual((await listed(withToolbar({ shortcut: "cmd+shift+e" }))).problems, []);
});

test("the consent sheet names the toolbar button and its shortcut", async () => {
  const listing = await listed(withToolbar({ shortcut: "cmd+shift+e" }));
  assert.ok(consentLines(listing.manifest).some((l) => l.text === "Adds a toolbar button: Say Hello (⇧⌘E)"));
  const plain = await listed(JSON.stringify({ ...FIXTURE, toolbar: { title: "Say Hello", icon: "hand.wave", command: "say-hello" } }));
  assert.ok(consentLines(plain.manifest).some((l) => l.text === "Adds a toolbar button: Say Hello"));
});

test("a plugin that's on has its button, menu item and shortcut, and off has none of them", async () => {
  await turnedOn(withToolbar({ shortcut: "cmd+shift+e" }));
  assert.ok(activeManifest(P(), "example"));
  assert.deepEqual(pluginToolbarButtons(P()), [{ id: "example/say-hello", plugin: "example", title: "Say Hello", icon: "hand.wave" }]);
  assert.deepEqual(shortcutOf("runPluginCommand:example/say-hello"), { key: "e", modifiers: ["shift", "command"] });
  assert.deepEqual(menuState(S()).plugins, [{ id: "example/say-hello", title: "Say Hello", icon: "hand.wave" }]);

  const w = S().createWindow({ url: "https://a.example/" });
  const before = host.events.length;
  runCommand({ command: "runPluginCommand", arg: "example/say-hello", windowId: w });
  await settle();
  const call = host.events.slice(before).map((e) => JSON.parse(e.line)).find((e) => e.call && e.tool === "hello");
  assert.deepEqual(call?.caller, { kind: "command" }, "it runs the command as the command bar would");
  const counts = takePluginCounts();
  assert.equal(counts.plugin_menu_runs, 1);
  assert.equal(counts.plugin_commands_run, 1);

  lifecycle.disablePlugin("example");
  await settle();
  assert.deepEqual(pluginToolbarButtons(P()), []);
  assert.equal(shortcutOf("runPluginCommand:example/say-hello"), undefined);
  assert.deepEqual(menuState(S()).plugins, []);
});

test("two plugins asking for one shortcut: the first in order keeps it", () => {
  const manifest = { ...JSON.parse(withToolbar({ shortcut: "cmd+shift+e" })), toolbar: { title: "A", icon: "a.circle", command: "say-hello", shortcut: "cmd+shift+e" } };
  const listing = (name) => ({ name, manifest: { ...manifest, name, toolbar: manifest.toolbar, settings: { defaults: {}, rows: [] }, commands: [{ name: "say-hello" }] }, problems: [], hash: name });
  const s = { order: ["one", "two"], listings: { one: listing("one"), two: listing("two") }, records: { one: { enabled: true, approved: "one" }, two: { enabled: true, approved: "two" } } };
  assert.deepEqual(
    pluginShortcutSources(s).map((x) => [x.id, x.keys.length]),
    [
      ["runPluginCommand:one/say-hello", 1],
      ["runPluginCommand:two/say-hello", 0],
    ],
  );
});

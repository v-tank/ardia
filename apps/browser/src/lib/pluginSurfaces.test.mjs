import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { readManifest, contributionsOf } = await import("./pluginManifest.ts");

const FIXTURE = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8"));
const read = (doc) => readManifest(JSON.stringify(doc));

test("toolbar names one of the plugin's commands, with a title, an icon and maybe a shortcut", () => {
  const { manifest, problems } = read(FIXTURE);
  assert.deepEqual(problems, []);
  assert.deepEqual(manifest.toolbar, { title: "Say Hello", icon: "hand.wave", command: "say-hello", shortcut: "ctrl+opt+cmd+h" });
  assert.ok(contributionsOf(manifest).includes("toolbar"));
  const { toolbar: _toolbar, ...without } = FIXTURE;
  assert.equal(read(without).manifest.toolbar, null);
  assert.equal(read({ ...FIXTURE, toolbar: { title: "Hi", icon: "hand.wave", command: "say-hello" } }).manifest.toolbar.shortcut, null);
});

test("every toolbar problem is reported with its path", () => {
  const problems = read({ ...FIXTURE, toolbar: { title: "", icon: "Not A Symbol", command: "missing", shortcut: 5, extra: true } }).problems;
  assert.ok(problems.includes("plugin.json: toolbar.extra isn't a key of toolbar"), problems.join("\n"));
  assert.ok(problems.includes("plugin.json: toolbar.title must be text of 1 to 40 characters"));
  assert.ok(problems.includes("plugin.json: toolbar.icon must be an SF Symbol name"));
  assert.ok(problems.includes("plugin.json: toolbar.shortcut must be text of 1 to 40 characters"));
  assert.deepEqual(read({ ...FIXTURE, toolbar: { title: "Hi", icon: "hand.wave", command: "missing" } }).problems, ["plugin.json: toolbar.command: missing isn't one of this plugin's commands"]);
  assert.deepEqual(read({ ...FIXTURE, toolbar: [] }).problems, ['plugin.json: toolbar must be an object like {"title", "icon", "command"}']);
});

const { modePagePath, pagePathOf } = await import("./pluginSurfaces.ts");

test("newTab adds a mode, a button or both, and needs a page", () => {
  const { manifest, problems } = read(FIXTURE);
  assert.deepEqual(problems, []);
  assert.deepEqual(manifest.newTab, {
    mode: { title: "Hello", placeholder: "Say hello to the example…", defaultRow: "mood", defaultValue: "busy", path: "chats/{id}" },
    button: { title: "Example History", icon: "clock.arrow.circlepath", path: "history" },
  });
  assert.ok(contributionsOf(manifest).includes("newTab"));
  assert.equal(read({ ...FIXTURE, newTab: { button: FIXTURE.newTab.button } }).manifest.newTab.mode, null);
  const { page: _page, commands, ...pageless } = FIXTURE;
  assert.ok(read({ ...pageless, commands: commands.filter((c) => !c.open) }).problems.includes("plugin.json: newTab needs a page"));
  assert.deepEqual(read({ ...FIXTURE, newTab: {} }).problems, ["plugin.json: newTab needs a mode, a button or both"]);
});

test("a mode's default names a choice row and one of its values; paths stay inside the page", () => {
  const mode = (change) => read({ ...FIXTURE, newTab: { mode: { ...FIXTURE.newTab.mode, ...change } } }).problems;
  assert.deepEqual(mode({ defaultRow: "greeting" }), ["plugin.json: newTab.mode.defaultRow: greeting isn't one of this plugin's choice rows"]);
  assert.deepEqual(mode({ defaultValue: "angry" }), ["plugin.json: newTab.mode.defaultValue: angry isn't one of mood's values"]);
  assert.ok(mode({ defaultValue: undefined }).includes("plugin.json: newTab.mode: defaultRow and defaultValue go together"));
  assert.match(mode({ path: "chats?x=1" })[0], /no query/);
  assert.match(mode({ path: "../up" })[0], /must be a path in the plugin's page/);
  assert.match(mode({ title: "A title far too long" })[0], /newTab.mode.title must be text of 1 to 16 characters/);
  assert.deepEqual(mode({ path: "/{id}" }), []);
});

test("{id} becomes the id given, the path gets its slash, and the typed text rides along as ?q=", () => {
  assert.equal(pagePathOf("{id}", "abc"), "/abc");
  assert.equal(pagePathOf("/chats/{id}", "abc"), "/chats/abc");
  assert.equal(pagePathOf("history", "abc"), "/history");
  const mode = { path: "{id}" };
  assert.equal(modePagePath(mode, "u-1", "  what's on my tabs?  "), "/u-1?q=what's%20on%20my%20tabs%3F");
  assert.equal(modePagePath(mode, "u-1", ""), "/u-1");
  assert.ok(modePagePath(mode, "u-1", "x".repeat(2000)).length <= 512, "a long question is cut to fit a page path");
});

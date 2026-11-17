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

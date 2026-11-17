import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startPlugins } = await import("./start.ts");
const { usePlugins } = await import("./store.ts");
const lifecycle = await import("./lifecycle.ts");
const { consentLines } = await import("./consent.ts");
const { pluginNewTabModes, pluginNewTabButtons, startingMode, shownMode, nextMode, newTabModeTarget, openNewTabButton } = await import("./newTab.ts");
const { takePluginCounts } = await import("../telemetry/pluginCounts.ts");

const FIXTURE = readFileSync(new URL("../../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8");
const S = () => useBrowser.getState();
const P = () => usePlugins.getState();
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

after(() => lifecycle.disablePlugin("example"));

async function turnedOn() {
  S().hydrate({});
  startPlugins();
  for (const name of Object.keys(P().records)) lifecycle.disablePlugin(name);
  stub.pluginHost.folders = [{ name: "example", status: "ok", text: FIXTURE }];
  await lifecycle.rescanPlugins();
  assert.ok(lifecycle.requestPluginConsent("example"));
  assert.ok(lifecycle.enablePlugin("example", P().consent.hash));
  await settle();
}

test("the consent sheet names the New Tab mode and button", async () => {
  await turnedOn();
  const lines = consentLines(P().listings.example.manifest).map((l) => l.text);
  assert.ok(lines.includes("Adds a Hello mode to the New Tab box, which opens its page with what you type"), lines.join("\n"));
  assert.ok(lines.includes("Adds a button to New Tab: Example History"));
});

test("the New Tab box starts in the mode its choice row picks, and Tab cycles Search and the modes", async () => {
  await turnedOn();
  const modes = pluginNewTabModes(P());
  assert.deepEqual(modes, [{ plugin: "example", title: "Hello", placeholder: "Say hello to the example…", icon: "sparkles", startsOn: false }]);
  assert.equal(startingMode(modes), null, "mood is calm, so New Tab starts in Search");
  lifecycle.setPluginValue("example", "mood", "busy");
  const busy = pluginNewTabModes(P());
  assert.equal(startingMode(busy), "example");
  assert.equal(nextMode(null, busy), "example");
  assert.equal(nextMode("example", busy), null);
  assert.equal(nextMode(null, busy, true), "example");
  assert.equal(shownMode("gone", busy), null, "a mode whose plugin left shows as Search");
  assert.equal(nextMode(null, []), null);
  lifecycle.setPluginValue("example", "mood", "calm");
});

test("Enter in a mode opens the plugin's page with a fresh id and the text; a typed URL stays a URL", async () => {
  await turnedOn();
  const first = newTabModeTarget("example", "hello there");
  const second = newTabModeTarget("example", "hello there");
  assert.equal(first.asked, true);
  const [, id, q] = /^ardia:\/\/example\/chats\/([^?]+)\?q=(.*)$/.exec(first.url) ?? [];
  assert.match(id, UUID);
  assert.equal(q, "hello%20there");
  assert.notEqual(first.url, second.url, "each ask opens its own page");
  assert.deepEqual(newTabModeTarget("example", "example.com"), { url: "https://example.com", asked: false });
  assert.equal(newTabModeTarget("example", "   "), null);
});

test("the New Tab button replaces the empty New Tab with its page, or opens a tab beside a page", async () => {
  await turnedOn();
  takePluginCounts();
  const w = S().createWindow({});
  const blank = S().newTab(w, {});
  S().activate(blank);
  assert.equal(openNewTabButton(w, "example"), blank);
  assert.equal(S().tabs[blank].url, "ardia://example/history");
  const again = openNewTabButton(w, "example");
  assert.equal(again, blank, "the page already open is the one it goes to");
  const counts = takePluginCounts();
  assert.equal(counts.plugin_newtab_button_presses, 2);
});

test("a plugin that's off has no mode and no button", async () => {
  await turnedOn();
  lifecycle.disablePlugin("example");
  await settle();
  assert.deepEqual(pluginNewTabModes(P()), []);
  assert.deepEqual(pluginNewTabButtons(P()), []);
  assert.equal(newTabModeTarget("example", "hello"), null);
  assert.equal(openNewTabButton(S().windowOrder[0], "example"), null);
});

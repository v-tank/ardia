import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startPlugins } = await import("./start.ts");
const { usePlugins, activeManifest, needsReview } = await import("./store.ts");
const lifecycle = await import("./lifecycle.ts");
const { pluginBarActions, runPluginAction } = await import("./commands.ts");
const { usePluginPages, pageViewUrl, openPluginPage } = await import("./pages.ts");
const { isInternalTab } = await import("../pages/urls.ts");
const { processExited, CRASH_LIMIT } = await import("./process.ts");
const { callTool } = await import("./tools.ts");
const { pluginSocketMethod } = await import("./socketMethods.ts");
const { takePluginCounts } = await import("../telemetry/pluginCounts.ts");
const { consentLines } = await import("./consent.ts");
const { useToasts } = await import("../app/toasts.ts");

const FIXTURE = readFileSync(new URL("../../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8");
const S = () => useBrowser.getState();
const P = () => usePlugins.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};
const host = stub.pluginHost;
let nextId = 0;

after(() => lifecycle.disablePlugin("example"));

function resetHost() {
  for (const key of ["starts", "stops", "replies", "events", "removed"]) host[key].length = 0;
  host.startResult = null;
}

async function install(text = FIXTURE, name = "example") {
  host.folders = [{ name, status: "ok", text }];
  await lifecycle.rescanPlugins();
}

async function enabled() {
  S().hydrate({});
  startPlugins();
  for (const name of Object.keys(P().records)) lifecycle.disablePlugin(name);
  resetHost();
  await install();
  assert.ok(lifecycle.requestPluginConsent("example"));
  const { hash } = P().consent;
  assert.ok(lifecycle.enablePlugin("example", hash));
  await settle();
  return P().processes.example.run;
}

function helper(method, params, run) {
  const id = ++nextId;
  const before = host.replies.length;
  stub.emitPluginLine({ name: "example", run, line: JSON.stringify({ id, method, params }) });
  return { id, before };
}

async function ask(method, params, run) {
  const { id, before } = helper(method, params, run);
  await settle();
  const reply = host.replies.slice(before).map((r) => JSON.parse(r.line)).find((r) => r.id === id);
  assert.ok(reply, `a reply to ${method}`);
  return reply;
}

beforeEach(() => takePluginCounts());

test("an installed plugin stays off until its consent is accepted, then starts its helper sandboxed without network", async () => {
  S().hydrate({});
  startPlugins();
  resetHost();
  await install();
  assert.equal(activeManifest(P(), "example"), null);
  assert.equal(host.starts.length, 0);
  assert.equal(lifecycle.enablePlugin("example", "0".repeat(64)), false, "a stale hash never turns it on");
  const run = await enabled();
  assert.ok(run > 0);
  assert.deepEqual(host.starts.at(-1), { name: "example", run: ["/usr/bin/python3", "helper.py"], memoryMB: 256, network: false });
  assert.equal(P().processes.example.state, "running");
  const counts = takePluginCounts();
  assert.equal(counts.plugin_enables, 1);
  assert.equal(counts.plugin_process_starts, 1);
});

test("the consent sheet names every reach the plugin gets", () => {
  const lines = consentLines(P().listings.example.manifest).map((l) => l.text).join("\n");
  for (const words of ["/usr/bin/python3 helper.py", "can't connect beyond", "title of your tabs", "tab.activated", "Runs Ardia commands", "commandBarStart", "ardia://example", "handed the tab you're on", "Say Hello", "Offers tools"]) assert.ok(lines.includes(words), words);
});

test("settings defaults apply on enable and go back on disable, unless changed since", async () => {
  S().hydrate({});
  const before = S().settings.commandBarStart;
  await enabled();
  assert.deepEqual(S().settings.commandBarStart, { openTabs: { limit: 5 } });
  lifecycle.disablePlugin("example");
  assert.deepEqual(S().settings.commandBarStart, before);
  await enabled();
  S().updateSettings({ commandBarStart: { openTabs: { limit: 3 } } });
  lifecycle.disablePlugin("example");
  assert.deepEqual(S().settings.commandBarStart, { openTabs: { limit: 3 } }, "a value changed since stays");
});

test("config.json wins over a plugin's defaults", async () => {
  stub.configFolder.files.set("config.json", JSON.stringify({ settings: { commandBarStart: { openTabs: { limit: 2 } } } }));
  try {
    await enabled();
    assert.notDeepEqual(S().settings.commandBarStart, { openTabs: { limit: 5 } });
    assert.deepEqual(P().records.example.applied, {});
  } finally {
    stub.configFolder.files.delete("config.json");
    lifecycle.disablePlugin("example");
  }
});

test("the helper's channel: hello, values, permissions and hooks", async () => {
  const run = await enabled();
  const hello = await ask("hello", {}, run);
  assert.equal(hello.result.plugin, "example");
  assert.deepEqual(hello.result.values, { greeting: "Hello", loud: false, mood: "calm", side: "right" });
  assert.equal((await ask("subscribe", { events: ["window.closed"] }, run)).error.code, "refused");
  assert.deepEqual((await ask("subscribe", { events: ["*"] }, run)).result, { ok: true });
  assert.ok(Array.isArray((await ask("windows", {}, run)).result));
  assert.equal((await ask("page.serve", { url: "http://127.0.0.1:9/" }, run)).error.code, "refused", "a file page isn't served");
  assert.equal((await ask("nope", {}, run)).error.code, "unknown_method");
  lifecycle.setPluginValue("example", "greeting", "Hi");
  const sent = host.events.map((e) => JSON.parse(e.line)).filter((e) => e.event === "plugin.values");
  assert.equal(sent.at(-1).data.values.greeting, "Hi");
  lifecycle.setPluginValue("example", "mood", "furious");
  assert.equal(P().records.example.values.mood, "calm", "a value outside the row's choices is refused");
});

test("hook events reach a subscribed helper, with minimized URLs", async () => {
  const run = await enabled();
  await ask("subscribe", { events: ["tab.opened"] }, run);
  const from = host.events.length;
  const w = S().createWindow({ url: "https://a.example/page?secret=1#x" });
  await settle();
  const opened = host.events.slice(from).map((e) => JSON.parse(e.line)).filter((e) => e.event === "tab.opened");
  assert.ok(opened.length >= 1, "tab.opened arrived");
  assert.ok(opened.every((e) => !e.data.url.includes("secret")));
  S().closeWindow?.(w);
});

test("a command calls the plugin's tool and shows its message; the result goes back to the caller", async () => {
  const run = await enabled();
  const actions = pluginBarActions(P()).map((a) => a.id);
  assert.deepEqual(actions, ["plugin:example/page", "plugin:example/say-hello", "plugin:example/new-tab", "plugin:example/beside"]);
  const w = S().createWindow({ url: "https://a.example/" });
  const ran = runPluginAction("plugin:example/say-hello", w);
  await settle();
  const call = host.events.map((e) => JSON.parse(e.line)).findLast((e) => e.call && e.tool === "hello");
  assert.deepEqual(call.caller, { kind: "command" });
  const answered = await ask("result", { call: call.call, result: { message: "Hello there" } }, run);
  assert.deepEqual(answered.result, { ok: true });
  await ran;
  assert.equal(useToasts.getState().toasts[w]?.title, "Hello there");
  assert.equal((await ask("result", { call: call.call, result: 1 }, run)).error.code, "bad_request", "a second answer is refused");
  const counts = takePluginCounts();
  assert.equal(counts.plugin_commands_run, 1);
  assert.equal(counts.plugin_tool_calls, 1);
});

test("tools: the CLI and other plugins call them; unknown tools and stopped helpers fail clearly", async () => {
  const run = await enabled();
  const pending = pluginSocketMethod("plugins.call", { plugin: "example", tool: "seen", input: {} });
  await settle();
  const call = host.events.map((e) => JSON.parse(e.line)).findLast((e) => e.call && e.tool === "seen");
  assert.deepEqual(call.caller, { kind: "cli" });
  await ask("result", { call: call.call, result: { events: [] } }, run);
  assert.deepEqual(await pending, { result: { events: [] } });
  assert.equal((await callTool("example", "missing", {}, { kind: "cli" })).code, "bad_request");
  assert.equal((await callTool("other", "hello", {}, { kind: "cli" })).code, "refused");
  const { id, before } = helper("tools.call", { plugin: "example", tool: "hello" }, run);
  await settle();
  const nested = host.events.map((e) => JSON.parse(e.line)).findLast((e) => e.call && e.tool === "hello");
  assert.deepEqual(nested.caller, { kind: "plugin", plugin: "example" });
  await ask("result", { call: nested.call, error: "no greeting" }, run);
  const reply = host.replies.slice(before).map((r) => JSON.parse(r.line)).find((r) => r.id === id);
  assert.deepEqual(reply.error, { code: "failed", message: "no greeting" });
});

test("a crashing helper restarts with backoff, then stays stopped", async () => {
  const run = await enabled();
  processExited({ name: "example", run, status: 1, signal: null, overMemory: false }, 0);
  assert.equal(P().processes.example.state, "waiting");
  let state = P().processes.example;
  let now = 0;
  for (let i = 1; i < CRASH_LIMIT; i++) {
    usePlugins.setState({ processes: { ...P().processes, example: { state: "running", run: run + 100 + i, since: now } } });
    processExited({ name: "example", run: run + 100 + i, status: null, signal: 9, overMemory: i === 2 }, (now += 1000));
    state = P().processes.example;
  }
  assert.equal(state.state, "crashed");
  assert.equal(takePluginCounts().plugin_process_crashes, CRASH_LIMIT);
  lifecycle.disablePlugin("example");
});

test("a clean exit isn't restarted, and an old run's exit is ignored", async () => {
  const run = await enabled();
  processExited({ name: "example", run: run - 1, status: 1, signal: null, overMemory: false });
  assert.equal(P().processes.example.state, "running");
  processExited({ name: "example", run, status: 0, signal: null, overMemory: false });
  assert.equal(P().processes.example.state, "exited");
});

test("a changed manifest stops everything until reviewed; disabling withdraws commands, page and helper", async () => {
  await enabled();
  const w = S().createWindow({ url: "https://a.example/" });
  const page = openPluginPage(w, "example");
  assert.equal(pageViewUrl(P(), "example", null), "ardia-plugin://example/page/index.html");
  const changed = JSON.parse(FIXTURE);
  changed.permissions.push("network");
  await install(JSON.stringify(changed));
  assert.ok(needsReview(P(), "example"));
  assert.equal(activeManifest(P(), "example"), null);
  assert.equal(P().processes.example, undefined);
  assert.ok(host.stops.some((s) => s.name === "example"));
  assert.equal(pageViewUrl(P(), "example", null), null, "a changed plugin's page shows that it's off");
  assert.ok(isInternalTab(S().tabs[page]), "its tab stays an internal page, never a Chrome page");
  assert.deepEqual(pluginBarActions(P()), []);
  assert.ok(lifecycle.requestPluginConsent("example"));
  assert.ok(lifecycle.enablePlugin("example", P().consent.hash));
  await settle();
  assert.equal(host.starts.at(-1).network, true);
  lifecycle.disablePlugin("example");
  assert.equal(P().processes.example, undefined);
  assert.deepEqual(pluginBarActions(P()), []);
});

test("problems keep a plugin from loading; a folder whose name differs from the manifest is reported", async () => {
  await install(FIXTURE, "renamed");
  assert.equal(P().listings.renamed.manifest, null);
  assert.ok(P().listings.renamed.problems.some((p) => p.includes("its folder is renamed")));
  host.folders = [{ name: "broken", status: "tooBig" }];
  await lifecycle.rescanPlugins();
  assert.deepEqual(P().listings.broken.problems, ["plugin.json is over 1 MB"]);
});

test("socket methods list, enable (through the sheet), disable and remove", async () => {
  await enabled();
  const list = pluginSocketMethod("plugins", {}).result;
  assert.equal(list[0].name, "example");
  assert.equal(list[0].active, true);
  assert.deepEqual(list[0].contributes, ["settings", "commands", "page", "process", "hooks", "tools"]);
  assert.deepEqual(pluginSocketMethod("plugins.disable", { name: "example" }), { result: { ok: true } });
  assert.deepEqual(pluginSocketMethod("plugins.enable", { name: "example" }), { result: { waiting: true } });
  assert.equal(activeManifest(P(), "example"), null, "enabling from the CLI only opens the sheet");
  lifecycle.dismissPluginConsent();
  assert.deepEqual(await pluginSocketMethod("plugins.remove", { name: "example" }), { result: { ok: true } });
  assert.deepEqual(host.removed, ["example"]);
  assert.equal(P().listings.example, undefined);
  assert.equal(P().records.example, undefined);
});

test("a helper can't reach through another plugin's tools to a permission it wasn't granted", async () => {
  const run = await enabled();
  const other = JSON.parse(FIXTURE);
  other.name = "other";
  other.permissions = ["tabs", "commands", "network"];
  host.folders = [{ name: "example", status: "ok", text: FIXTURE }, { name: "other", status: "ok", text: JSON.stringify(other) }];
  await lifecycle.rescanPlugins();
  assert.ok(lifecycle.requestPluginConsent("other"));
  assert.ok(lifecycle.enablePlugin("other", P().consent.hash));
  await settle();
  const refused = await ask("tools.call", { plugin: "other", tool: "hello" }, run);
  assert.equal(refused.error.code, "refused");
  assert.match(refused.error.message, /network/);
  lifecycle.disablePlugin("other");
});

test("the page is a tab at ardia://<name>; a command opens it beside the current tab, handing it that tab", async () => {
  await enabled();
  const w = S().createWindow({ url: "https://a.example/read?id=7#top" });
  const reading = S().windows[w].tabIds[0];
  S().updateTab(reading, { url: "https://a.example/read?id=7#top", title: "Reading" });
  takePluginCounts();
  await runPluginAction("plugin:example/beside", w);
  const split = Object.values(S().splits ?? {}).find((sp) => JSON.stringify(sp).includes(reading));
  const page = S().windows[w].tabIds.find((id) => S().tabs[id].url === "ardia://example");
  assert.ok(page, "a tab at ardia://example");
  assert.ok(isInternalTab(S().tabs[page]));
  assert.ok(split && JSON.stringify(split).includes(page), "the page and the tab share a split");
  const context = usePluginPages.getState().contexts[page];
  assert.deepEqual(context, { tabId: reading, url: "https://a.example/read", title: "Reading" });
  assert.match(pageViewUrl(P(), "example", context), /^ardia-plugin:\/\/example\/page\/index\.html\?ardiaContext=/);
  const counts = takePluginCounts();
  assert.equal(counts.plugin_split_opens, 1);
  assert.equal(counts.plugin_page_opens, 1);
  lifecycle.setPluginValue("example", "side", "left");
  assert.equal(P().records.example.values.side, "left");
  assert.equal(openPluginPage(w, "example"), page, "opening again goes to the same tab");
  lifecycle.disablePlugin("example");
});

test("two plugins setting the same setting: whichever leaves, the other's value or the original comes back", async () => {
  S().hydrate({});
  startPlugins();
  for (const name of Object.keys(P().records)) lifecycle.disablePlugin(name);
  const original = S().settings.commandBarStart;
  const second = JSON.parse(FIXTURE);
  second.name = "second";
  second.settings.defaults = { commandBarStart: { openTabs: { limit: 2 } } };
  host.folders = [{ name: "example", status: "ok", text: FIXTURE }, { name: "second", status: "ok", text: JSON.stringify(second) }];
  await lifecycle.rescanPlugins();
  const on = (name) => (assert.ok(lifecycle.requestPluginConsent(name)), assert.ok(lifecycle.enablePlugin(name, P().consent.hash)));
  on("example");
  on("second");
  assert.deepEqual(S().settings.commandBarStart, { openTabs: { limit: 2 } });
  lifecycle.disablePlugin("example");
  assert.deepEqual(S().settings.commandBarStart, { openTabs: { limit: 2 } }, "the plugin still on keeps its value");
  lifecycle.disablePlugin("second");
  assert.deepEqual(S().settings.commandBarStart, original, "the value from before either plugin comes back, not the first plugin's");
});

test("a plugin can't set settings that need their own approval", async () => {
  const doc = JSON.parse(FIXTURE);
  doc.settings.defaults = { launchActions: ["newTab"] };
  await install(JSON.stringify(doc));
  assert.equal(P().listings.example.manifest, null);
  assert.ok(P().listings.example.problems.some((p) => p.includes("launchActions needs its own approval")));
});

test("pages take a path: each path is its own tab, and a helper opens them with page.open", async () => {
  const run = await enabled();
  const w = S().createWindow({ url: "https://a.example/" });
  const history = openPluginPage(w, "example", { path: "/history" });
  const chat = openPluginPage(w, "example", { path: "/chats/42?draft=1" });
  assert.notEqual(history, chat);
  assert.equal(S().tabs[chat].url, "ardia://example/chats/42?draft=1");
  assert.ok(isInternalTab(S().tabs[chat]));
  assert.equal(openPluginPage(w, "example", { path: "/history" }), history, "the same path goes back to its tab");
  assert.equal(openPluginPage(w, "example", { path: "/../x" }), null);
  assert.match(pageViewUrl(P(), "example", null, "/chats/42?draft=1"), /\?ardiaPath=%2Fchats%2F42%3Fdraft%3D1$/);
  const opened = await ask("page.open", { path: "/chats/7", split: true, side: "left" }, run);
  assert.ok(opened.result.tabId);
  assert.equal(S().tabs[opened.result.tabId].url, "ardia://example/chats/7");
  assert.equal((await ask("page.open", { path: "nope path" }, run)).error.code, "bad_request");
  lifecycle.disablePlugin("example");
});

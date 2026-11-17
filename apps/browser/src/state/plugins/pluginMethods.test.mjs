import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startPlugins } = await import("./start.ts");
const { usePlugins } = await import("./store.ts");
const lifecycle = await import("./lifecycle.ts");
const { openPluginPage } = await import("./pages.ts");
const { usePluginBanners, pressBannerStop } = await import("./banners.ts");
const { browseLeased } = await import("./browseServer.ts");
const { takePluginCounts } = await import("../telemetry/pluginCounts.ts");
const { consentLines } = await import("./consent.ts");
const { splitOf } = await import("../splits/splits.ts");

const FIXTURE = JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/plugins/example/plugin.json", import.meta.url), "utf8"));
const S = () => useBrowser.getState();
const P = () => usePlugins.getState();
const host = stub.pluginHost;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await tick();
};
const globals = globalThis;
let nextId = 0;

after(() => lifecycle.disablePlugin("example"));
beforeEach(() => takePluginCounts());

async function enabled(permissions = ["tabs", "commands", "arrange", "pages"]) {
  S().hydrate({});
  startPlugins();
  for (const name of Object.keys(P().records)) lifecycle.disablePlugin(name);
  for (const key of ["starts", "stops", "replies", "events", "removed", "browses"]) host[key].length = 0;
  host.folders = [{ name: "example", status: "ok", text: JSON.stringify({ ...FIXTURE, permissions }) }];
  await lifecycle.rescanPlugins();
  assert.ok(lifecycle.requestPluginConsent("example"));
  assert.ok(lifecycle.enablePlugin("example", P().consent.hash));
  await settle();
  return P().processes.example.run;
}

async function ask(method, params, run) {
  const id = ++nextId;
  const before = host.replies.length;
  stub.emitPluginLine({ name: "example", run, line: JSON.stringify({ id, method, params }) });
  for (let i = 0; i < 40; i++) {
    const reply = host.replies.slice(before).map((r) => JSON.parse(r.line)).find((r) => r.id === id);
    if (reply) return reply;
    await tick();
  }
  assert.fail(`no reply to ${method}`);
}

function windowWith(urls) {
  const w = S().createWindow({ url: urls[0] });
  for (const url of urls.slice(1)) S().newTab(w, { url });
  const tabs = S().windows[w].tabIds.filter((id) => !S().tabs[id].url.startsWith("ardia://"));
  tabs.forEach((id, i) => S().updateTab(id, { url: urls[i], title: `Page ${i}` }));
  return { w, tabs };
}

const sentEvents = (name) => host.events.map((e) => JSON.parse(e.line)).filter((e) => e.event === name);

test("the new reach is on the consent sheet, and arrange and pages need tabs", () => {
  const lines = consentLines({ ...lifecycle.listingsOf([{ name: "example", status: "ok", text: JSON.stringify({ ...FIXTURE, permissions: ["tabs", "arrange", "pages"] }) }])[0].manifest }).map((l) => l.text);
  assert.ok(lines.includes("Opens, moves, groups and closes your tabs"));
  assert.ok(lines.includes("Reads and acts on the pages in your tabs"));
  const problems = lifecycle.listingsOf([{ name: "example", status: "ok", text: JSON.stringify({ ...FIXTURE, permissions: ["commands", "arrange", "pages"], hooks: [] }) }])[0].problems;
  assert.ok(problems.some((p) => p.includes("arrange needs tabs")));
  assert.ok(problems.some((p) => p.includes("pages needs tabs")));
});

test("without arrange and pages, the methods that need them are refused", async () => {
  const run = await enabled(["tabs", "commands"]);
  for (const [method, params] of [["apply", { ops: [] }], ["group.withPage", { tab: "x" }], ["split.toGroup", { tab: "x" }], ["browse", { tab: "x", argv: ["snapshot"] }], ["tab.banner", { tab: "x", text: "hi" }]]) {
    assert.equal((await ask(method, params, run)).error.code, "refused", method);
  }
});

test("workspace is the socket's tree, with URLs minimized and the plugin's page tabs at their path", async () => {
  const run = await enabled();
  const { w } = windowWith(["https://a.example/read?secret=1#x"]);
  const page = openPluginPage(w, "example", { path: "/chats/42?draft=1" });
  const reply = await ask("workspace", { window: w }, run);
  const nodes = reply.result.windows[0].spaces.flatMap((sp) => sp.tabs);
  assert.ok(nodes.some((n) => n.url === "https://a.example/read"), "a web tab without its query");
  assert.ok(nodes.some((n) => n.id === page && n.url === "ardia://example/chats/42"), "its own page tab at its path");
  assert.ok(!JSON.stringify(reply.result).includes("secret"));
  assert.equal((await ask("workspace", { window: "nope" }, run)).error.code, "no_window");
  const priv = S().createWindow({ url: "https://p.example/", kind: "private" });
  const all = await ask("workspace", {}, run);
  assert.ok(!all.result.windows.some((win) => win.id === priv), "a private window never appears");
});

test("apply runs the socket's operations and answers with minimized URLs", async () => {
  const run = await enabled();
  const { tabs } = windowWith(["https://a.example/?q=1", "https://b.example/"]);
  const reply = await ask("apply", { ops: [{ op: "group.create", tabs, name: "Reading" }] }, run);
  assert.equal(reply.result.ok, true);
  assert.equal(S().groups[reply.result.results[0].group].name, "Reading");
  assert.ok(reply.result.tabs.every((t) => !t.url.includes("?")));
  assert.equal((await ask("apply", { ops: [{ op: "nope" }] }, run)).error.code, "bad_request");
  assert.ok(takePluginCounts().plugin_arrange_calls >= 1);
});

test("group.withPage makes a group headed by the page tab, then moves more tabs into it after the page", async () => {
  const run = await enabled();
  const { w, tabs } = windowWith(["https://a.example/", "https://b.example/", "https://c.example/"]);
  const page = openPluginPage(w, "example", { path: "/chats/1" });
  S().updateTab(page, { title: "Trip planning" });
  const made = await ask("group.withPage", { tab: page, tabs: [tabs[0]] }, run);
  assert.deepEqual(made.result.tabs, [page, tabs[0]]);
  const group = S().groups[made.result.group];
  assert.equal(group.name, "Trip planning");
  assert.match(String(group.icon), /sparkles/);
  const more = await ask("group.withPage", { tab: page, tabs: [tabs[1]] }, run);
  assert.equal(more.result.group, made.result.group);
  assert.deepEqual(more.result.tabs, [page, tabs[1], tabs[0]], "moved in right after the page");
  assert.equal((await ask("group.withPage", { tab: tabs[2] }, run)).error.code, "refused", "only its own page tabs");
  S().activate(tabs[2]);
  const other = openPluginPage(w, "example", { path: "/chats/2", split: true });
  assert.ok(splitOf(S(), other));
  const inSplit = await ask("group.withPage", { tab: other }, run);
  assert.equal(inSplit.error?.code, "in_split", JSON.stringify(inSplit));
});

test("split.toGroup turns the page's Split View into a group, page first", async () => {
  const run = await enabled();
  const { w, tabs } = windowWith(["https://a.example/"]);
  S().activate(tabs[0]);
  const page = openPluginPage(w, "example", { path: "/side", split: true });
  assert.ok(splitOf(S(), page));
  const reply = await ask("split.toGroup", { tab: page }, run);
  assert.deepEqual(reply.result.tabs, [page, tabs[0]]);
  assert.equal(splitOf(S(), page), undefined);
  assert.ok(S().groups[reply.result.group]);
  assert.equal((await ask("split.toGroup", { tab: page }, run)).error.code, "not_in_split");
});

test("browse picks the exact tab in the plugin's own session, then runs the command through the ardia command", async () => {
  const run = await enabled();
  const { w, tabs } = windowWith(["https://a.example/form", "https://b.example/"]);
  const page = openPluginPage(w, "example", { path: "/x" });
  const control = [];
  globals.acTestCliControl = (on) => void control.push(on);
  globals.acTestCliTargets = (id) => ({ targetId: id === tabs[0] ? "T0" : null, pageGeneration: 1 });
  host.browseReply = (argv) => ({ ok: true, status: 0, timedOut: false, truncated: false, stdout: argv[0] === "tab" ? "✓ picked" : "- heading \"Form\" [ref=e1]", stderr: "" });
  try {
    const ok = await ask("browse", { tab: tabs[0], argv: ["snapshot", "-i"] }, run);
    assert.deepEqual(ok.result, { ok: true, text: "- heading \"Form\" [ref=e1]" });
    assert.deepEqual(host.browses.map((b) => b.argv), [["tab", "T0"], ["snapshot", "-i"]]);
    assert.ok(host.browses.every((b) => b.name === "example" && b.timeoutMs <= 60_000));
    assert.ok(control.includes(true), "the token server was started for the plugin");
    assert.ok(browseLeased(), "and held as a lease, not by turning on the setting");
    assert.equal(S().settings.cliControl, false);
    assert.equal((await ask("browse", { tab: page, argv: ["snapshot"] }, run)).error.code, "refused", "a plugin page isn't a web page");
    assert.equal((await ask("browse", { tab: tabs[0], argv: ["eval", "1"] }, run)).error.code, "bad_request");
    assert.equal((await ask("browse", { tab: tabs[0], argv: ["snapshot", "--session", "other"] }, run)).error.code, "bad_request");
    assert.equal((await ask("browse", { tab: tabs[0], argv: ["get", "text", "body", "--data-dir=/x"] }, run)).error.code, "bad_request");
    const asleep = await ask("browse", { tab: tabs[1], argv: ["snapshot"] }, run);
    assert.equal(asleep.result.ok, false);
    assert.match(asleep.result.error, /asleep/);
    host.browseReply = () => ({ ok: false, missing: true });
    const missing = await ask("browse", { tab: tabs[0], argv: ["snapshot"] }, run);
    assert.match(missing.result.error, /isn't installed/);
    host.browseReply = (argv) => ({ ok: true, status: argv[0] === "tab" ? 0 : 1, timedOut: false, truncated: false, stdout: "", stderr: "✗ Stale ref @e9" });
    assert.deepEqual((await ask("browse", { tab: tabs[0], argv: ["click", "@e9"] }, run)).result, { ok: false, error: "✗ Stale ref @e9" });
    const counts = takePluginCounts();
    assert.equal(counts.plugin_browse_calls, 4);
    assert.equal(counts.plugin_browse_failures, 3);
    assert.equal(counts.plugin_browse_leases, 1);
  } finally {
    delete globals.acTestCliControl;
    delete globals.acTestCliTargets;
    host.browseReply = null;
  }
});

test("tab.banner shows a strip whose Stop reaches the helper, and goes when the plugin stops or the tab closes", async () => {
  const run = await enabled();
  const { tabs } = windowWith(["https://a.example/", "https://b.example/"]);
  assert.deepEqual((await ask("tab.banner", { tab: tabs[0], text: "Claude is filling the form" }, run)).result, { ok: true });
  assert.equal(usePluginBanners.getState().banners[tabs[0]].text, "Claude is filling the form");
  assert.equal((await ask("tab.banner", { tab: tabs[0], text: "x".repeat(81) }, run)).error.code, "bad_request");
  pressBannerStop(tabs[0]);
  assert.deepEqual(sentEvents("plugin.bannerAction").at(-1).data, { tab: tabs[0] });
  assert.equal(usePluginBanners.getState().banners[tabs[0]].stopping, true);
  await ask("tab.banner", { tab: tabs[0], text: null }, run);
  assert.equal(usePluginBanners.getState().banners[tabs[0]], undefined);
  await ask("tab.banner", { tab: tabs[0], text: "one" }, run);
  await ask("tab.banner", { tab: tabs[1], text: "two" }, run);
  S().closeTab(tabs[1]);
  await settle();
  assert.equal(usePluginBanners.getState().banners[tabs[1]], undefined, "a closed tab's banner goes");
  lifecycle.disablePlugin("example");
  assert.deepEqual(usePluginBanners.getState().banners, {}, "a stopped plugin's banners go");
  const counts = takePluginCounts();
  assert.equal(counts.plugin_banners_shown, 3);
  assert.equal(counts.plugin_banner_stops, 1);
});

test("values.set checks the value against its row and tells the helper, as a change in Settings does", async () => {
  const run = await enabled();
  assert.deepEqual((await ask("values.set", { key: "mood", value: "busy" }, run)).result, { ok: true });
  assert.equal(P().records.example.values.mood, "busy");
  assert.equal(sentEvents("plugin.values").at(-1).data.values.mood, "busy");
  for (const [key, value] of [["mood", "furious"], ["loud", "yes"], ["greeting", "x".repeat(201)], ["nope", true]]) {
    assert.equal((await ask("values.set", { key, value }, run)).error.code, "bad_request", `${key}=${value}`);
  }
  assert.equal(takePluginCounts().plugin_values_set, 1);
});

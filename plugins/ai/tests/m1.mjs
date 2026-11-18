#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { attach, launch } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes("--help") || args.length < 3) {
  console.log(`Usage: m1.mjs <Debug app> <plugin folder> <out dir> --cli <cli home> [--metro PORT] [--model SLUG] [--keep] [--attach]
  Turns the AI plugin on in a hidden instance (no DevTools port, so the plugin's browse can start the ardia command's
  token server; <cli home>/current/bin/ardia is the ardia command), opens two pages, presses the toolbar button with a
  real click, asks about the page, has the agent open a tab (the permission ask, then the split becoming a group),
  and captures each state with screencapture into <out dir>/stills, plus the page's own snapshot beside each.`);
  process.exit(args.includes("--help") ? 0 : 1);
}
const [app, plugin, out] = args.slice(0, 3).map((a) => resolve(a));
const cli = option("--cli", null) && resolve(option("--cli"));
const metroPort = Number(option("--metro", 8081));
const model = option("--model", "claude-haiku-5-5");
const keep = args.includes("--keep");
const data = join(out, "data");
const stills = join(out, "stills");
mkdirSync(stills, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const results = {};

async function until(what, test, { seconds = 60, every = 500 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < end) {
    last = await test().catch((e) => (log(what, "…", e.message), null));
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let instance;
if (args.includes("--attach")) instance = attach(data);
else {
  if (!cli) throw new Error("--cli <cli home> is needed: browse runs <cli home>/current/bin/ardia");
  rmSync(data, { recursive: true, force: true });
  mkdirSync(join(data, "config", "plugins"), { recursive: true });
  cpSync(plugin, join(data, "config", "plugins", "ai"), { recursive: true, verbatimSymlinks: true });
  const bin = join(out, "clibin");
  mkdirSync(bin, { recursive: true });
  instance = await launch(app, { data, js: "live", metroPort, onboarded: true, devtools: false, instance: { cliHome: cli, cliBinDir: bin } });
}
log("instance", instance.pid);
const ev = (body, timeout = 30000) => instance.eval(body, { timeout });
const windowId = await ev(`return ac.store.getState().windowOrder[0]`);
const nativeWindow = await ev(`return ac.engine.call("windows.list", {}).then((l) => l.filter((w) => w.hasRoot).map((w) => ({ id: w.window, frame: w.frame })))`).then((l) => l[0]);
const width = Number(/\{\{[-\d.]+, [-\d.]+\}, \{([\d.]+), [\d.]+\}\}/.exec(nativeWindow.frame)?.[1] ?? 1360);
log("window", windowId, nativeWindow.id, width);

const click = (x, y) => ev(`const act = (a) => ac.engine.call("windows.dev", { window: ${nativeWindow.id}, action: a }); return act("mouse:down:${x},${y}").then(() => new Promise((r) => setTimeout(r, 80))).then(() => act("mouse:up:${x},${y}")).then(() => true)`);
const keys = (text) => ev(`return ac.shell.devTypeKeys(${JSON.stringify(windowId)}, ${JSON.stringify(text)}, 15).then(() => true)`, 60000);
const appearance = (mode) => ev(`ac.store.getState().updateSettings({ appearance: ${JSON.stringify(mode)} }); return true`);
const tabs = () => ev(`const s = ac.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, title: t.title, group: Object.values(s.groups ?? {}).find((g) => (g.tabIds ?? g.tabs ?? []).includes(t.id))?.id ?? null, split: Object.values(s.splits ?? {}).find((v) => JSON.stringify(v).includes(t.id))?.id ?? null }))`);

function capture(name) {
  const file = join(stills, `${name}.png`);
  try {
    execFileSync("timeout", ["20", "screencapture", "-x", "-o", "-l", String(nativeWindow.id), file]);
    log("captured", name);
  } catch (e) {
    results[name] = `screencapture failed: ${String(e.message).slice(0, 120)}`;
  }
  return ev(`return ac.plugins.snapshotPage("ai", ${JSON.stringify(join(stills, `${name}.page.png`))})`).catch(() => false);
}

if (!args.includes("--attach")) {
  await until("the plugin's listing", () => ev(`return ac.plugins.rescanPlugins().then(() => { const l = ac.plugins.usePlugins.getState().listings.ai; return l ? (l.problems.length ? { problems: l.problems } : true) : null; })`).then((r) => (r === true ? true : (r && log("problems", r.problems), null))));
  await ev(`return ac.plugins.approve("ai")`);
  await until("the helper to serve its page", () => ev(`return !!ac.plugins.usePlugins.getState().servedUrls.ai`), { seconds: 120 });
  await ev(`return ac.plugins.setPluginValue("ai", "model", ${JSON.stringify(model)})`);
  await ev(`return Promise.resolve(ac.actions.openUrls(["https://news.ycombinator.com/", "https://en.wikipedia.org/wiki/Browser_wars"], ${JSON.stringify(windowId)})).then(() => true)`);
  await until("Wikipedia to load", () => tabs().then((l) => l.find((t) => t.title?.includes("Browser wars"))), { seconds: 60 });
  await appearance("dark");
  await sleep(2000);
}

await click(width - 32, 30);
const chat = await until("the chat in a split", () => tabs().then((l) => l.find((t) => /^ardia:\/\/ai\/[0-9a-f-]{36}/.test(t.url ?? "") && t.split)), { seconds: 30 });
log("chat", chat);
await sleep(5000);
await keys("In two sentences, what is this page about?");
await keys("\r");
const answered = await until("the answer", () => ev(`return ac.plugins.snapshotPage("ai", ${JSON.stringify(join(out, "probe.png"))})`).then(() => tabs()).then((l) => l.find((t) => t.id === chat.id && t.title && t.title !== "AI" && t.title !== "New chat")), { seconds: 120, every: 2000 }).catch((e) => (results.answer = e.message, null));
await sleep(8000);
results.afterAsk = (await tabs()).find((t) => t.id === chat.id);
await capture("m1-split-dark");
await appearance("light");
await sleep(2500);
await capture("m1-split-light");
await appearance("dark");
await sleep(1500);

await keys("Open the English Wikipedia article on Netscape Navigator in a new tab.");
await keys("\r");
await sleep(20000);
await capture("m1-permission");
await keys("\r");
await until("the opened tab in the chat's group", () => tabs().then((l) => {
  const head = l.find((t) => t.id === chat.id);
  return head?.group && l.some((t) => t.group === head.group && /Netscape/i.test(t.url ?? ""));
}), { seconds: 120, every: 2000 }).then(() => (results.group = "opened tab joined the chat's group"), (e) => (results.group = e.message));
await sleep(6000);
await capture("m1-group-sidebar");

await ev(`ac.runCommand({ command: "newTab", arg: null, windowId: ${JSON.stringify(windowId)} }); return true`);
await sleep(2500);
await keys("\t");
await sleep(1500);
await capture("m1-newtab-ask");

results.tabs = await tabs();
writeFileSync(join(out, "m1.json"), JSON.stringify({ chat, answered: !!answered, results }, null, 2));
log("results", JSON.stringify(results, null, 1).slice(0, 2000));
if (!keep) await instance.quit();

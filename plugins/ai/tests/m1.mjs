#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { attach, launch } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.length < 3) {
  console.log("Usage: m1.mjs <Debug app> <plugin folder> <out dir> [--metro PORT] [--keep] [--attach]\n  Opens the AI chat in a hidden instance by its toolbar button, asks it something, and captures the real UI.");
  process.exit(args.includes("--help") ? 0 : 1);
}
const [app, plugin, out] = args.map((a) => resolve(a));
const metroPort = Number(args.includes("--metro") ? args[args.indexOf("--metro") + 1] : 8123);
const keep = args.includes("--keep");
const data = join(out, "data");
const stills = join(out, "stills");
mkdirSync(stills, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const notes = [];

async function until(what, test, { seconds = 60, every = 500 } = {}) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const value = await test().catch(() => null);
    if (value) return value;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let instance;
if (args.includes("--attach")) instance = attach(data);
else {
  rmSync(data, { recursive: true, force: true });
  mkdirSync(join(data, "config", "plugins"), { recursive: true });
  cpSync(plugin, join(data, "config", "plugins", "ai"), { recursive: true, verbatimSymlinks: true });
  instance = await launch(app, { data, js: "live", metroPort, onboarded: true });
}
log("instance", instance.pid, "port", instance.port);
const ev = (body, timeout = 30000) => instance.eval(body, { timeout });

function capture(name) {
  const windows = instance.windows().filter((w) => w.width >= 600 && w.height >= 400);
  const target = windows.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const file = join(stills, `${name}.png`);
  if (!target) {
    notes.push(`${name}: no on-screen window to capture`);
    return null;
  }
  try {
    execFileSync("timeout", ["20", "screencapture", "-x", "-o", "-l", String(target.id), file]);
    log("captured", name);
    return file;
  } catch (e) {
    notes.push(`${name}: screencapture failed (${String(e.message).slice(0, 80)})`);
    return null;
  }
}

const windowId = await ev(`return ac.store.getState().windowOrder[0]`);
const setAppearance = (mode) => ev(`ac.store.getState().updateSettings({ appearance: ${JSON.stringify(mode)} }); return true`);

await until("the plugin's listing", () => ev(`ac.plugins.rescanPlugins?.(); const l = ac.plugins.usePlugins.getState().listings.ai; return l && !l.problems.length ? true : (l ? { problems: l.problems } : null)`).then((r) => (r === true ? true : (r?.problems && log("problems", r.problems), null))));
await ev(`return ac.plugins.approve("ai")`);
await until("the helper to serve its page", () => ev(`return !!ac.plugins.usePlugins.getState().servedUrls.ai`), { seconds: 120 });
log("helper serving");

await ev(`return ac.actions.openUrls(["https://en.wikipedia.org/wiki/Browser_wars"], ${JSON.stringify(windowId)})`);
await until("the page to load", () => ev(`const s = ac.store.getState(); const t = Object.values(s.tabs).find((x) => (x.url || "").includes("Browser_wars")); return t ? t.id : null`), { seconds: 60 });
await sleep(1500);

await ev(`if (ac.plugins.pressPluginToolbarButton) { ac.plugins.pressPluginToolbarButton("ai", ${JSON.stringify(windowId)}); return "toolbar handler"; } ac.runCommand({ command: "runPluginCommand", arg: "ai/ask-beside", windowId: ${JSON.stringify(windowId)} }); return "menu command"`).then((how) => log("pressed", how));
const chatTab = await until("the chat in a split", () => ev(`const s = ac.store.getState(); const t = Object.values(s.tabs).find((x) => /^ardia:\\/\\/ai\\/[0-9a-f-]{36}/.test(x.url || "")); if (!t) return null; const split = Object.values(s.splits ?? {}).find((v) => JSON.stringify(v).includes(t.id)); return { id: t.id, url: t.url, split: split ? split.id ?? true : null }`), { seconds: 30 });
log("chat tab", chatTab);
await sleep(4000);

await setAppearance("dark");
await sleep(1500);
await ev(`return ac.shell.devTypeKeys(${JSON.stringify(windowId)}, "In two sentences, what is this page about? Cite it.", 15)`, 60000);
await sleep(500);
await ev(`return ac.shell.devTypeKeys(${JSON.stringify(windowId)}, "\\r", 15)`);
log("asked");

await until("a group headed by the chat", () => ev(`const s = ac.store.getState(); const g = Object.values(s.groups ?? {}).find((x) => (x.tabIds || []).includes(${JSON.stringify(chatTab.id)})); return g ? { id: g.id, tabs: g.tabIds.length } : null`), { seconds: 60 }).then(
  (g) => log("group", g),
  (e) => notes.push(`group: ${e.message}`),
);
await sleep(30000);
capture("m1-split-dark");
await setAppearance("light");
await sleep(2000);
capture("m1-split-light");
capture("m1-group-sidebar");
await setAppearance("dark");

await ev(`return ac.actions.openUrls ? (ac.store.getState().newTab(${JSON.stringify(windowId)}, {}), true) : false`);
await sleep(2500);
await ev(`return ac.shell.devTypeKeys(${JSON.stringify(windowId)}, "\\t", 15)`);
await sleep(1500);
capture("m1-newtab-ask");

writeFileSync(join(out, "notes.json"), JSON.stringify({ chatTab, notes }, null, 2));
log("notes", notes);
if (!keep) await instance.quit();

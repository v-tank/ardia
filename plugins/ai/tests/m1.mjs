#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { attach, launch } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.length < 3) {
  console.log("Usage: m1.mjs <Debug app> <plugin folder> <out dir> [--metro PORT] [--keep] [--attach]\n  Opens the AI chat in a hidden instance and captures the real UI.");
  process.exit(args.includes("--help") ? 0 : 1);
}
const [app, plugin, out] = args.map((a) => resolve(a));
const metroPort = Number(args[args.indexOf("--metro") + 1] || 8123);
const keep = args.includes("--keep");
const data = join(out, "data");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function until(what, test, { seconds = 60, every = 500 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < end) {
    last = await test();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function capture(instance, name) {
  const windows = instance.windows().filter((w) => w.width >= 600 && w.height >= 400);
  const target = windows.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const file = join(out, `${name}.png`);
  if (target) {
    try {
      execFileSync("timeout", ["20", "screencapture", "-x", "-o", "-l", String(target.id), file]);
      log("captured", name, "window", target.id);
      return { file, how: "screencapture" };
    } catch (e) {
      log("screencapture failed:", String(e.message).slice(0, 120));
    }
  }
  return { file: null, how: "failed" };
}

let instance;
if (args.includes("--attach")) instance = attach(data);
else {
  rmSync(data, { recursive: true, force: true });
  mkdirSync(join(data, "config", "plugins"), { recursive: true });
  cpSync(plugin, join(data, "config", "plugins", "ai"), { recursive: true, verbatimSymlinks: true });
  instance = await launch(app, { data, js: "live", metroPort, onboarded: true, test: ["contextMenu", "appMenu", "appDialog"] });
}
log("instance", instance.pid, "port", instance.port);

const ev = (body, timeout) => instance.eval(body, timeout ? { timeout } : undefined);
export { capture, ev, instance, log, until, out, keep, writeFileSync };

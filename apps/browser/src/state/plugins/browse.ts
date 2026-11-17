import type { PluginManifest } from "../../lib/pluginManifest";
import { errorText } from "../../lib/errors";
import { webUrl } from "../../lib/urlParts";
import { cliTabTargets } from "../../platform/cli";
import { runPluginBrowse, type PluginBrowseRun } from "../../platform/plugins";
import { useBrowser } from "../browser/store";
import { failure } from "../automation/automationMethods";
import { isEligibleTab, ownEntry } from "../automation/automationWindows";
import type { Body } from "../automation/controlSocket";
import { isInternalTab } from "../pages/urls";
import { notePlugin } from "../telemetry/pluginCounts";
import { holdBrowseServer, letGoOfBrowseServer } from "./browseServer";
import { pluginPageOf } from "./pageNames";

export const BROWSE_COMMANDS = ["snapshot", "get", "click", "fill", "type", "press", "scroll", "wait", "find", "is"] as const;
export const BROWSE_TIMEOUT_MS = 60_000;
export const BROWSE_MAX_ARGS = 64;
export const BROWSE_MAX_ARG = 8192;

const SESSION_FLAGS: ReadonlySet<string> = new Set([
  "--session", "--namespace", "--data-dir", "--port", "--ws", "--cdp", "--screenshot-dir", "--screenshot-format", "--screenshot-quality",
  "--idle-timeout", "--init-script", "--enable", "--headers", "--color-scheme", "--download-path", "--annotate", "--no-auto-dialog",
  "--pin-tab", "--no-pin-tab", "--debug", "--capture-console", "--show", "--content-boundaries", "--out", "--stdin",
]);

type Outcome = { ok: true; text: string } | { ok: false; error: string };

const chains = new Map<string, Promise<unknown>>();

export function browseTabProblem(tab: unknown): string | null {
  const s = useBrowser.getState();
  const t = ownEntry(s.tabs, tab);
  if (typeof tab !== "string" || !t) return "tab is the id of one of your tabs.";
  if (!isEligibleTab(s, tab)) return `Tab ${tab} is private, in Peek or in a window the ardia command can't use.`;
  if (pluginPageOf(t.url) || isInternalTab(t) || !webUrl(t.url)) return `Tab ${tab} isn't a web page (http or https).`;
  return null;
}

export function browseArgvProblem(argv: unknown): string | null {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > BROWSE_MAX_ARGS) return `argv is a list of 1 to ${BROWSE_MAX_ARGS} strings, the command first.`;
  if (!argv.every((a) => typeof a === "string" && a.length <= BROWSE_MAX_ARG && !a.includes("\0"))) return `Each argument is a string of at most ${BROWSE_MAX_ARG} characters.`;
  if (!(BROWSE_COMMANDS as readonly string[]).includes(argv[0] as string)) return `argv[0] is one of ${BROWSE_COMMANDS.join(", ")}.`;
  const flag = (argv as string[]).find((a) => SESSION_FLAGS.has(a.split("=", 1)[0]!));
  return flag ? `${flag.split("=", 1)[0]} changes the browse session, which Ardia picks for the plugin.` : null;
}

const firstLines = (text: string) => text.trim().split("\n").slice(0, 8).join("\n").slice(0, 2000);

function failed(run: PluginBrowseRun): string | null {
  if (!run.ok) return run.missing ? "The ardia command isn't installed; Settings › Advanced › The ardia command installs it." : `The ardia command couldn't run: ${run.reason ?? "unknown"}.`;
  if (run.timedOut) return `The command took longer than ${BROWSE_TIMEOUT_MS / 1000} s and was stopped.`;
  if (run.status !== 0) return firstLines(run.stderr || run.stdout) || `The ardia command exited with status ${run.status}.`;
  return null;
}

async function runBrowse(name: string, tab: string, argv: string[]): Promise<Outcome> {
  const deadline = Date.now() + BROWSE_TIMEOUT_MS;
  const left = () => Math.max(1000, deadline - Date.now());
  try {
    const held = await holdBrowseServer();
    if (held) return { ok: false, error: held };
    const targetId = (await cliTabTargets([tab]))[tab]?.targetId;
    if (!targetId) return { ok: false, error: `Tab ${tab}'s page isn't loaded (it's asleep); show it in Ardia first.` };
    const picked = await runPluginBrowse(name, ["tab", targetId], left());
    const pickProblem = failed(picked);
    if (pickProblem) return { ok: false, error: pickProblem };
    const ran = await runPluginBrowse(name, argv, left());
    const problem = failed(ran);
    if (problem || !ran.ok) return { ok: false, error: problem ?? "The ardia command failed." };
    return { ok: true, text: ran.truncated ? `${ran.stdout}\n…` : ran.stdout };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    letGoOfBrowseServer();
  }
}

export function pluginBrowse(name: string, m: PluginManifest, params: Record<string, unknown>): Body | Promise<Body> {
  if (!m.permissions.includes("pages")) return failure("refused", "browse needs the pages permission.");
  const tabProblem = browseTabProblem(params.tab);
  if (tabProblem) return failure(typeof params.tab === "string" && useBrowser.getState().tabs[params.tab] ? "refused" : "bad_request", tabProblem);
  const argvProblem = browseArgvProblem(params.argv);
  if (argvProblem) return failure("bad_request", argvProblem);
  notePlugin("plugin_browse_calls");
  const before = chains.get(name) ?? Promise.resolve();
  const next = before.then(() => runBrowse(name, params.tab as string, [...(params.argv as string[])]));
  chains.set(name, next.catch(() => {}));
  return next.then((outcome) => {
    if (!outcome.ok) notePlugin("plugin_browse_failures");
    return { result: outcome };
  });
}

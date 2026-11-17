import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { errorText } from "../../lib/errors";
import { cliControlStatus, setCliControl, type CliControlStatus } from "../../platform/cli";
import { onCliControlStopped, useCli } from "../app/cliControl";
import { useBrowser } from "../browser/store";
import { notePlugin } from "../telemetry/pluginCounts";

export const BROWSE_LINGER_MS = 60_000;
const START_WAIT_MS = 10_000;
const START_POLL_MS = 200;

let leased = false;
let busy = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

const controlSetting = () => useBrowser.getState().settings.cliControl;

const offStatus = (error: unknown): CliControlStatus => ({ state: "off", connections: 0, generation: 0, file: "", reason: errorText(error) });

function listen() {
  if (listening) return;
  listening = true;
  onCliControlStopped(() => {
    leased = false;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
  });
}

function release() {
  releaseTimer = null;
  if (!leased) return;
  if (busy > 0) return scheduleRelease();
  leased = false;
  if (!controlSetting()) void setCliControl(false).catch(() => {});
}

function scheduleRelease() {
  if (!leased) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(release, BROWSE_LINGER_MS);
}

export const browseLeased = () => leased;

async function started(first: CliControlStatus): Promise<CliControlStatus> {
  let status = first;
  const until = Date.now() + START_WAIT_MS;
  while (status.state === "starting" && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
    status = useCli.getState().server?.state === "on" ? useCli.getState().server! : await cliControlStatus().catch(offStatus);
  }
  return status;
}

export async function holdBrowseServer(): Promise<string | null> {
  listen();
  if (!PLATFORM_FEATURES.ardiaCommand) return "The ardia command isn't available on this platform.";
  busy++;
  const current = useCli.getState().server;
  if (current?.state === "on") return null;
  if (current?.state === "external") return "Another program holds this Ardia's DevTools connection, so the ardia command can't reach it.";
  if (!controlSetting() && !leased) {
    leased = true;
    notePlugin("plugin_browse_leases");
  }
  const status = await started(await setCliControl(true).catch(offStatus));
  if (status.state === "on") return null;
  return `The ardia command's connection to Ardia didn't start${"reason" in status && status.reason ? ` (${status.reason})` : ""}.`;
}

export function letGoOfBrowseServer() {
  busy = Math.max(0, busy - 1);
  scheduleRelease();
}

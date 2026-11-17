import { stageProfileSyncFolder } from "../../platform/launchConfig";
import { useBrowser } from "../browser/store";
import { historyOf, historyViewOf } from "../history/history";
import { syncNow, turnOnSync, useSync } from "../sync/engine";
import { defaultTarget } from "./apply";
import { importNow, startImport } from "./flow";
import { runImport } from "./runImport";

const STAGED_HISTORY_PAGES = 1_000;
const POLL_MS = 250;
const WAIT_MS = 180_000;

const say = (line: string) => console.info(`[ardia windows] test: staged profile: ${line}`);

async function until(ready: () => boolean): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (!ready()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return true;
}

async function stage(folder: string) {
  const profileId = defaultTarget();
  if (!(await until(() => !!historyViewOf(useBrowser.getState(), profileId)?.ready))) return say("history never loaded");
  if (historyOf(useBrowser.getState(), profileId).length < STAGED_HISTORY_PAGES) {
    const importing = Date.now();
    const stop = startImport(0);
    if (!(await until(() => !!importNow().source))) {
      stop();
      return say("no browser to import from");
    }
    say(`importing history from ${importNow().source!.name}`);
    await runImport(new Set(["history"]));
    stop();
    say(`imported history in ${Date.now() - importing} ms; ${historyOf(useBrowser.getState(), profileId).length} pages loaded`);
  }
  if (useSync.getState().status === "off") {
    const turned = await turnOnSync(folder);
    say("ok" in turned ? "sync turned on" : `sync couldn't be turned on: ${turned.error}`);
  }
  const syncing = Date.now();
  await syncNow();
  say(`synced in ${Date.now() - syncing} ms, sync status ${useSync.getState().status}`);
}

export function stageProfileForTest() {
  const folder = stageProfileSyncFolder();
  if (!folder) return;
  void stage(folder).catch((error: unknown) => say(`failed: ${String(error)}`));
}

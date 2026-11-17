import type { PluginManifest } from "../../lib/pluginManifest";
import { PLATFORM_TERMS } from "../../lib/platformTerms";
import { parseConfigShortcut } from "../config/configShortcuts";
import { formatShortcut } from "../commands/shortcuts";

export type ConsentLine = { icon: string; text: string };

function toolbarKey(shortcut: string | null): string {
  const parsed = shortcut ? parseConfigShortcut(shortcut) : null;
  return parsed ? ` (${formatShortcut(parsed)})` : "";
}

export function consentLines(m: PluginManifest): ConsentLine[] {
  const lines: ConsentLine[] = [];
  if (m.process) lines.push({ icon: "gearshape.2", text: `Runs a program in the background: ${m.process.run.join(" ")}` });
  for (const grant of m.process?.access ?? []) lines.push({ icon: grant.write ? "folder.badge.gearshape" : "folder", text: `${grant.write ? "Reads and writes" : "Reads"} ${grant.path}` });
  if (m.process?.userHome) lines.push({ icon: "house", text: "That program sees your home folder as its home (it still reads only what's listed here)" });
  if (m.permissions.includes("network")) lines.push({ icon: "network", text: "That program may connect to the internet" });
  else if (m.process) lines.push({ icon: "network.slash", text: `That program can't connect beyond this ${PLATFORM_TERMS.computer}` });
  if (m.permissions.includes("tabs")) lines.push({ icon: "square.on.square", text: m.permissions.includes("fullUrls") ? "Sees the full address and title of your tabs" : "Sees the address (without what follows ? or #) and title of your tabs" });
  if (m.hooks.length) lines.push({ icon: "bell", text: `Hears these events: ${m.hooks.join(", ")}` });
  if (m.permissions.includes("arrange")) lines.push({ icon: "rectangle.3.group", text: "Opens, moves, groups and closes your tabs" });
  if (m.permissions.includes("pages")) lines.push({ icon: "cursorarrow.click.2", text: "Reads and acts on the pages in your tabs" });
  if (m.permissions.includes("commands")) lines.push({ icon: "command", text: "Runs Ardia commands, like opening and closing tabs" });
  const defaults = Object.keys(m.settings.defaults);
  if (defaults.length) lines.push({ icon: "slider.horizontal.3", text: `Changes these settings while it's on: ${defaults.join(", ")}` });
  if (m.settings.rows.length) lines.push({ icon: "list.bullet", text: `Adds ${m.settings.rows.length === 1 ? "a setting" : `${m.settings.rows.length} settings`} to its page here` });
  if (m.page) lines.push({ icon: m.page.icon, text: `Adds a page you open as a tab: ${m.page.title} (ardia://${m.name})` });
  if (m.commands.some((c) => "open" in c.action && c.action.context)) lines.push({ icon: "rectangle.split.2x1", text: "Its page can be handed the tab you're on when you open it beside that tab" });
  if (m.commands.length) lines.push({ icon: "command.square", text: `Adds to the command bar: ${m.commands.map((c) => c.title).join(", ")}` });
  if (m.toolbar) lines.push({ icon: m.toolbar.icon, text: `Adds a toolbar button: ${m.toolbar.title}${toolbarKey(m.toolbar.shortcut)}` });
  if (m.newTab?.mode) lines.push({ icon: "character.cursor.ibeam", text: `Adds ${/^[aeiou]/i.test(m.newTab.mode.title) ? "an" : "a"} ${m.newTab.mode.title} mode to the New Tab box, which opens its page with what you type` });
  if (m.newTab?.button) lines.push({ icon: m.newTab.button.icon, text: `Adds a button to New Tab: ${m.newTab.button.title}` });
  if (m.telemetry.counters.length) lines.push({ icon: "chart.bar", text: "Counts how often you use its features (no content)" });
  if (m.tools.length) lines.push({ icon: "wrench.and.screwdriver", text: `Offers tools to the ardia command and other plugins: ${m.tools.map((t) => t.title).join(", ")}` });
  return lines;
}

import { isFields, type Fields } from "./decode";
import type { JsonSchema } from "./jsonSchema";
import { isPagePath, MAX_PAGE_PATH } from "./pluginNames";

export const SURFACE_LIMITS = { toolbarTitle: 40, modeTitle: 16, placeholder: 80, buttonTitle: 40, shortcut: 40 } as const;
export const PAGE_ID_TOKEN = "{id}";
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";
const SYMBOL = /^[a-z0-9.]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export type ToolbarSpec = { title: string; icon: string; command: string; shortcut: string | null };
export type NewTabMode = { title: string; placeholder: string; defaultRow: string | null; defaultValue: string | null; path: string };
export type NewTabButton = { title: string; icon: string; path: string };
export type NewTabSpec = { mode: NewTabMode | null; button: NewTabButton | null };

type Row = { key: string; type: string; choices?: { value: string }[] };
type Surfaces = { toolbar: ToolbarSpec | null; newTab: NewTabSpec | null };
type Owner = { commands: { name: string }[]; page: unknown; rows: Row[] };

function keys(problems: string[], path: string, doc: Fields, allowed: readonly string[]) {
  for (const key of Object.keys(doc)) if (!allowed.includes(key)) problems.push(`${path}.${key} isn't a key of ${path}`);
}

function text(problems: string[], path: string, value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > max) return problems.push(`${path} must be text of 1 to ${max} characters`), null;
  if (UNSAFE_TEXT.test(value)) return problems.push(`${path} has control or direction characters`), null;
  return value;
}

function symbol(problems: string[], path: string, value: unknown): string | null {
  if (typeof value === "string" && SYMBOL.test(value)) return value;
  return problems.push(`${path} must be an SF Symbol name`), null;
}

const withSlash = (path: string) => (path === "" || path.startsWith("/") ? path : `/${path}`);

export function pagePathOf(template: string, id: string): string {
  return withSlash(template).split(PAGE_ID_TOKEN).join(id);
}

function pathTemplate(problems: string[], path: string, value: unknown, query: boolean): string | null {
  const rule = `${path} must be a path in the plugin's page, like history or chats/{id}${query ? "?tab=recent" : " (no query: the text you type is added as ?q=)"}`;
  if (typeof value !== "string" || value.length > MAX_PAGE_PATH) return problems.push(rule), null;
  const sample = pagePathOf(value, SAMPLE_ID);
  if (!isPagePath(sample) || (!query && sample.includes("?"))) return problems.push(rule), null;
  return value;
}

export function toolbarOf(problems: string[], value: unknown): ToolbarSpec | null {
  if (value === undefined) return null;
  if (!isFields(value)) return problems.push('toolbar must be an object like {"title", "icon", "command"}'), null;
  keys(problems, "toolbar", value, ["title", "icon", "command", "shortcut"]);
  const title = text(problems, "toolbar.title", value.title, SURFACE_LIMITS.toolbarTitle);
  const icon = symbol(problems, "toolbar.icon", value.icon);
  const command = typeof value.command === "string" && NAME.test(value.command) ? value.command : (problems.push("toolbar.command must name one of the plugin's commands"), null);
  const shortcut = value.shortcut === undefined ? null : text(problems, "toolbar.shortcut", value.shortcut, SURFACE_LIMITS.shortcut);
  if (value.shortcut !== undefined && shortcut === null) return null;
  return title && icon && command ? { title, icon, command, shortcut } : null;
}

function modeOf(problems: string[], value: unknown): NewTabMode | null {
  if (!isFields(value)) return problems.push('newTab.mode must be an object like {"title", "placeholder", "path"}'), null;
  keys(problems, "newTab.mode", value, ["title", "placeholder", "defaultRow", "defaultValue", "path"]);
  const title = text(problems, "newTab.mode.title", value.title, SURFACE_LIMITS.modeTitle);
  const placeholder = text(problems, "newTab.mode.placeholder", value.placeholder, SURFACE_LIMITS.placeholder);
  const path = pathTemplate(problems, "newTab.mode.path", value.path, false);
  if ((value.defaultRow === undefined) !== (value.defaultValue === undefined)) problems.push("newTab.mode: defaultRow and defaultValue go together");
  const defaultRow = value.defaultRow === undefined ? null : typeof value.defaultRow === "string" && KEY.test(value.defaultRow) ? value.defaultRow : (problems.push("newTab.mode.defaultRow must be a row's key"), null);
  const defaultValue = value.defaultValue === undefined ? null : typeof value.defaultValue === "string" && KEY.test(value.defaultValue) ? value.defaultValue : (problems.push("newTab.mode.defaultValue must be one of that row's values"), null);
  return title && placeholder && path !== null ? { title, placeholder, defaultRow, defaultValue, path } : null;
}

function buttonOf(problems: string[], value: unknown): NewTabButton | null {
  if (!isFields(value)) return problems.push('newTab.button must be an object like {"title", "icon", "path"}'), null;
  keys(problems, "newTab.button", value, ["title", "icon", "path"]);
  const title = text(problems, "newTab.button.title", value.title, SURFACE_LIMITS.buttonTitle);
  const icon = symbol(problems, "newTab.button.icon", value.icon);
  const path = pathTemplate(problems, "newTab.button.path", value.path, true);
  return title && icon && path !== null ? { title, icon, path } : null;
}

export function newTabOf(problems: string[], value: unknown): NewTabSpec | null {
  if (value === undefined) return null;
  if (!isFields(value)) return problems.push('newTab must be an object like {"mode", "button"}'), null;
  keys(problems, "newTab", value, ["mode", "button"]);
  if (value.mode === undefined && value.button === undefined) return problems.push("newTab needs a mode, a button or both"), null;
  const mode = value.mode === undefined ? null : modeOf(problems, value.mode);
  const button = value.button === undefined ? null : buttonOf(problems, value.button);
  return mode || button ? { mode, button } : null;
}

export function surfaceProblems(problems: string[], { toolbar, newTab }: Surfaces, owner: Owner) {
  if (toolbar && !owner.commands.some((c) => c.name === toolbar.command)) problems.push(`toolbar.command: ${toolbar.command} isn't one of this plugin's commands`);
  if (newTab && !owner.page) problems.push("newTab needs a page");
  const mode = newTab?.mode;
  if (mode?.defaultRow) {
    const row = owner.rows.find((r) => r.key === mode.defaultRow);
    if (!row || row.type !== "choice") problems.push(`newTab.mode.defaultRow: ${mode.defaultRow} isn't one of this plugin's choice rows`);
    else if (!row.choices?.some((c) => c.value === mode.defaultValue)) problems.push(`newTab.mode.defaultValue: ${mode.defaultValue} isn't one of ${mode.defaultRow}'s values`);
  }
}

export function modeStartsOn(mode: NewTabMode, values: Readonly<Record<string, string | boolean>>): boolean {
  return !!mode.defaultRow && values[mode.defaultRow] === mode.defaultValue;
}

export function modePagePath(mode: NewTabMode, id: string, text: string): string {
  const path = pagePathOf(mode.path, id);
  let query = text.trim();
  while (query && `${path}?q=${encodeURIComponent(query)}`.length > MAX_PAGE_PATH) query = Array.from(query).slice(0, -1).join("");
  return query ? `${path}?q=${encodeURIComponent(query)}` : path;
}

const textSchema = (max: number): JsonSchema => ({ type: "string", pattern: `^[\\s\\S]{1,${max}}$` });
const symbolSchema: JsonSchema = { type: "string", pattern: SYMBOL.source, description: "An SF Symbol name" };
const pathSchema = (description: string): JsonSchema => ({ type: "string", pattern: `^[^#\\s]{0,${MAX_PAGE_PATH}}$`, description });
const closed = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: "object", properties, additionalProperties: false, required });

export const SURFACE_SCHEMAS: Record<"toolbar" | "newTab", JsonSchema> = {
  toolbar: closed(
    {
      title: textSchema(SURFACE_LIMITS.toolbarTitle),
      icon: symbolSchema,
      command: { type: "string", pattern: NAME.source, description: "One of the plugin's commands, run when the button is pressed" },
      shortcut: { ...textSchema(SURFACE_LIMITS.shortcut), description: 'A shortcut like "cmd+shift+e", written as in config.json; one Ardia already uses is refused' },
    },
    ["title", "icon", "command"],
  ),
  newTab: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: closed(
        {
          title: textSchema(SURFACE_LIMITS.modeTitle),
          placeholder: textSchema(SURFACE_LIMITS.placeholder),
          defaultRow: { type: "string", pattern: KEY.source, description: "A choice row whose value picks the mode New Tab starts in" },
          defaultValue: { type: "string", pattern: KEY.source, description: "The row's value that starts New Tab in this mode" },
          path: pathSchema("The page path Enter opens, with ?q=<text> added; {id} becomes a new UUID each time"),
        },
        ["title", "placeholder", "path"],
      ),
      button: closed({ title: textSchema(SURFACE_LIMITS.buttonTitle), icon: symbolSchema, path: pathSchema("The page path the button opens; {id} becomes a new UUID each time") }, ["title", "icon", "path"]),
    },
  },
};

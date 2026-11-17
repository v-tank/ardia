import { isFields, type Fields } from "./decode";
import type { JsonSchema } from "./jsonSchema";

export const SURFACE_LIMITS = { toolbarTitle: 40, shortcut: 40 } as const;
const SYMBOL = /^[a-z0-9.]{1,64}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

export type ToolbarSpec = { title: string; icon: string; command: string; shortcut: string | null };

type Surfaces = { toolbar: ToolbarSpec | null };
type Owner = { commands: { name: string }[] };

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

export function surfaceProblems(problems: string[], { toolbar }: Surfaces, owner: Owner) {
  if (toolbar && !owner.commands.some((c) => c.name === toolbar.command)) problems.push(`toolbar.command: ${toolbar.command} isn't one of this plugin's commands`);
}

const textSchema = (max: number): JsonSchema => ({ type: "string", pattern: `^[\\s\\S]{1,${max}}$` });
const symbolSchema: JsonSchema = { type: "string", pattern: SYMBOL.source, description: "An SF Symbol name" };
const closed = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: "object", properties, additionalProperties: false, required });

export const SURFACE_SCHEMAS: Record<string, JsonSchema> = {
  toolbar: closed(
    {
      title: textSchema(SURFACE_LIMITS.toolbarTitle),
      icon: symbolSchema,
      command: { type: "string", pattern: NAME.source, description: "One of the plugin's commands, run when the button is pressed" },
      shortcut: { ...textSchema(SURFACE_LIMITS.shortcut), description: 'A shortcut like "cmd+shift+e", written as in config.json; one Ardia already uses is refused' },
    },
    ["title", "icon", "command"],
  ),
};

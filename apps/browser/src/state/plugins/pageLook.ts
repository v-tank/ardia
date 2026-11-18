import type { ThemeLook } from "../../lib/themeLook";

export type PageLook = { appearance: "dark" | "light"; vars: Record<string, string> };

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const SYSTEM_FACE = `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
const quoted = (family: string) => `"${family.replace(/["\\]/g, "")}"`;

export function pageLook(theme: { readonly dark: boolean; readonly windowTint: readonly string[] }, look: ThemeLook, glass = false): PageLook {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(theme as object)) if (typeof value === "string" && name !== "profileColor") vars[`--ardia-${kebab(name)}`] = value;
  vars["--ardia-window-tint-top"] = theme.windowTint[0] ?? "";
  vars["--ardia-window-tint-bottom"] = theme.windowTint[1] ?? "";
  vars["--ardia-glass"] = glass ? "1" : "0";
  vars["--ardia-font-family"] = look.family ? `${quoted(look.family)}, ${SYSTEM_FACE}` : SYSTEM_FACE;
  vars["--ardia-font-mono"] = `${quoted(look.mono)}, ui-monospace, Menlo, monospace`;
  for (const [size, px] of Object.entries(look.sizes)) vars[`--ardia-font-${kebab(size)}`] = `${px}px`;
  for (const [weight, value] of Object.entries(look.weights)) vars[`--ardia-weight-${kebab(weight)}`] = String(value);
  for (const [radius, px] of Object.entries(look.radii)) vars[`--ardia-radius-${kebab(radius)}`] = `${px}px`;
  return { appearance: theme.dark ? "dark" : "light", vars };
}

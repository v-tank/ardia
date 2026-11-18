import { writeFileSync } from "node:fs";
import { colorRoles, font, lineHeight, proseLineHeight, radius, shadow, space, tracking, weight } from "../../../../apps/browser/src/components/ui/tokens";
import { GO_BUTTON, SCOPE_CHIP } from "../../../../apps/browser/src/components/omnibox/tokens";
import { NTP_BAR } from "../../../../apps/browser/src/components/ntp/tokens";

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function roleVars(roles: Record<string, unknown>): string {
  return Object.entries(roles)
    .filter(([, value]) => typeof value === "string")
    .map(([name, value]) => `  --${kebab(name)}: var(--ardia-${kebab(name)}, ${value as string});`)
    .join("\n");
}

function scaleVars(prefix: string, scale: Record<string, number | string | { fontSize: number }>, live = false): string {
  return Object.entries(scale)
    .map(([name, value]) => {
      const v = typeof value === "object" ? `${value.fontSize}px` : typeof value === "number" ? `${value}px` : value;
      return `  --${prefix}-${kebab(name)}: ${live ? `var(--ardia-${prefix}-${kebab(name)}, ${v})` : v};`;
    })
    .join("\n");
}

const sizes = Object.fromEntries(Object.keys(font).map((k) => [k, font[k as keyof typeof font]]));
const lines = Object.fromEntries(Object.keys(lineHeight).map((k) => [k, lineHeight[k as keyof typeof lineHeight]]));
const shadowOf = (level: keyof typeof shadow, mode: "dark" | "light") => {
  const s = shadow[level];
  return `0 ${s.offset[1]}px ${s.radius}px rgba(0,0,0,${s.opacity[mode]})`;
};

const ntpShadow = NTP_BAR.shadows.map((l) => `0 ${l.offset[1]}px ${l.radius}px rgba(0,0,0,${l.opacity})`).join(", ");
const parts = {
  "go-height": GO_BUTTON.height,
  "go-pad-x": GO_BUTTON.padX,
  "go-gap": GO_BUTTON.gap,
  "chip-height": SCOPE_CHIP.height,
  "chip-radius": SCOPE_CHIP.radius,
  "chip-favicon": SCOPE_CHIP.favicon,
  "chip-left": SCOPE_CHIP.left,
  "chip-right": SCOPE_CHIP.right,
  "bar-radius": NTP_BAR.radius,
  "bar-border": NTP_BAR.border,
  "prose-body": proseLineHeight.body,
  "prose-small": proseLineHeight.small,
  "tracking-tight": tracking.tight,
};

const css = `:root {
${scaleVars("part", parts)}
  --shadow-bar: ${ntpShadow};
${scaleVars("space", space)}
${scaleVars("radius", radius, true)}
${scaleVars("font", sizes, true)}
${scaleVars("line", lines)}
${scaleVars("weight", weight, true)}
  --font-face: var(--ardia-font-family, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif);
  --font-mono: var(--ardia-font-mono, ui-monospace, "SF Mono", Menlo, monospace);
}
:root, :root[data-theme="light"] {
${roleVars(colorRoles.light)}
  --shadow-popover: ${shadowOf("popover", "light")};
  --shadow-card: ${shadowOf("card", "light")};
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${roleVars(colorRoles.dark)}
  --shadow-popover: ${shadowOf("popover", "dark")};
  --shadow-card: ${shadowOf("card", "dark")};
  }
}
`;

writeFileSync(process.argv[2] ?? "tokens.css", css);

import type { BrowserState } from "../../state/browser/store";
import { layout } from "../ui/theme";

export type Offsets = { at: Map<string, number>; end: number };
export type Height = (s: BrowserState, entry: string) => number;
export type InView = (key: string, from: number) => boolean;
type Planned = { moves: { key: string; from: number }[]; ghosts: unknown[]; clipped: string[]; below: number };

export function onlySeen<P extends Planned>(plan: P, seen: InView | null): P | null {
  const moves = seen ? plan.moves.filter((m) => seen(m.key, m.from)) : plan.moves;
  if (moves.length === plan.moves.length) return plan;
  if (!moves.length && !plan.ghosts.length && !plan.below) return null;
  return { ...plan, moves, clipped: moves.length ? plan.clipped : [] };
}

export function offsets(s: BrowserState, entries: string[], height: Height, start = 0, base = 0): Offsets {
  const at = new Map<string, number>();
  let y = base;
  for (let i = start; i < entries.length; i++) {
    at.set(entries[i]!, y);
    y += height(s, entries[i]!) + layout.rowGap;
  }
  return { at, end: y };
}

export function sharedPrefix(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function prefixHeight(s: BrowserState, entries: string[], count: number, height: Height): number {
  let y = 0;
  for (let i = 0; i < count; i++) y += height(s, entries[i]!) + layout.rowGap;
  return y;
}

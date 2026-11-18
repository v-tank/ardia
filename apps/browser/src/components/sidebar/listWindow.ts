import type { ListBand } from "./listViewport";

export type ListGeometry = { tops: number[]; heights: number[]; end: number };
export type WindowPiece = { index: number; before: number };

export const WINDOW_AHEAD = { above: 1, below: 2 } as const;
export const WINDOW_NEED = { above: 0.5, below: 1 } as const;
export const DRAG_AHEAD = { above: 3, below: 3 } as const;
export const DRAG_NEED = { above: 2, below: 2 } as const;

export function listGeometry(heights: number[], gap: number): ListGeometry {
  const tops = new Array<number>(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    tops[i] = y;
    y += heights[i]! + gap;
  }
  return { tops, heights, end: heights.length ? y - gap : 0 };
}

export function bandAround(view: ListBand, ahead: { above: number; below: number }): ListBand {
  const screen = Math.max(0, view.bottom - view.top);
  return { top: view.top - screen * ahead.above, bottom: view.bottom + screen * ahead.below };
}

export const covers = (outer: ListBand, inner: ListBand) => outer.top <= inner.top && outer.bottom >= inner.bottom;

export function nextWindow(current: ListBand | null, view: ListBand | null, firstPaint: number, dragging = false): ListBand {
  if (!view || view.bottom <= view.top) return current ?? { top: 0, bottom: firstPaint };
  if (current && covers(current, bandAround(view, dragging ? DRAG_NEED : WINDOW_NEED))) return current;
  return bandAround(view, dragging ? DRAG_AHEAD : WINDOW_AHEAD);
}

function firstEndingBelow(g: ListGeometry, y: number): number {
  let lo = 0;
  let hi = g.tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.tops[mid]! + g.heights[mid]! > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function firstStartingAt(g: ListGeometry, y: number): number {
  let lo = 0;
  let hi = g.tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.tops[mid]! >= y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function entriesIn(g: ListGeometry, band: ListBand): [number, number] {
  const first = firstEndingBelow(g, band.top);
  return [first, Math.max(first, firstStartingAt(g, band.bottom))];
}

export function mountedIndices(g: ListGeometry, band: ListBand, kept: Iterable<number>): number[] {
  const [first, last] = entriesIn(g, band);
  const out = new Set<number>();
  for (let i = first; i < last; i++) out.add(i);
  for (const i of kept) if (i >= 0 && i < g.tops.length) out.add(i);
  return [...out].sort((a, b) => a - b);
}

export function windowPieces(g: ListGeometry, gap: number, mounted: number[]): { pieces: WindowPiece[]; after: number } {
  const pieces: WindowPiece[] = [];
  let prev = -1;
  for (const index of mounted) {
    const before = prev < 0 ? (index > 0 ? g.tops[index]! - gap : 0) : index > prev + 1 ? g.tops[index]! - (g.tops[prev]! + g.heights[prev]!) - 2 * gap : 0;
    pieces.push({ index, before });
    prev = index;
  }
  const n = g.tops.length;
  if (!n) return { pieces, after: 0 };
  if (prev < 0) return { pieces, after: g.end };
  return { pieces, after: prev < n - 1 ? g.end - (g.tops[prev]! + g.heights[prev]!) - gap : 0 };
}

export function keepSlots(keys: string[], previous: Map<string, number>): Map<string, number> {
  const next = new Map<string, number>();
  const taken = new Set<number>();
  for (const key of keys) {
    const slot = previous.get(key);
    if (slot === undefined || taken.has(slot)) continue;
    next.set(key, slot);
    taken.add(slot);
  }
  let free = 0;
  for (const key of keys) {
    if (next.has(key)) continue;
    while (taken.has(free)) free++;
    next.set(key, free);
    taken.add(free);
  }
  return next;
}

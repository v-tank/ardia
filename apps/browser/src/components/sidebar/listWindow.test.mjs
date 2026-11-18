import assert from "node:assert/strict";
import { test } from "node:test";
const w = await import("./listWindow.ts");

const ROW = 34;
const GAP = 3;
const rows = (n) => w.listGeometry(new Array(n).fill(ROW), GAP);

function drawnTops(g, gap, mounted) {
  const { pieces, after } = w.windowPieces(g, gap, mounted);
  const children = [];
  for (const p of pieces) {
    if (p.before > 0) children.push({ spacer: p.before });
    children.push({ index: p.index, height: g.heights[p.index] });
  }
  if (after > 0) children.push({ spacer: after });
  let y = 0;
  const tops = new Map();
  children.forEach((c, k) => {
    if (k) y += gap;
    if (c.index !== undefined) tops.set(c.index, y);
    y += c.index !== undefined ? c.height : c.spacer;
  });
  return { tops, end: y };
}

test("offsets add each entry's height and the gap between them", () => {
  const g = w.listGeometry([34, 120, 34], GAP);
  assert.deepEqual(g.tops, [0, 37, 160]);
  assert.equal(g.end, 194);
  assert.equal(w.listGeometry([], GAP).end, 0);
});

test("the entries in a band are the ones it overlaps, found by binary search", () => {
  const g = rows(300);
  assert.deepEqual(w.entriesIn(g, { top: 0, bottom: 800 }), [0, 22]);
  assert.deepEqual(w.entriesIn(g, { top: 37 * 100 + 10, bottom: 37 * 100 + 20 }), [100, 101]);
  assert.deepEqual(w.entriesIn(g, { top: 35, bottom: 37 }), [1, 1], "the gap belongs to no row");
  assert.deepEqual(w.entriesIn(g, { top: -800, bottom: -10 }), [0, 0]);
  assert.deepEqual(w.entriesIn(g, { top: 1e6, bottom: 1e6 + 800 }), [300, 300]);
});

test("the window keeps one screen above and two below, and moves only when the view nears its edge", () => {
  const view = { top: 1000, bottom: 1800 };
  const first = w.nextWindow(null, view, 2400);
  assert.deepEqual(first, { top: 200, bottom: 3400 });
  assert.equal(w.nextWindow(first, { top: 1300, bottom: 2100 }, 2400), first, "a short scroll keeps it");
  assert.equal(w.nextWindow(first, { top: 600, bottom: 1400 }, 2400), first, "half a screen up keeps it");
  assert.deepEqual(w.nextWindow(first, { top: 1900, bottom: 2700 }, 2400), { top: 1100, bottom: 4300 }, "past the slack it re-centres");
  assert.deepEqual(w.nextWindow(first, { top: 500, bottom: 1300 }, 2400), { top: -300, bottom: 2900 });
  assert.deepEqual(w.nextWindow(null, null, 2400), { top: 0, bottom: 2400 }, "before the scroll view is laid out, the first paint's height");
  assert.equal(w.nextWindow(first, null, 2400), first);
});

test("kept entries mount wherever they are, and spacers keep every mounted entry at its true offset", () => {
  const g = w.listGeometry([34, 34, 200, 34, 34, 34, 34, 34, 34, 34], GAP);
  const mounted = w.mountedIndices(g, { top: g.tops[3], bottom: g.tops[5] + 1 }, [0, 8, 42]);
  assert.deepEqual(mounted, [0, 3, 4, 5, 8]);
  const drawn = drawnTops(g, GAP, mounted);
  for (const i of mounted) assert.equal(drawn.tops.get(i), g.tops[i], `entry ${i}`);
  assert.equal(drawn.end, g.end, "the list keeps its full height");
});

test("with nothing mounted one spacer holds the list's height, and an empty list draws nothing", () => {
  const g = rows(50);
  assert.deepEqual(w.windowPieces(g, GAP, []), { pieces: [], after: g.end });
  assert.equal(drawnTops(g, GAP, []).end, g.end);
  assert.deepEqual(w.windowPieces(rows(0), GAP, []), { pieces: [], after: 0 });
});

test("a window at the end or the start of the list needs no spacer on that side", () => {
  const g = rows(40);
  const end = w.mountedIndices(g, { top: g.tops[35], bottom: g.end + 500 }, []);
  assert.equal(end.at(-1), 39);
  assert.equal(w.windowPieces(g, GAP, end).after, 0);
  const start = w.mountedIndices(g, { top: -400, bottom: 100 }, []);
  assert.equal(w.windowPieces(g, GAP, start).pieces[0].before, 0);
  for (const mounted of [end, start]) {
    const drawn = drawnTops(g, GAP, mounted);
    for (const i of mounted) assert.equal(drawn.tops.get(i), g.tops[i]);
    assert.equal(drawn.end, g.end);
  }
});

test("a row slot stays with its entry while it stays mounted, whatever the count, and freed slots go to new entries", () => {
  let slots = w.keepSlots(["a", "b", "c", "d"], new Map());
  assert.deepEqual([...slots], [["a", 0], ["b", 1], ["c", 2], ["d", 3]]);
  slots = w.keepSlots(["d", "e"], slots);
  assert.equal(slots.get("d"), 3, "a kept entry keeps a slot above the new count");
  assert.equal(slots.get("e"), 0);
  slots = w.keepSlots(["e", "f", "g", "d"], slots);
  assert.deepEqual([...slots].sort((x, y) => x[1] - y[1]), [["e", 0], ["f", 1], ["g", 2], ["d", 3]]);
});

test("while a drag runs the window holds three screens each way, so an edge auto-scroll finds rows already drawn", () => {
  const view = { top: 1000, bottom: 1800 };
  assert.deepEqual(w.nextWindow(null, view, 2400, true), { top: -1400, bottom: 4200 });
  const plain = w.nextWindow(null, view, 2400);
  assert.notEqual(w.nextWindow(plain, view, 2400, true), plain, "a drag starting widens the window at once");
});

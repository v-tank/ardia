import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const D = await import("./fixtures/dragScene.mjs");
const { world, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { entryKey, sceneLayout, mount, readDrag, centre, fakeView, settle } = D;

const HOSTS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

function longList() {
  const W = world(...HOSTS);
  const L = sceneLayout({ top: 120 });
  const listTop = L.y;
  for (const h of HOSTS) L.row(W.id[h]);
  L.tail("list");
  return { ...W, L, regions: regionsOf(L, { list: [listTop, L.y] }) };
}

function unmount(c, regions, keys) {
  for (const key of keys) {
    const item = c.items.get(key);
    item.place = { top: item.view.frame.y - regions.list.y, height: item.view.frame.h, header: 0 };
    item.view = null;
  }
}

const byHost = (m, value) => {
  let text = JSON.stringify(value);
  for (const [host, id] of Object.entries(m.id)) text = text.split(id).join(host);
  return JSON.parse(text);
};
const frameOf = (m, key) => m.L.entries.find((e) => e.key === key).frame;
const keysOf = (m, hosts) => hosts.map((h) => entryKey("tab", m.id[h]));

async function dropsAlong(c, m) {
  const from = frameOf(m, entryKey("tab", m.id.a));
  await c.begin(entryKey("tab", m.id.a), from.x + 20, from.y + 10);
  const out = [];
  for (const h of HOSTS.slice(1)) {
    const f = frameOf(m, entryKey("tab", m.id[h]));
    for (const dy of [-f.h / 2 + 2, 0, f.h / 2 - 2]) {
      c.move(f.x + 20, centre(f, dy).y);
      out.push(byHost(m, readDrag(c)));
    }
  }
  c.end(false);
  return out;
}

test("rows the window left unmounted are drop targets from the model, exactly where measured rows would be", async () => {
  const measured = longList();
  const all = mount({ entries: measured.L.entries, regions: measured.regions });
  const expected = await dropsAlong(all.c, measured);

  const windowed = longList();
  const some = mount({ entries: windowed.L.entries, regions: windowed.regions });
  unmount(some.c, windowed.regions, keysOf(windowed, ["e", "f", "g", "h", "i", "j", "k", "l"]));
  assert.deepEqual(await dropsAlong(some.c, windowed), expected);
});

test("a row that mounts mid-drag takes its model frame, and one with no model is measured into the drag's coordinates", async () => {
  const m = longList();
  const { c } = mount({ entries: m.L.entries, regions: m.regions });
  const [h, k] = keysOf(m, ["h", "k"]);
  unmount(c, m.regions, [h]);
  const from = frameOf(m, entryKey("tab", m.id.a));
  await c.begin(entryKey("tab", m.id.a), from.x + 20, from.y + 10);
  const model = c.items.get(h).frame;
  assert.deepEqual(model, frameOf(m, h), "the model frame matches where the row would be measured");

  c.items.delete(h);
  const real = c.create(h);
  Object.assign(real, { kind: "row", tabIds: [m.id.h], section: "list", view: fakeView({ ...frameOf(m, h), y: -999 }), frame: { x: 0, y: 0, w: 0, h: 0 } });
  c.adopt(h, real);
  assert.deepEqual(real.frame, model, "even after the model item was withdrawn first, as React's cleanups run before the new row registers, it keeps the drag's frame");

  c.scrollY = 50;
  c.items.delete(k);
  c.session.baseline.delete(k);
  const late = c.create(k);
  Object.assign(late, { kind: "row", tabIds: [m.id.k], section: "list", view: fakeView({ ...frameOf(m, k), y: frameOf(m, k).y - 50 }) });
  c.adopt(k, late);
  assert.equal(late.frame, null, "until it is measured it is no target");
  await settle();
  assert.deepEqual(late.frame, frameOf(m, k), "measured after a 50 pt scroll, it lands at its place in the drag's start coordinates");
  c.end(false);
});

test("outside a drag, adopting an item only registers it", () => {
  const m = longList();
  const { c } = mount({ entries: m.L.entries, regions: m.regions });
  const [b] = keysOf(m, ["b"]);
  const item = c.create(b);
  c.adopt(b, item);
  assert.equal(c.items.get(b), item);
  assert.equal(item.frame, null);
});

test("a row measured mid-drag has the drag's own displacement taken out: the closed source above it and an open gap above it", async () => {
  const m = longList();
  const { c } = mount({ entries: m.L.entries, regions: m.regions });
  const [b, d, j] = keysOf(m, ["b", "d", "j"]);
  const from = frameOf(m, b);
  await c.begin(b, from.x + 20, from.y + 10);
  c.move(from.x + 20, frameOf(m, d).y + 2);
  const { gapKey, pitch } = c.session;
  assert.ok(gapKey && pitch > 0, "a gap is open above d");
  const source = c.session.sources[0].frame.h + D.GAP;
  c.items.delete(j);
  c.session.baseline.delete(j);
  const shown = { ...frameOf(m, j), y: frameOf(m, j).y - source + pitch };
  const row = c.create(j);
  Object.assign(row, { kind: "row", tabIds: [m.id.j], section: "list", view: fakeView(shown) });
  c.adopt(j, row);
  await settle();
  assert.deepEqual(row.frame, frameOf(m, j));
  c.end(false);
});

test("a row with no baseline that mounts right below the dragged row is placed below it, not at the closed row's old place", async () => {
  const m = longList();
  const { c } = mount({ entries: m.L.entries, regions: m.regions });
  const [b, cKey] = keysOf(m, ["b", "c"]);
  const from = frameOf(m, b);
  await c.begin(b, from.x + 20, from.y + 10);
  c.move(from.x + 300, from.y + 10);
  assert.equal(c.session.gapKey, null, "no gap open, only the source closed");
  c.items.delete(cKey);
  c.session.baseline.delete(cKey);
  const row = c.create(cKey);
  Object.assign(row, { kind: "row", tabIds: [m.id.c], section: "list", view: fakeView({ ...frameOf(m, cKey), y: from.y }) });
  c.adopt(cKey, row);
  await settle();
  assert.deepEqual(row.frame, frameOf(m, cKey));
  c.end(false);
});

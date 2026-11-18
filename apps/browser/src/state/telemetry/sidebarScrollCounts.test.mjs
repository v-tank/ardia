import assert from "node:assert/strict";
import { test } from "node:test";

const { noteSidebarHoverHeld, noteSidebarScrolled } = await import("./sidebarScrollCounts.ts");
const { takeSidebarResizeCounts } = await import("./sidebarResizeCounts.ts");

test("a scroll counts once, its updates more than 34 ms apart count as stutters, and the counts start again from zero", () => {
  takeSidebarResizeCounts();
  for (const at of [1000, 1016, 1032, 1080, 1096]) noteSidebarScrolled(at);
  for (const at of [2000, 2016]) noteSidebarScrolled(at);
  noteSidebarHoverHeld();
  assert.deepEqual(takeSidebarResizeCounts(), { sidebar_resizes: 0, sidebar_scrolls: 2, sidebar_scroll_stalls: 1, sidebar_scroll_held_hovers: 1, sidebar_rows_mounted_max: 0, pinned_section_collapses: 0, pinned_section_expands: 0 });
  assert.deepEqual(takeSidebarResizeCounts(), { sidebar_resizes: 0, sidebar_scrolls: 0, sidebar_scroll_stalls: 0, sidebar_scroll_held_hovers: 0, sidebar_rows_mounted_max: 0, pinned_section_collapses: 0, pinned_section_expands: 0 });
});

test("the most sidebar entries drawn at once is a maximum for the hour, then starts again", async () => {
  const { noteSidebarRowsMounted } = await import("./sidebarScrollCounts.ts");
  takeSidebarResizeCounts();
  for (const n of [40, 72, 55]) noteSidebarRowsMounted(n);
  assert.equal(takeSidebarResizeCounts().sidebar_rows_mounted_max, 72);
  assert.equal(takeSidebarResizeCounts().sidebar_rows_mounted_max, 0);
});

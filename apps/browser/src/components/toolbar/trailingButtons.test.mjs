import assert from "node:assert/strict";
import { test } from "node:test";
const { pluginButtonsRight, toolbarTrailingWidth } = await import("./trailingButtons.ts");

test("plugin buttons count in the toolbar's trailing width, so the address field ends 10 pt before them", () => {
  const button = 30;
  assert.equal(toolbarTrailingWidth(0, 0, button), 0);
  assert.equal(toolbarTrailingWidth(64, 0, button), 64);
  const fieldRight = (trailing) => 12 + trailing;
  const alone = toolbarTrailingWidth(0, 1, button);
  assert.equal(fieldRight(alone) - (pluginButtonsRight(8, 0) + button), 10);
  const withExtensions = toolbarTrailingWidth(64, 2, button);
  assert.equal(fieldRight(withExtensions) - (pluginButtonsRight(8, 64) + 2 * button + 2), 10);
  assert.equal(pluginButtonsRight(8, 64) - (8 + 64 - 6), 2, "they sit 2 pt left of the extensions, the extensions' own gap");
});

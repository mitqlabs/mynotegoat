/** Editor / previous-note divider math (pure). Run: npx tsx scripts/tests/split-heights.test.ts */
import assert from "node:assert/strict";
import { movePaneDivider, parseSavedHeight } from "../../src/lib/split-heights";

const start = { top: 320, bottom: 260 };

// Drag down: editor taller, the previous-note boxes shorter, total unchanged.
assert.deepEqual(movePaneDivider(start, 40, 140, 140), { top: 360, bottom: 220 });
// Drag up: all four previous-note boxes taller together, editor shorter.
assert.deepEqual(movePaneDivider(start, -100, 140, 140), { top: 220, bottom: 360 });
// Total never changes.
for (const d of [-999, -50, 0, 50, 999]) {
  const r = movePaneDivider(start, d, 140, 140);
  assert.equal(r.top + r.bottom, 580);
}
// Neither side goes under its minimum.
assert.deepEqual(movePaneDivider(start, -999, 140, 140), { top: 140, bottom: 440 });
assert.deepEqual(movePaneDivider(start, 999, 140, 140), { top: 440, bottom: 140 });
// A pair already smaller than both minimums just stays put at the top minimum.
const tiny = movePaneDivider({ top: 100, bottom: 100 }, 50, 140, 140);
assert.equal(tiny.top, 140);

assert.equal(parseSavedHeight(null, 260), 260);
assert.equal(parseSavedHeight("abc", 260), 260);
assert.equal(parseSavedHeight("-5", 260), 260);
assert.equal(parseSavedHeight("0", 260), 260);
assert.equal(parseSavedHeight("333", 260), 333);
console.log("split-heights: ok");

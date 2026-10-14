import assert from "node:assert/strict";
import { officeCellLabel, officeMenuChoices, officePatch } from "../../src/lib/office-assign";

// Mock offices only.
const locs = [
  { id: "loc-1", name: "Mock Spine & Wellness Center", nickname: "Mock Spine & Wellness Center" },
  { id: "loc-2", name: "", nickname: "Northside" },
];
assert.equal(officeCellLabel(undefined, locs), "No office set");
assert.equal(officeCellLabel("loc-gone", locs), "No office set", "deleted office reads as unset");
assert.equal(officeCellLabel("loc-2", locs), "Northside");
assert.deepEqual(
  officeMenuChoices(locs).map((c) => c.label),
  ["Mock Spine & Wellness Center", "Northside", "No office set"],
  "every office, then No office set to clear",
);
assert.equal(officeMenuChoices(locs).at(-1)!.id, "");
assert.deepEqual(officePatch("loc-1"), { locationId: "loc-1" });
assert.deepEqual(officePatch(""), { locationId: undefined }, "clearing stores no office");
console.log("PASS office-assign (mock data)");

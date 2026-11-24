import assert from "node:assert/strict";
import {
  addMarketingRep,
  defaultRepName,
  getDefaultMarketingReps,
  liveMarketingReps,
  mergeMarketingReps,
  moveMarketingRep,
  normalizeMarketingReps,
  removeMarketingRep,
  renameMarketingRep,
  repChoices,
} from "../../src/lib/marketing-reps";
import { UNION_MERGE_KEYS } from "../../src/lib/cloud-state";
import { CLOUD_KEY_REGISTRY } from "../../src/lib/cloud-key-registry";

const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-01T11:00:00.000Z";
const names = (r: ReturnType<typeof getDefaultMarketingReps>) => liveMarketingReps(r).map((x) => x.name);
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log(`ok - ${name}`); };

test("seed list is Dr. Mike and is the default for new entries", () => {
  assert.deepEqual(names(getDefaultMarketingReps()), ["Dr. Mike"]);
  assert.equal(defaultRepName(getDefaultMarketingReps()), "Dr. Mike");
  assert.deepEqual(names(normalizeMarketingReps(undefined)), ["Dr. Mike"]);
  assert.deepEqual(names(normalizeMarketingReps([])), ["Dr. Mike"]);
});
test("add / duplicate / rename / remove", () => {
  let r = getDefaultMarketingReps();
  r = addMarketingRep(r, "  Dr.  Rivera ", T1, "r-1");
  assert.deepEqual(names(r), ["Dr. Mike", "Dr. Rivera"]);
  assert.equal(addMarketingRep(r, "dr. rivera", T1, "r-2"), r);
  assert.equal(addMarketingRep(r, "   ", T1), r);
  r = renameMarketingRep(r, "r-1", "Dr. Rivera Jr.", T2);
  assert.deepEqual(names(r), ["Dr. Mike", "Dr. Rivera Jr."]);
  assert.equal(renameMarketingRep(r, "r-1", "Dr. Mike", T2), r);
  r = removeMarketingRep(r, "r-1", T2);
  assert.deepEqual(names(r), ["Dr. Mike"]);
  assert.ok(r.find((x) => x.id === "r-1")?.deleted);
});
test("removed Dr. Mike stays removed; default falls to first rep", () => {
  let r = addMarketingRep(getDefaultMarketingReps(), "Dr. Rivera", T1, "r-1");
  r = removeMarketingRep(r, "dr-mike", T2);
  const back = normalizeMarketingReps(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(names(back), ["Dr. Rivera"]);
  assert.equal(defaultRepName(back), "Dr. Rivera");
});
test("re-adding a removed name brings it back", () => {
  let r = addMarketingRep(getDefaultMarketingReps(), "Dr. Rivera", T1, "r-1");
  r = removeMarketingRep(r, "r-1", T1);
  r = addMarketingRep(r, "dr. rivera", T2, "r-9");
  assert.deepEqual(names(r), ["Dr. Mike", "Dr. Rivera"]);
});
test("move reorders", () => {
  let r = addMarketingRep(getDefaultMarketingReps(), "Dr. Rivera", T1, "r-1");
  r = moveMarketingRep(r, "r-1", -1, T2);
  assert.deepEqual(names(normalizeMarketingReps(r)), ["Dr. Rivera", "Dr. Mike"]);
  assert.equal(moveMarketingRep(r, "r-1", -1, T2), r);
});
test("old typed names keep showing in the dropdown (never lost)", () => {
  const r = getDefaultMarketingReps();
  assert.deepEqual(repChoices(r, "Pat Example"), ["Dr. Mike", "Pat Example"]);
  assert.deepEqual(repChoices(r, "dr. mike"), ["Dr. Mike"]);
  assert.deepEqual(repChoices(r, ""), ["Dr. Mike"]);
  const removed = removeMarketingRep(addMarketingRep(r, "Dr. Rivera", T1, "r-1"), "r-1", T2);
  assert.deepEqual(repChoices(removed, "Dr. Rivera"), ["Dr. Mike", "Dr. Rivera"]);
});
test("cloud merge keeps both computers' edits; a remove wins over an older copy", () => {
  const base = addMarketingRep(getDefaultMarketingReps(), "Dr. Rivera", T1, "r-1");
  const a = addMarketingRep(base, "Pat Example", T2, "r-2");
  const b = removeMarketingRep(base, "r-1", T2);
  const merged = mergeMarketingReps(a, b);
  assert.deepEqual(names(merged).sort(), ["Dr. Mike", "Pat Example"]);
  assert.deepEqual(names(mergeMarketingReps(base, null)), ["Dr. Mike", "Dr. Rivera"]);
});
test("key is registered, cloud-backed and union-merged", () => {
  assert.ok(UNION_MERGE_KEYS.has("casemate.marketing-reps.v1"));
  assert.ok(CLOUD_KEY_REGISTRY["casemate.marketing-reps.v1"]);
});
console.log(`${n} passed`);

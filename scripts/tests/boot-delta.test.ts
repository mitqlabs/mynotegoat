import assert from "node:assert/strict";
import { planNotesDelta, planKvDelta, hashString, maxIso } from "../../src/lib/boot-delta";
assert.equal(maxIso([]), null);
assert.equal(maxIso(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]), "2026-02-01T00:00:00Z");
assert.equal(hashString("abc"), hashString("abc"));
assert.notEqual(hashString("abc"), hashString("abd"));
console.log(JSON.stringify({ planNotesDelta: typeof planNotesDelta, planKvDelta: typeof planKvDelta }));
const cur = "2026-10-01T00:00:00.000Z";
const old = "2026-09-01T00:00:00.000Z", fresh = "2026-10-01T00:05:00.000Z";
const local = [{ id: "a", updatedAt: "r1" }, { id: "b", updatedAt: "r2" }, { id: "c", updatedAt: "mine" }, { id: "u", updatedAt: "r4" }];
const meta = [
  { id: "a", updatedAt: old, recordUpdatedAt: "r1" },      // unchanged -> standIn
  { id: "b", updatedAt: fresh, recordUpdatedAt: "r2x" },   // cloud changed -> fetch
  { id: "c", updatedAt: old, recordUpdatedAt: "r3" },      // local differs -> fetch
  { id: "u", updatedAt: old, recordUpdatedAt: "r4" },      // unconfirmed -> fetch
  { id: "z", updatedAt: old, recordUpdatedAt: "r5" },      // not local, old -> skip
];
assert.equal(planNotesDelta({ meta, local, cursor: null, unconfirmedIds: new Set() }), null);
const p = planNotesDelta({ meta, local, cursor: cur, unconfirmedIds: new Set(["u"]) })!;
assert.deepEqual(p.fetchIds.sort(), ["b", "c", "u"]);
assert.deepEqual(p.standIns.map((x) => x.id), ["a"]);
const v = '{"x":1}';
const want = planKvDelta({
  meta: [{ key: "k1", updatedAt: old }, { key: "k2", updatedAt: fresh }, { key: "k3", updatedAt: old }, { key: "k4", updatedAt: old }],
  stamps: { k1: { u: old, h: hashString(v) }, k2: { u: old, h: hashString(v) }, k3: { u: old, h: hashString(v) } },
  localRaw: (k) => (k === "k3" ? '{"x":2}' : v),
});
assert.deepEqual(want.sort(), ["k2", "k3", "k4"]);
console.log("boot-delta ok");

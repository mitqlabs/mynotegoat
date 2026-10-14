import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sameJson, unionMerge } from "../../src/lib/kv-merge";

// Mock data only. A stale copy on either side must never drop data.

// Map of patient → payments (cash-payments / patient-packages shape).
const local = { P1: [{ id: "a", amount: 10, updatedAt: "2026-10-14T10:00:00Z" }, { id: "b", amount: 5, updatedAt: "2026-10-14T10:00:00Z" }], P2: [{ id: "c", amount: 1 }] };
const cloud = { P1: [{ id: "a", amount: 99, updatedAt: "2026-10-01T00:00:00Z" }], P3: [{ id: "d", amount: 2 }] };
const m = unionMerge(local, cloud) as Record<string, { id: string; amount: number }[]>;
assert.deepEqual(Object.keys(m).sort(), ["P1", "P2", "P3"]);
assert.equal(m.P1.length, 2, "local-only payment kept");
assert.equal(m.P1.find((x) => x.id === "a")?.amount, 10, "newer edit wins");
// Newer cloud edit wins too.
const m2 = unionMerge({ P1: [{ id: "a", amount: 1, updatedAt: "2026-01-01" }] }, { P1: [{ id: "a", amount: 2, updatedAt: "2026-02-01" }] }) as Record<string, { amount: number }[]>;
assert.equal(m2.P1[0].amount, 2);

// Empty local (after a wipe) → cloud fully restored; empty cloud → local kept.
assert.ok(sameJson(unionMerge(null, cloud), cloud));
assert.ok(sameJson(unionMerge(local, []), local), "an old empty [] in the cloud never wipes a local map");
assert.ok(sameJson(unionMerge({}, cloud), cloud));
assert.ok(sameJson(unionMerge(local, null), local));

// Dismissal lists (strings): union.
assert.deepEqual(unionMerge(["x", "y"], ["y", "z"]), ["x", "y", "z"]);
// Sub-category map of arrays: union per category.
assert.deepEqual(unionMerge({ Specialist: ["Ortho"] }, { Specialist: ["Pain"], Imaging: ["MRI"] }), { Specialist: ["Ortho", "Pain"], Imaging: ["MRI"] });

// Wiring: boot pulls the previously-unpulled keys with union merge, and display prefs survive wipes.
const cs = readFileSync("src/lib/cloud-state.ts", "utf8");
for (const k of ["cash-payments", "patient-packages", "contact-subcategories", "key-date-dismissals", "duplicate-dismissals", "attorney-not-same", "team-settings", "team-member-order", "onboarding"]) {
  assert.ok((cs.match(new RegExp(`"casemate\\.${k}\\.v1"`, "g")) ?? []).length >= 1, `${k} pulled on boot`);
}
assert.match(cs, /UNION_MERGE_KEYS\.has\(key\)/);
assert.match(cs, /PRESERVE_ON_WIPE_KEYS\.has\(key\)/);
assert.match(readFileSync("supabase/workspace_kv_history.sql", "utf8"), /after update or delete on public\.workspace_kv/);
console.log("kv-merge-safety: ok");

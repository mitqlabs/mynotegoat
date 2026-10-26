/**
 * G.O.A.T. Dx suggestion Ignore — ids, restore, cloud merge. Mock data only.
 * Run: npx tsx scripts/tests/dx-suggestion-ignores.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dxIgnoreId, mergeDxIgnores, setDxIgnored, type DxIgnoreRecord } from "../../src/lib/dx-suggestion-ignores";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${n}: ${(e as Error).message.split("\n")[0]}`); } };
const on = (r: DxIgnoreRecord[]) => new Set(r.filter((x) => x.ignored).map((x) => x.id));

check("id keyed by patient + source + code (dots/case ignored)", () => {
  assert.equal(dxIgnoreId("p1", "mri", "m50.12"), dxIgnoreId("p1", "mri", "M5012"));
  assert.notEqual(dxIgnoreId("p1", "mri", "M50.12"), dxIgnoreId("p1", "xray", "M50.12"));
  assert.notEqual(dxIgnoreId("p1", "mri", "M50.12"), dxIgnoreId("p2", "mri", "M50.12"));
});
const id = dxIgnoreId("p1", "mri", "M50.12");
const a = setDxIgnored([], id, true, "Mock A", "2026-10-23T20:00:00.000Z", "M50.12 — Mock");
const r = setDxIgnored(a, id, false, "Mock B", "2026-10-23T21:00:00.000Z");
check("restore keeps record + label", () => { assert.equal(r.length, 1); assert.equal(r[0].label, "M50.12 — Mock"); assert.equal(on(r).size, 0); });
check("merge: newer restore beats older ignore", () => assert.equal(on(mergeDxIgnores(a, r)).size, 0));
check("merge: other device's ignores kept", () => {
  const b = setDxIgnored([], dxIgnoreId("p2", "xray", "M54.2"), true, "Mock C", "2026-10-23T20:30:00.000Z");
  assert.equal(on(mergeDxIgnores(a, b)).size, 2);
});
check("key is cloud-synced and union-merged", () => {
  const cs = readFileSync("src/lib/cloud-state.ts", "utf8");
  assert.equal(cs.split('"casemate.dx-suggestion-ignores.v1"').length - 1, 2);
  assert.ok(readFileSync("src/lib/cloud-key-registry.ts", "utf8").includes('"casemate.dx-suggestion-ignores.v1": "workspace"'));
});
console.log(`dx-suggestion-ignores: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

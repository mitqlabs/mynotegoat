/**
 * {{AGE}} is the patient's age on the note's date of service, not today.
 * Mock data only.  Run:  npx tsx scripts/tests/age-as-of-visit.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ageOn, ageTokenOn } from "../../src/lib/age";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

test("birthday between visit date and today", () => {
  // Mock patient born 10/10/1990. Visit 10/05/2026 (still 35), written 10/12/2026 (now 36).
  assert.equal(ageTokenOn("10/10/1990", "10/05/2026"), "35");
  assert.equal(ageTokenOn("10/10/1990", "10/12/2026"), "36");
  assert.equal(ageTokenOn("1990-10-10", "2026-10-05"), "35");
});
test("birthday on the visit date counts", () => {
  assert.equal(ageOn("10/10/1990", "10/10/2026"), 36);
  assert.equal(ageOn("10/10/1990", "10/09/2026"), 35);
});
test("leap-day birthday", () => {
  assert.equal(ageOn("02/29/2000", "02/28/2026"), 25);
  assert.equal(ageOn("02/29/2000", "03/01/2026"), 26);
});
test("falls back to today when no date", () => {
  const now = new Date();
  const dob = `01/01/${now.getFullYear() - 40}`;
  assert.equal(ageTokenOn(dob, ""), "40");
  assert.equal(ageTokenOn(dob, undefined), "40");
});
test("unknown or invalid", () => {
  assert.equal(ageTokenOn("", "10/05/2026"), "");
  assert.equal(ageTokenOn("13/40/1990", "10/05/2026"), "");
  assert.equal(ageTokenOn("10/10/2027", "10/05/2026"), "");
});
test("every note macro context passes the note's date", () => {
  const src = readFileSync("src/components/encounter-workspace.tsx", "utf8");
  assert.ok(!/getAgeFromDob|new Date\(\)\.getFullYear\(\) - /.test(src));
  assert.ok(/AGE: ageTokenOn\(patient\?\.dob \?\? "", asOfDate\)/.test(src));
  for (const call of src.match(/buildMacroContext\([^)]*\)/g)!.filter((c) => !c.includes(":"))) {
    assert.ok(call.includes(","), `missing date: ${call}`);
  }
  for (const call of src.match(/buildPlanSnippets\(([\s\S]*?)\)\s*[;\n.]/g) ?? []) {
    assert.ok(/encounterDate|dateUs/.test(call), `missing date: ${call}`);
  }
});
console.log(`${passed} passed`);

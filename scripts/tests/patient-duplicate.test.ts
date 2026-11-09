/**
 * Same name is not a duplicate. Same name AND same date of loss is.
 * Run: npx tsx scripts/tests/patient-duplicate.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findDuplicateCases } from "../../src/lib/patient-duplicate";

const rows = [
  { id: "a", fullName: "Torres, Javier", dateOfLoss: "2026-02-11" },
  { id: "b", fullName: "Torres, Ana", dateOfLoss: "2026-02-11" },
  { id: "c", fullName: "Haddad, Layla", dateOfLoss: "2026-10-28" },
];

assert.deepEqual(
  findDuplicateCases(rows, { firstName: "Javier", lastName: "Torres" }).map((r) => r.id),
  [],
  "name alone is not an alarm",
);
assert.deepEqual(
  findDuplicateCases(rows, { firstName: "Javier", lastName: "Torres", dateOfLoss: "03/01/2026" }).map((r) => r.id),
  [],
);
assert.deepEqual(
  findDuplicateCases(rows, { firstName: "Javier", lastName: "Torres", dateOfLoss: "02/11/2026" }).map((r) => r.id),
  ["a"],
);
assert.deepEqual(
  findDuplicateCases(rows, { firstName: "javier", lastName: "TORRES", dateOfLoss: "2026-02-11" }).map((r) => r.id),
  ["a"],
);
assert.equal(findDuplicateCases(rows, { firstName: "Ana", lastName: "Torres", dateOfLoss: "02/11/2026" })[0]?.id, "b");

for (const file of [
  "src/app/(portal)/patients/page.tsx",
  "src/app/(portal)/appointments/page.tsx",
]) {
  const src = readFileSync(file, "utf8");
  assert.match(src, /findDuplicateCases/);
  assert.match(src, /DuplicateCaseWarning/);
}
const warning = readFileSync(new URL("../../src/components/duplicate-case-warning.tsx", import.meta.url), "utf8");
assert.match(warning, /href=\{`\/patients\/\$\{patient\.id\}`\}/);

console.log("patient-duplicate ok");

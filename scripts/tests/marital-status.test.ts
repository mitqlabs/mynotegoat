/**
 * Marital Status: options, normalizing old / imported values (blank stays blank),
 * tokens, and the New Patient row layout. Mock data only.
 * Run:  npx tsx scripts/tests/marital-status.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maritalStatusOptions, normalizeMaritalStatus } from "../../src/lib/marital-status";
import { getFormalTitle } from "../../src/lib/honorifics";
import { macroAutoFieldLabels } from "../../src/lib/macro-templates";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

test("options in order", () => {
  assert.deepEqual([...maritalStatusOptions], ["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic Partner"]);
});
test("normalize: new values, legacy Other, blank for missing / junk", () => {
  assert.equal(normalizeMaritalStatus("separated"), "Separated");
  assert.equal(normalizeMaritalStatus("Domestic_partner"), "Domestic Partner");
  assert.equal(normalizeMaritalStatus(" MARRIED "), "Married");
  assert.equal(normalizeMaritalStatus("Other"), "Other");
  assert.equal(normalizeMaritalStatus(undefined), undefined);
  assert.equal(normalizeMaritalStatus(null), undefined);
  assert.equal(normalizeMaritalStatus(""), undefined);
  assert.equal(normalizeMaritalStatus(42), undefined);
});
test("honorifics unchanged; new statuses → Ms. for women", () => {
  assert.equal(getFormalTitle("Female", "Married"), "Mrs.");
  assert.equal(getFormalTitle("Female", "Separated"), "Ms.");
  assert.equal(getFormalTitle("Female", "Domestic Partner"), "Ms.");
  assert.equal(getFormalTitle("Male", ""), "Mr.");
});
test("tokens: {{MARITAL_STATUS}} in macros, reports and documents", () => {
  assert.equal(macroAutoFieldLabels.MARITAL_STATUS, "Marital status");
  for (const f of ["src/lib/report-templates.ts", "src/lib/document-templates.ts", "src/lib/report-generator.ts", "src/components/encounter-workspace.tsx", "src/components/patient-case-file.tsx"]) {
    assert.ok(readFileSync(f, "utf8").includes("MARITAL_STATUS"), f);
  }
});
test("New Patient: Marital Status right after Sex; tidy 3-column grid; same input classes", () => {
  const s = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
  const at = s.indexOf('data-row="new-patient-identity"');
  const row = s.slice(s.lastIndexOf("<div", at), s.indexOf("</div>", at));
  assert.ok(row.includes("sm:grid-cols-3"));
  const labels = [...row.matchAll(/text-\[var\(--text-muted\)\]">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Last Name *", "First Name *", "Phone *", "DOB", "Sex", "Marital Status"]);
  const classes = [...row.matchAll(/<(?:input|select)\s+className="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(classes).size, 1, classes.join(" | "));
  assert.ok(s.includes("maritalStatus: newPatientDraft.maritalStatus || undefined"));
});
test("saved + synced like Sex", () => {
  const cloud = readFileSync("src/lib/patients-cloud.ts", "utf8");
  assert.ok(cloud.includes("marital_status: patient.maritalStatus ?? null"));
  assert.ok(cloud.includes("maritalStatus: normalizeMaritalStatus(row.marital_status)"));
  const file = readFileSync("src/components/patient-case-file.tsx", "utf8");
  assert.ok(file.includes("maritalStatus: maritalStatus || undefined"));
  assert.ok(file.includes("data-patient-demographics"));
});
console.log(`${passed} passed`);

/**
 * Case file header: three tight rows, alert under the name, age beside the name.
 * Run: npx tsx scripts/tests/case-header-layout.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ageOn } from "../../src/lib/age";

const header = readFileSync("src/components/patient-file-header.tsx", "utf8");
const fields = readFileSync("src/components/patient-person-fields.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const caseFile = readFileSync("src/components/patient-case-file.tsx", "utf8");

assert.equal(ageOn("03/15/1978", "2026-11-25"), 48);
assert.ok(caseFile.includes("<PatientFileHeader"));
assert.ok(!caseFile.includes("case-header-actions"));

const cssBlock = css.slice(css.indexOf(".case-header {"), css.indexOf(".case-header {") + 1200);
assert.ok(cssBlock.includes('"photo name"'));
assert.ok(cssBlock.includes('"photo alerts"'));
assert.ok(cssBlock.includes('"info info"'));
assert.ok(!css.includes("minmax(24rem, 30rem)"), "alert column no longer reserves a side strip");

assert.ok(header.includes("data-patient-age"));
assert.ok(header.includes('{" · "}'));
assert.ok(header.includes("case-header-alerts"));
const nameAt = header.indexOf("case-header-name");
const alertAt = header.indexOf("+ Alert");
const infoAt = header.indexOf("case-header-info");
assert.ok(nameAt > -1 && nameAt < alertAt && alertAt < infoAt, "alert sits under the name, above the fields");

const rows = fields.slice(fields.indexOf("export function PatientCaseHeaderFields"));
const labels = [...rows.matchAll(/>(Last Name|First Name|DOB|Phone|Sex|Marital Status|Email|Address 1)</g)].map((match) => match[1]);
assert.deepEqual(labels.slice(0, 7), ["Last Name", "First Name", "DOB", "Phone", "Sex", "Marital Status", "Email"]);
assert.ok(!rows.includes("Age {age}"), "age is only on the title, not beside DOB");
assert.ok(!rows.includes("data-dob-age"));
assert.ok(rows.includes("No reminder texts"));
assert.ok(rows.includes('ariaLabel="Text this patient"'));
assert.ok(rows.includes('aria-label="Add to Contacts"'));
assert.ok(rows.includes("embedded"));
assert.ok(!fields.includes("Age {age}"), "the DOB row does not repeat the age");
assert.ok(!header.includes("bg-white"));
assert.ok(!rows.includes("bg-blue"));

console.log("case header layout OK");

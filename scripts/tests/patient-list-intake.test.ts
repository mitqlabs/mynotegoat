/**
 * New Patient Intake: no case info stays above the list until moved.
 * Run: npx tsx scripts/tests/patient-list-intake.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isInNewPatientIntake, lacksCaseInfo } from "../../src/lib/patient-list-intake";

const pi = { dateOfLoss: "", isCashPatient: false };
assert.equal(lacksCaseInfo(pi), true);
assert.equal(isInNewPatientIntake(pi), true);
assert.equal(isInNewPatientIntake({ ...pi, onPatientList: true }), false);
assert.equal(lacksCaseInfo({ dateOfLoss: "2026-02-11", isCashPatient: false }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", isCashPatient: true }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", deleted: true }), false);

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(page, /NewPatientIntakeSection/);
assert.match(page, /listedPatients/);
assert.match(page, /onPatientList: true/);
const section = readFileSync(new URL("../../src/components/new-patient-intake-section.tsx", import.meta.url), "utf8");
assert.match(section, /Move Patient to Patient List/);
const cloud = readFileSync(new URL("../../src/lib/patients-cloud.ts", import.meta.url), "utf8");
assert.match(cloud, /on_patient_list/);

console.log("patient-list-intake ok");

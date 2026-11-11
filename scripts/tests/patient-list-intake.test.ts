/**
 * New Patient Intake: no case info stays above the list until case info is added.
 * Delete is permanent, and only for an intake chart with no notes or appointments.
 * Run: npx tsx scripts/tests/patient-list-intake.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intakePatientHasNotes } from "../../src/lib/intake-delete";
import { intakeDeleteReason, isInNewPatientIntake, lacksCaseInfo } from "../../src/lib/patient-list-intake";

const pi = { dateOfLoss: "", isCashPatient: false };
assert.equal(lacksCaseInfo(pi), true);
assert.equal(isInNewPatientIntake(pi), true);
assert.equal(isInNewPatientIntake({ ...pi, onPatientList: true }), false);
assert.equal(lacksCaseInfo({ dateOfLoss: "2026-02-11", isCashPatient: false }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", isCashPatient: true }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", deleted: true }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", isCashPatient: false, lastUpdate: "2026-11-11" }), true, "a new chart with no case info stays in intake");

assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: false, appointmentCount: 0 }), null);
assert.equal(intakeDeleteReason({ inIntake: false, hasNotes: false, appointmentCount: 0 }), "Only an intake chart with no case info can be deleted here.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: true, appointmentCount: 0 }), "This patient has notes.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: false, appointmentCount: 2 }), "This patient has appointments.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: true, appointmentCount: 1 }), "This patient has notes and appointments.");
assert.equal(intakePatientHasNotes("preview-only", "Added from G.O.A.T. Mail."), false);
assert.equal(intakePatientHasNotes("preview-only", "Added from G.O.A.T. Mail. Missing: phone, date of injury."), false);
assert.equal(intakePatientHasNotes("preview-only", "Spoke with the attorney."), true);

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(page, /NewPatientIntakeSection/);
assert.match(page, /listedPatients/);
assert.doesNotMatch(page, /deletePatientRecord/);
const section = readFileSync(new URL("../../src/components/new-patient-intake-section.tsx", import.meta.url), "utf8");
assert.match(section, />\s*Delete\s*</);
assert.match(section, /Delete this patient\? This can't be undone\./);
assert.match(section, /disabled=\{Boolean\(reason\)\}/);
assert.match(section, /title=\{reason \?\? undefined\}/);
assert.match(section, /deleteIntakePatient/);
assert.doesNotMatch(section, /Move Patient to Patient List/);
assert.doesNotMatch(section, />\s*Remove\s*</);
const board = readFileSync(new URL("../../src/components/goat-briefing-board.tsx", import.meta.url), "utf8");
assert.match(board, /IntakeDeleteButton/);
assert.doesNotMatch(board, /Move Patient to Patient List/);
assert.doesNotMatch(board, />\s*Remove\s*</);
const guard = readFileSync(new URL("../../src/lib/intake-delete.ts", import.meta.url), "utf8");
assert.match(guard, /if \(intakeDeleteBlock\(patientId\)\) return false/);
assert.match(guard, /permanentlyDeletePatientRecord/);
assert.doesNotMatch(guard, /deletePatientRecord/);
const cloud = readFileSync(new URL("../../src/lib/patients-cloud.ts", import.meta.url), "utf8");
assert.match(cloud, /on_patient_list/);

console.log("patient-list-intake ok");

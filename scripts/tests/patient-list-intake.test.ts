/**
 * New Patient Intake: a patient stays until an attorney is set (Self counts)
 * AND an Initial Exam date or a booked New Patient visit exists.
 * Attorney alone does not move them. Nothing is written to the patient row.
 * Delete is permanent, and only for a chart still on that list with no notes or appointments.
 * Run: npx tsx scripts/tests/patient-list-intake.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intakePatientHasNotes } from "../../src/lib/intake-delete";
import { createPatientRecord, patients, updatePatientRecordById } from "../../src/lib/mock-data";
import { attorneyInfoIsSet, intakeDeleteReason, isInNewPatientIntake, lacksCaseInfo } from "../../src/lib/patient-list-intake";

const visit = (over: { patientId?: string; appointmentType?: string; status?: string; date?: string }) => ({
  patientId: "p1",
  patientName: "Testpatient, Kara",
  appointmentType: "Personal Injury New Patient",
  status: "Scheduled",
  date: "2026-11-12",
  ...over,
});

const pi = { id: "p1", fullName: "Testpatient, Kara", attorney: "", dateOfLoss: "", isCashPatient: false };
assert.equal(lacksCaseInfo(pi), true);
assert.equal(attorneyInfoIsSet(""), false);
assert.equal(attorneyInfoIsSet("  "), false);
assert.equal(attorneyInfoIsSet("Self"), true);
assert.equal(attorneyInfoIsSet("SELF"), true);
assert.equal(isInNewPatientIntake(pi), true, "no attorney stays in New Patient");
assert.equal(isInNewPatientIntake({ ...pi, onPatientList: true }), true, "the stored onPatientList flag is not read");
assert.equal(lacksCaseInfo({ dateOfLoss: "2026-02-11", isCashPatient: false }), false);
assert.equal(isInNewPatientIntake({ ...pi, dateOfLoss: "2026-02-11", attorney: "Ward Law" }), true, "date of injury and attorney, never seen, stays");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "SELF" }), true, "SELF alone stays");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "self", matrix: { initialExam: "11/12/2026" } }), false, "self plus a saved Initial Exam leaves");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law", matrix: { initialExam: "2026-11-12" } }), false, "ISO Initial Exam counts");
assert.equal(isInNewPatientIntake({ ...pi, matrix: { initialExam: "11/12/2026" } }), true, "an exam with no attorney stays");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({})]), false, "a booked New Patient visit counts");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ status: "Check Out" })]), false);
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ status: "Reschedule" })]), false, "a New Patient visit marked Reschedule still counts as booked");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ status: "Canceled" })]), true, "a canceled New Patient visit does not count");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ status: "No Show" })]), true, "a no-show does not count");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ appointmentType: "Follow-Up Visit" })]), true, "a follow-up is not a New Patient visit");
assert.equal(isInNewPatientIntake({ ...pi, attorney: "Ward Law" }, [visit({ patientId: "someone-else" })]), true);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", isCashPatient: true }), false);
assert.equal(isInNewPatientIntake({ dateOfLoss: "", deleted: true }), false);
assert.equal(isInNewPatientIntake(pi), true, "a new chart with no attorney stays in intake");

const savedWithoutCase = createPatientRecord({
  firstName: "Kara",
  lastName: "Testpatient",
  phone: "818-555-0142",
  dateOfLoss: "",
});
assert.ok(savedWithoutCase);
assert.equal(savedWithoutCase.onPatientList, undefined);
assert.equal(savedWithoutCase.attorney, "Self", "a blank attorney is stored as Self, and Self counts");
const savedRow = () => patients.find((row) => row.id === savedWithoutCase.id)!;
assert.equal(isInNewPatientIntake(savedRow()), true);
updatePatientRecordById(savedWithoutCase.id, { dateOfLoss: "2026-02-11" });
assert.equal(isInNewPatientIntake(savedRow()), true, "adding a date of injury does not leave New Patient");
updatePatientRecordById(savedWithoutCase.id, { attorney: "Ward Law" });
assert.equal(isInNewPatientIntake(savedRow()), true, "attorney alone does not leave New Patient");
updatePatientRecordById(savedWithoutCase.id, { matrix: { initialExam: "2026-03-01" } });
assert.equal(isInNewPatientIntake(savedRow()), false, "attorney plus Initial Exam leaves New Patient");
assert.equal(savedRow().onPatientList, undefined, "leaving the list does not write onPatientList");
const pageSave = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(pageSave.slice(pageSave.indexOf("const createdPatient"), pageSave.indexOf("const createdPatient") + 800), /onPatientList:\s*true/);

assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: false, appointmentCount: 0 }), null);
assert.equal(intakeDeleteReason({ inIntake: false, hasNotes: false, appointmentCount: 0 }), "Only a patient still on the New Patient list can be deleted here.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: true, appointmentCount: 0 }), "This patient has notes.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: false, appointmentCount: 2 }), "This patient has appointments.");
assert.equal(intakeDeleteReason({ inIntake: true, hasNotes: true, appointmentCount: 1 }), "This patient has notes and appointments.");
assert.equal(intakePatientHasNotes("preview-only", "Added from G.O.A.T. Mail."), false);
assert.equal(intakePatientHasNotes("preview-only", "Added from G.O.A.T. Mail. Missing: phone, date of injury."), false);
assert.equal(intakePatientHasNotes("preview-only", "Spoke with the attorney."), true);

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(page, /NewPatientIntakeSection/);
assert.match(page, /listedPatients/);
assert.match(page, /isInNewPatientIntake\(patient, initialExamIndex\)/);
const dashboard = readFileSync(new URL("../../src/app/(portal)/dashboard/page.tsx", import.meta.url), "utf8");
assert.match(dashboard, /isInNewPatientIntake\(patient, initialExamIndex\)/);
const model = readFileSync(new URL("../../src/lib/goat-page-model.ts", import.meta.url), "utf8");
assert.match(model, /isInNewPatientIntake\(p, intakeIndex\)/);
assert.doesNotMatch(page, /deletePatientRecord/);
const section = readFileSync(new URL("../../src/components/new-patient-intake-section.tsx", import.meta.url), "utf8");
assert.match(section, /Self counts/);
assert.match(section, /were never seen/);
assert.match(section, />\s*Delete\s*</);
assert.match(section, /Delete this patient\? This can't be undone\./);
assert.match(section, /disabled=\{Boolean\(reason\)\}/);
assert.match(section, /title=\{reason \?\? undefined\}/);
assert.match(section, /deleteIntakePatient/);
assert.doesNotMatch(section, /Move Patient to Patient List/);
assert.doesNotMatch(section, />\s*Remove\s*</);
const board = readFileSync(new URL("../../src/components/goat-briefing-board.tsx", import.meta.url), "utf8");
assert.match(board, /isInNewPatientIntake\(patient, intakeIndex\)/);
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

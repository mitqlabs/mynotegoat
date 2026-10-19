/**
 * Quick new patient: only Last name, First name and Phone are required; a PI
 * patient can be saved with no case details and everything downstream copes.
 * Fictional data only.  Run:  npx tsx scripts/tests/quick-new-patient.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCaseNumber, buildFollowUpItems, toUsDateCanonical } from "../../src/lib/follow-up-queue";
import { createPatientRecord, patients } from "../../src/lib/mock-data";
import { newPtFromPrefill, officeDefaultsForDraft, scheduleCaseLabel } from "../../src/lib/new-patient-intake";
import { choiceLabel } from "../../src/lib/goat-ai/global-chat";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const p = createPatientRecord({ lastName: "Testerly", firstName: "Quinn", phone: "818-555-0199", dateOfLoss: "" })!;


test("PI patient saves with name + phone only; DOI stays blank (not today)", () => {
  assert.ok(p);
  assert.equal(p.fullName, "Testerly, Quinn");
  assert.equal(p.dateOfLoss, "");
  assert.equal(p.phone, "818-555-0199");
  assert.equal(p.dob, "");
  assert.ok(patients.some((x) => x.id === p.id));
});

test("cash patient still gets today as its anchor date", () => {
  const c = createPatientRecord({ lastName: "Cashley", firstName: "Rae", phone: "818-555-0100", dateOfLoss: "", isCashPatient: true })!;
  assert.match(c.dateOfLoss, /^\d{4}-\d{2}-\d{2}$/);
});

test("blank DOI: case # blank, no junk in labels", () => {
  assert.equal(buildCaseNumber("", p.fullName), "");
  assert.equal(scheduleCaseLabel("", p.fullName), "");
  assert.equal(toUsDateCanonical(""), "");
  const label = choiceLabel({ id: p.id, fullName: p.fullName, dob: "", dateOfLoss: "", caseStatus: "Active" } as Parameters<typeof choiceLabel>[0]);
  assert.doesNotMatch(label, /DOI|Case #|†|undefined|NaN|Invalid/);
});

test("Case Flow builds without crashing for a patient with no case details", () => {
  const rows = buildFollowUpItems([p], { effectiveInitialExam: () => "" });
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /undefined|NaN|Invalid Date|†/);
});

test("forms: only last, first and phone are required", () => {
  const page = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
  assert.doesNotMatch(page, /Date Of Injury is required/);
  assert.match(page, />Phone \*</);
  assert.match(page, /phone number \(10 digits\)/);
  const appt = readFileSync("src/app/(portal)/appointments/page.tsx", "utf8");
  assert.match(appt, /"Phone \*"/);
  assert.match(appt, /add their phone number \(10 digits\)/);
  const modal = readFileSync("src/components/new-appointment-modal.tsx", "utf8");
  assert.match(modal, /phone number \(10 digits\)/);
});

test("New Patient popup = patient info only; case fields behind + Case; no evaluation date/time", () => {
  const page = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
  const modal = page.slice(page.indexOf('data-testid="new-patient-modal"'), page.indexOf("Create Patient\n"));
  assert.ok(modal.length > 1000);
  assert.doesNotMatch(modal, /new-patient-eval-date|New Patient Evaluation|>Notes</);
  assert.match(modal, /\+ Case/);
  for (const f of ["Attorney", "Attorney Phone", "Date of Injury", "Case #"]) assert.ok(modal.includes(`>${f}</span>`), f);
  const appt = readFileSync("src/app/(portal)/appointments/page.tsx", "utf8");
  const np = appt.slice(appt.indexOf('data-row="new-patient-fields"'), appt.indexOf("Save Appointment adds the patient"));
  assert.doesNotMatch(np, /new-pt-attorney|new-pt-doi/);
  assert.match(np, /new-pt-dob/);
  const file = readFileSync("src/components/patient-case-file.tsx", "utf8");
  assert.match(file, /data-testid="case-info-missing"/);
});

test("New Appointment autofill: one provider + one location picked; G.O.A.T. prefill fills name/phone", () => {
  const d = officeDefaultsForDraft({ provider: "", location: "", x: 1 }, { doctorName: " Dr. Mock ", officeName: "Mock Office" });
  assert.deepEqual(d, { provider: "Dr. Mock", location: "Mock Office", x: 1 });
  assert.equal(officeDefaultsForDraft({ provider: "Dr. Other", location: "" }, { doctorName: "Dr. Mock", officeName: "" }).provider, "Dr. Other");
  const empty = { lastName: "", firstName: "", phone: "", dob: "", attorney: "", dateOfLoss: "", notes: "" };
  const np = newPtFromPrefill(empty, { lastName: "Smith", firstName: "John", phone: "(818) 555 0123", attorney: undefined });
  assert.deepEqual(np, { ...empty, lastName: "Smith", firstName: "John", phone: "818-555-0123" });
  const appt = readFileSync("src/app/(portal)/appointments/page.tsx", "utf8");
  assert.match(appt, /hasNewAppointmentPrefill\(\)/, "event on the Schedule works before the URL updates");
  assert.match(appt, /withOfficeDefaults\(createInitialDraft\(date/);
  assert.match(appt, /newPtFromPrefill\(emptyNewPt, pre\.newPatient\)/);
});

console.log(`\n${passed} passed`);

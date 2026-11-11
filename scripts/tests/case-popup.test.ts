/**
 * + Case popup: optional fields, a date of injury leaves intake, an exam books
 * a New Patient visit and becomes the Initial Exam date.
 * Run: npx tsx scripts/tests/case-popup.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewCasePopup } from "../../src/lib/new-patient-intake";
import { isInNewPatientIntake } from "../../src/lib/patient-list-intake";
import { getDefaultAppointmentTypes } from "../../src/lib/schedule-appointment-types";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const settings = getDefaultScheduleSettings();
const types = getDefaultAppointmentTypes();
const base = { attorney: "", attorneyPhone: "", dateOfLoss: "", evalDate: "", evalTime: "" };

const blank = reviewCasePopup(base, { appointments: [], settings, types });
assert.equal(blank.ok, true);
if (blank.ok) {
  assert.equal(blank.movesToPatientList, false);
  assert.equal(blank.visit, null);
  assert.equal(blank.initialExamIso, "");
  assert.equal(isInNewPatientIntake({ dateOfLoss: blank.dateOfLossIso, isCashPatient: false }), true);
}

const doiOnly = reviewCasePopup({ ...base, dateOfLoss: "02/11/2026", attorney: "Ward Law" }, { appointments: [], settings, types });
assert.equal(doiOnly.ok, true);
if (doiOnly.ok) {
  assert.equal(doiOnly.dateOfLossIso, "2026-02-11");
  assert.equal(doiOnly.movesToPatientList, true);
  assert.equal(doiOnly.visit, null);
  assert.equal(isInNewPatientIntake({ dateOfLoss: doiOnly.dateOfLossIso, isCashPatient: false }), false);
}

const booked = reviewCasePopup(
  { ...base, dateOfLoss: "02/11/2026", evalDate: "11/12/2026", evalTime: "10:00" },
  { appointments: [], settings, types },
);
assert.equal(booked.ok, true);
if (booked.ok) {
  assert.equal(booked.movesToPatientList, true);
  assert.equal(booked.initialExamIso, "2026-11-12");
  assert.equal(booked.visit?.iso, "2026-11-12");
  assert.equal(booked.visit?.time, "10:00");
  assert.equal(booked.visit?.type, "Personal Injury New Patient");
  assert.equal(booked.visit?.override, false);
}

const sunday = reviewCasePopup(
  { ...base, evalDate: "11/15/2026", evalTime: "10:00" },
  { appointments: [], settings, types },
);
assert.equal(sunday.ok, false);
if (!sunday.ok) assert.equal(sunday.conflict?.reason, "outside");

const taken: ScheduleAppointmentRecord[] = Array.from({ length: 4 }, (_, i) => ({
  id: `a${i}`,
  patientId: `p${i}`,
  patientName: "Mock",
  provider: "",
  location: "",
  appointmentType: "Follow-Up Visit",
  caseLabel: "",
  room: "",
  date: "2026-11-12",
  startTime: "10:00",
  durationMin: 60,
  status: "Scheduled",
  note: "",
  overrideOfficeHours: false,
}));
const full = reviewCasePopup(
  { ...base, evalDate: "11/12/2026", evalTime: "10:00" },
  { appointments: taken, settings, types },
);
assert.equal(full.ok, false);
if (!full.ok) assert.equal(full.conflict?.reason, "taken");

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
const popup = readFileSync(new URL("../../src/components/new-patient-case-popup.tsx", import.meta.url), "utf8");
const intake = readFileSync(new URL("../../src/components/new-patient-intake-section.tsx", import.meta.url), "utf8");
assert.match(page, /reviewCasePopup/);
assert.match(page, /initialExam: newPatientDraft\.isCashPatient \? "" : reviewed\.initialExamIso/);
assert.match(page, /data-testid="new-patient-add-case"/);
assert.match(page, /intake-add-case|onAddCase/);
assert.match(intake, /data-testid="intake-add-case"/);
for (const id of ["case-attorney", "case-attorney-phone", "case-doi", "case-number", "case-exam-date", "case-exam-time", "case-popup-save"]) {
  assert.ok(popup.includes(`data-testid="${id}"`), id);
}
assert.match(popup, /formatUsPhoneInput\(match\.phone\)/);

console.log("case-popup ok");

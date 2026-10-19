/**
 * Initial Exam rule: a booked New Patient visit fills the box only while it's
 * blank (and follows the visit when it moves); a date staff typed always sticks.
 * Neither side ever writes the other. Mock data only.
 * Run: npx tsx scripts/tests/initial-exam-sticky.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveInitialExamDate } from "../../src/lib/initial-exam-date";

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const TODAY = "2026-10-19";
const np = (date: string, status = "Scheduled") => ({ appointmentType: "Personal Injury New Patient", status, date });

t("blank box + New Patient visit booked Oct 22 → 10/22/2026 (still Scheduled)", () => {
  const r = resolveInitialExamDate("", [np("2026-10-22")], [], TODAY);
  assert.equal(r.date, "10/22/2026");
  assert.equal(r.source, "visit");
});
t("visit moved to Oct 24 while blank → follows it", () => {
  assert.equal(resolveInitialExamDate("", [np("2026-10-24")], [], TODAY).date, "10/24/2026");
});
t("visit canceled while blank → back to blank", () => {
  assert.equal(resolveInitialExamDate("", [np("2026-10-22", "Canceled")], [], TODAY).date, "");
});
t("staff typed 06/26/2026 → sticks through moves, reschedules, cancels, check-ins", () => {
  for (const appts of [[np("2026-10-22")], [np("2026-10-30")], [np("2026-10-22", "Canceled")], [np("2026-10-22", "Checked Out")], []]) {
    const r = resolveInitialExamDate("06/26/2026", appts, [], TODAY);
    assert.equal(r.date, "06/26/2026");
    assert.equal(r.source, "manual");
  }
});

const sched = readFileSync("src/app/(portal)/appointments/page.tsx", "utf8");
const pts = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
const file = readFileSync("src/components/patient-case-file.tsx", "utf8");
t("booking a new patient never saves an Initial Exam (so it can't go stale or look 'typed')", () => {
  const create = sched.slice(sched.indexOf("const created = createPatientRecord({"), sched.indexOf("if (!created)", sched.indexOf("const created = createPatientRecord({")));
  assert.doesNotMatch(create, /initialExam:/);
  assert.match(pts, /initialExam: "",/);
});
t("Schedule code never writes a patient's Initial Exam", () => {
  assert.doesNotMatch(sched, /matrix:\s*\{[^}]*initialExam/);
  assert.doesNotMatch(sched, /matrix\.initialExam\s*=/);
});
t("patient page saves only the typed value (not the visit-derived one) and never touches appointments from it", () => {
  assert.match(file, /initialExam: toIsoDateFromUsDate\(initialExam\)/);
  assert.match(file, /value=\{initialExamInfo\.source === "visit" \? initialExamInfo\.date : initialExam\}/);
  const box = file.slice(file.indexOf('data-initial-exam-source'), file.indexOf('data-initial-exam-source') + 1500);
  assert.doesNotMatch(box, /updateAppointment|addAppointments|deleteAppointment|setAppointments/);
});

console.log(`\n${passed} passed`);

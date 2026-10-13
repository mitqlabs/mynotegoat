/**
 * Initial Exam: any existing New Patient appointment counts (not only Checked In),
 * except Canceled / No Show. Mock data only.  Run:  npx tsx scripts/tests/initial-exam-any-appointment.test.ts
 */
import assert from "node:assert/strict";
import { resolveInitialExamDate } from "../../src/lib/initial-exam-date";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const NP = "Personal Injury New Patient";
const TODAY = "2026-10-13";

test("Scheduled New Patient appointment links right away", () => {
  const r = resolveInitialExamDate("", [{ appointmentType: NP, status: "Scheduled", date: "2026-10-20" }], [], TODAY);
  assert.equal(r.source, "visit");
  assert.equal(r.date, "10/20/2026");
  assert.equal(r.visit?.status, "Scheduled");
  assert.equal(r.scheduled, null);
});
test("Reschedule / Check In / Check Out all count", () => {
  for (const status of ["Reschedule", "Check In", "Check Out"]) {
    assert.equal(resolveInitialExamDate("", [{ appointmentType: NP, status, date: "2026-10-01" }], [], TODAY).date, "10/01/2026", status);
  }
  assert.equal(resolveInitialExamDate("", [{ appointmentType: NP, status: "Check Out", date: "2026-10-01" }], [], TODAY).visit?.status, "Checked Out");
});
test("Canceled / No Show never count", () => {
  const r = resolveInitialExamDate("", [
    { appointmentType: NP, status: "Canceled", date: "2026-09-01" },
    { appointmentType: NP, status: "No Show", date: "2026-09-05" },
    { appointmentType: NP, status: "Scheduled", date: "2026-10-20" },
  ], [], TODAY);
  assert.equal(r.date, "10/20/2026");
  assert.equal(resolveInitialExamDate("", [{ appointmentType: NP, status: "Canceled", date: "2026-09-01" }], [], TODAY).source, "none");
});
test("unchanged: manual box wins; earliest wins; non-New-Patient types ignored; notes count", () => {
  const appts = [{ appointmentType: NP, status: "Scheduled", date: "2026-10-20" }, { appointmentType: NP, status: "Check In", date: "2026-10-02" }];
  assert.equal(resolveInitialExamDate("09/30/2026", appts, [], TODAY).date, "09/30/2026");
  assert.equal(resolveInitialExamDate("09/30/2026", appts, [], TODAY).differsFromVisit, true);
  assert.equal(resolveInitialExamDate("", appts, [], TODAY).date, "10/02/2026");
  assert.equal(resolveInitialExamDate("", [{ appointmentType: "Follow-Up Visit", status: "Check In", date: "2026-10-02" }], [], TODAY).source, "none");
  assert.equal(resolveInitialExamDate("", [], [{ appointmentType: NP, encounterDate: "10/05/2026" }], TODAY).visit?.status, "Encounter note");
  // Same day: a checked-out appointment beats a scheduled one and a note.
  const same = resolveInitialExamDate("", [{ appointmentType: NP, status: "Scheduled", date: "2026-10-05" }, { appointmentType: NP, status: "Check Out", date: "2026-10-05" }], [{ appointmentType: NP, encounterDate: "10/05/2026" }], TODAY);
  assert.equal(same.visit?.status, "Checked Out");
});
console.log(`${passed} passed`);

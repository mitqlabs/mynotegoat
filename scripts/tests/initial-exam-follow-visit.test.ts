/**
 * Initial Exam follows the New Patient visit while blank (never saved from a booking);
 * a hand-entered date always wins. Mock data only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInitialExamIndex, patientInitialExamInfo } from "../../src/lib/initial-exam-date";

const TODAY = "2026-10-19";
const pt = (initialExam = "") => ({ id: "p1", fullName: "Mock, Pat", matrix: { initialExam } });
const visit = (date: string, status = "Scheduled") => ({ id: "a1", patientId: "p1", patientName: "Mock, Pat", appointmentType: "Personal Injury New Patient", status, date });
const info = (p: ReturnType<typeof pt>, appts: ReturnType<typeof visit>[]) => patientInitialExamInfo(p, buildInitialExamIndex(appts as never), TODAY);

// Booked → shows the visit date; moved → follows; canceled → blank; rebooked → follows again.
assert.equal(info(pt(), [visit("2026-10-22")]).date, "10/22/2026");
assert.equal(info(pt(), [visit("2026-10-27")]).date, "10/27/2026");
assert.equal(info(pt(), [visit("2026-10-27", "Canceled")]).date, "");
assert.equal(info(pt(), [visit("2026-10-27", "Canceled"), { ...visit("2026-11-02"), id: "a2" }]).date, "11/02/2026");
// Hand-entered date wins over any visit change.
for (const v of [[visit("2026-10-22")], [visit("2026-10-30")], [visit("2026-10-22", "Canceled")], []]) assert.equal(info(pt("06/26/2026"), v).date, "06/26/2026");

// A New Patient booking never saves Initial Exam (patient list and schedule create paths).
const pts = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
const create = pts.slice(pts.indexOf("const createdPatient = createPatientRecord({"), pts.indexOf("const createdPatient = createPatientRecord({") + 1500);
assert.match(create, /initialExam: "",/);
assert.doesNotMatch(create, /initialExam: firstVisit/);

// Every reader uses the shared resolver (patient page, notes, list, G.O.A.T.).
for (const f of ["src/components/patient-case-file.tsx", "src/components/encounter-workspace.tsx", "src/lib/goat-context.ts"]) assert.match(readFileSync(f, "utf8"), /resolveInitialExamDate/, f);
assert.match(pts, /patientInitialExamInfo|initialExamOf/);
console.log("initial-exam-follow-visit ok");

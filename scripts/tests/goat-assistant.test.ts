import assert from "node:assert/strict";
import { cardDate, carryPatient, dailyBrief, firstName, normalizeCasual, nudges, splitSteps } from "../../src/lib/goat-assistant";
import type { BriefData } from "../../src/lib/goat-briefs";

// Mock data only.
const data: BriefData = {
  today: "2026-10-20",
  locations: [],
  patients: [
    { id: "P1", fullName: "Mock, John", caseStatus: "Active" },
    { id: "P2", fullName: "Sample, Ana", caseStatus: "Submitted" },
    { id: "P3", fullName: "Test, Ben", caseStatus: "Submitted" },
  ],
  appointments: [
    { id: "A1", patientId: "P1", patientName: "Mock, John", date: "2026-10-20", startTime: "09:00", status: "Scheduled", appointmentType: "Personal Injury New Patient" },
    { id: "A2", patientId: "P2", patientName: "Sample, Ana", date: "2026-10-20", startTime: "10:00", status: "Scheduled", appointmentType: "Office Visit" },
    { id: "A3", patientId: "P3", patientName: "Test, Ben", date: "2026-10-20", startTime: "11:00", status: "Canceled" },
  ],
  tasks: [
    { id: "T1", title: "Call Mock Law", done: false, dueDate: "2026-10-18" },
    { id: "T2", title: "Send report", done: false, dueDate: "2026-10-20" },
    { id: "T3", title: "Old", done: true, dueDate: "2026-10-01" },
  ],
};
assert.equal(dailyBrief(data, 9, true), "Morning! You've got 2 visits today (1 new patient), 1 to-do overdue, 1 to-do due today, and 2 cases waiting on checks.");
assert.equal(dailyBrief(data, 14, false), "Hi there! You've got 2 visits today (1 new patient), 1 to-do overdue, and 1 to-do due today.", "staff: no office money numbers");
assert.equal(dailyBrief({ ...data, appointments: [], tasks: [] }, 19, false), "Evening! You've got a clear schedule today.");

const people = [
  { id: "P1", fullName: "Mock, John", caseStatus: "Active", attorney: "Mock Law", firstVisit: "2026-10-01" },
  { id: "P4", fullName: "Rivera, Cara", caseStatus: "Active", attorney: "Self" },
  { id: "P5", fullName: "Cash, Dee", caseStatus: "Active", cash: true, firstVisit: "2026-09-01" },
  { id: "P6", fullName: "Gone, Ed", caseStatus: "Discharged" },
];
const n = nudges({ ...data, appointments: [] }, people, 5).map((x) => x.text);
assert.deepEqual(n, [
  `"Call Mock Law" is overdue.`,
  "Cara doesn't have an Initial Exam date yet.",
  "Cara's case has no attorney on file.",
  "2 active patients have nothing booked (like John).",
]);
assert.equal(nudges(data, people).length, 3, "max 3");

// Typos / slang.
assert.equal(normalizeCasual("pls book john tmrw at 2"), "please book john tomorrow at 2");
assert.equal(normalizeCasual("remind me 2 call his lawer"), "remind me to call his lawyer");
assert.equal(normalizeCasual("schedual ana wendsday 3pm"), "schedule ana wednesday 3pm");
assert.equal(normalizeCasual("can u add an apointment"), "can you add an appointment");
assert.equal(normalizeCasual("John Smith"), "John Smith", "names untouched");

// Multi-step.
assert.deepEqual(splitSteps("book John Wed 2pm and remind me to call his lawyer"), ["book John Wed 2pm", "remind me to call his lawyer"]);
assert.deepEqual(splitSteps("schedule Ana friday at 10, then tell Greg she's coming"), ["schedule Ana friday at 10", "tell Greg she's coming"]);
assert.deepEqual(splitSteps("remind me to call Mock Law and also add a note for John: called"), ["remind me to call Mock Law", "add a note for John: called"]);
assert.deepEqual(splitSteps("book John and Jane"), ["book John and Jane"], "not two actions");
assert.deepEqual(splitSteps("add a note for John: MRI done and book follow-up"), ["add a note for John: MRI done and book follow-up"], "note text stays whole");
assert.deepEqual(splitSteps("what is John's balance and book him"), ["what is John's balance and book him"], "questions aren't split");
assert.equal(carryPatient("remind me to call his lawyer", "Smith, John"), "remind me to call John Smith's lawyer");
assert.equal(carryPatient("tell Greg to call him", "Smith, John"), "tell Greg to call John Smith");
assert.equal(firstName("Smith, John A"), "John");
assert.equal(cardDate("2026-10-22"), "Thu, 10/22/2026");
console.log("goat-assistant ok");

// ── Pass 2: memory, hidden heads-ups, natural clarify ──
import { mergeDismissed, recallLine } from "../../src/lib/goat-recall";
import { clarifyIntent } from "../../src/lib/goat-schedule-query";
import { NOT_CAUGHT } from "../../src/lib/goat-memory";
{
  const now = Date.parse("2026-10-20T12:00:00Z");
  const m = mergeDismissed({ a: "2026-10-19T00:00:00Z", old: "2026-08-01T00:00:00Z" }, { b: "2026-10-20T00:00:00Z", a: "2026-10-18T00:00:00Z" }, now);
  assert.deepEqual(Object.keys(m).sort(), ["a", "b"]);
  assert.equal(m.a, "2026-10-19T00:00:00Z");
  assert.match(recallLine({ patientId: "P1", patientName: "Smith, John", action: "visit booking", at: "2026-10-19T00:00:00Z" }, now) ?? "", /John's visit booking/);
  assert.equal(recallLine({ patientId: "P1", patientName: "John Smith", action: "file", at: "2026-09-01T00:00:00Z" }, now), null);
  for (const q of ["blah blah", "what about the mri", "appointments?", "contact"]) {
    const c = clarifyIntent(q, { name: "John" });
    assert.equal(c.choices.length, 0, q);
    assert.ok(c.text.split(/[?]/).length <= 3 && c.text.length < 90, c.text);
  }
  assert.match(clarifyIntent("what about the mri", { name: "John" }).text, /John/);
  assert.ok(!/I can add notes/.test(NOT_CAUGHT));
  // No-Initial-Exam heads-up uses the real field (matrix.initialExam → firstVisit) and only active cases.
  const data = { today: "2026-10-20", appointments: [], tasks: [], patients: [] } as unknown as Parameters<typeof nudges>[0];
  const ns = nudges(data, [
    { id: "A", fullName: "Smith, John", caseStatus: "Active", attorney: "Mock Law", firstVisit: "09/05/2026" },
    { id: "B", fullName: "Kim, Cara", caseStatus: "Active", attorney: "Mock Law", firstVisit: "" },
    { id: "C", fullName: "Diaz, Dan", caseStatus: "Discharged", attorney: "Mock Law", firstVisit: "" },
  ], 5);
  const ie = ns.find((n) => n.id.startsWith("no-ie"));
  assert.equal(ie?.text, "Cara doesn't have an Initial Exam date yet.");
}
console.log("goat-assistant pass 2 ok");
assert.equal(carryPatient("call her back friday", "Rivera, Ana"), "call Ana Rivera back friday");
assert.equal(carryPatient("call her lawyer", "Rivera, Ana"), "call Ana Rivera's lawyer");
console.log("carry ok");

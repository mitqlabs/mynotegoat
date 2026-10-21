/**
 * Rule-based office answers (with follow-ups) and the confirm-first booking flow.
 * Mock data only.  Run:  npx tsx scripts/tests/goat-booking-office.test.ts
 */
import assert from "node:assert/strict";
import { answerOffice } from "../../src/lib/goat-office";
import { bookingRecord, bookingType, nearbyOpenTimes, parseBookingTime, planBooking, retime, snapToOfficeHours } from "../../src/lib/goat-booking";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";
import type { PracticeData } from "../../src/lib/goat-practice";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const MON = "2026-10-12";
const settings = { ...getDefaultScheduleSettings(), maxAppointmentsPerSlot: 1 };
const appt = (id: string, patientId: string, date: string, startTime: string, type = "Follow-Up Visit"): ScheduleAppointmentRecord => ({
  id, patientId, patientName: `Mock ${patientId}`, provider: "Dr. Mock", location: "Mock Office", appointmentType: type, caseLabel: "", room: "", date, startTime, durationMin: 15, status: "Scheduled", note: "", overrideOfficeHours: false,
});
const appts = [appt("a1", "p2", "2026-10-16", "15:00"), appt("a2", "p1", "2026-10-01", "10:00", "PI Re-Exam")];
const data: PracticeData = {
  patients: [
    { id: "p1", fullName: "Kara Testpatient", caseStatus: "Active", attorney: "Mock Law" },
    { id: "p2", fullName: "Jane Sample", caseStatus: "Submitted", attorney: "Mock Law" },
    { id: "p3", fullName: "Bob Example", caseStatus: "Active", attorney: "" },
  ],
  tasks: [{ id: "t1", title: "Call mock attorney", done: false, dueDate: "2026-10-10" } as never],
  appointments: [...appts, appt("a3", "p3", MON, "09:00"), appt("a4", "p2", "2026-10-13", "11:00")],
  contacts: [{ id: "c1", name: "Mock Imaging Center", phone: "555-0100", fax: "555-0101", email: "img@example.com" } as never],
  today: MON,
};

test("time parsing: 3, 3pm, 3:30, 330p, at 10, noon; not dates", () => {
  assert.deepEqual(parseBookingTime("book kara friday at 3"), { hh: 3, mm: 0, meridiem: null });
  assert.deepEqual(parseBookingTime("book kara 10/20 3pm"), { hh: 3, mm: 0, meridiem: "pm" });
  assert.deepEqual(parseBookingTime("book kara fri 3:30"), { hh: 3, mm: 30, meridiem: null });
  assert.deepEqual(parseBookingTime("schedule kara 330p"), { hh: 3, mm: 30, meridiem: "pm" });
  assert.deepEqual(parseBookingTime("book kara at noon"), { hh: 12, mm: 0, meridiem: "pm" });
  assert.equal(parseBookingTime("book kara 10/20"), null);
});
test("12-hour times snap into office hours (8-6)", () => {
  assert.equal(snapToOfficeHours({ hh: 3, mm: 0, meridiem: null }, settings, "2026-10-16").time, "15:00");
  assert.equal(snapToOfficeHours({ hh: 9, mm: 0, meridiem: null }, settings, "2026-10-16").time, "09:00");
  assert.equal(snapToOfficeHours({ hh: 3, mm: 7, meridiem: "pm" }, settings, "2026-10-16").time, "15:00");
});
test("type: typo-tolerant, else the patient's last type", () => {
  assert.equal(bookingType("book kara reexam friday", []).type, "PI Re-Exam");
  assert.equal(bookingType("book kara decomp friday", []).type, "Spinal Decompression - C/S");
  assert.equal(bookingType("book kara friday", [], "PI Re-Exam").type, "PI Re-Exam");
  assert.equal(bookingType("book kara friday", []).type, "Follow-Up Visit");
});
test("free slot: a draft, nothing saved", () => {
  const s = planBooking({ question: "book kara tmrw at 2", patient: { id: "p1", fullName: "Kara Testpatient" }, todayIso: MON, appointments: appts, settings });
  assert.equal(s.kind, "draft");
  if (s.kind !== "draft") return;
  assert.equal(s.draft.date, "2026-10-13");
  assert.equal(s.draft.time, "14:00");
  assert.equal(s.draft.type, "PI Re-Exam");
  assert.equal(s.draft.taken, false);
  assert.equal(appts.length, 2);
});
test("taken slot: moves to the nearest open time, other open times kept as chips", () => {
  const s = planBooking({ question: "book kara friday 3pm", patient: { id: "p1", fullName: "Kara Testpatient" }, todayIso: MON, appointments: appts, settings });
  assert.equal(s.kind, "draft");
  if (s.kind !== "draft") return;
  // Action first: 3:00 was taken, so the card shows the nearest open time (2:45) and says so.
  assert.equal(s.draft.taken, false);
  assert.equal(s.draft.time, "14:45");
  assert.ok(s.draft.notes.some((n) => /3:00 PM was taken/.test(n)), s.draft.notes.join("|"));
  assert.deepEqual(s.draft.suggestions, ["14:30", "15:00", "15:15", "15:30"]);
  assert.deepEqual(nearbyOpenTimes(appts, settings, "2026-10-16", "08:00", 15), ["08:15", "08:30"]);
});
test("missing day is asked for; missing time → first open time", () => {
  assert.equal(planBooking({ question: "book kara", patient: { id: "p1", fullName: "K" }, todayIso: MON, appointments: [], settings }).kind, "needDay");
  assert.equal(planBooking({ question: "book kara friday", patient: { id: "p1", fullName: "K" }, todayIso: MON, appointments: [], settings }).kind, "draft");
});
test("different time + override record", () => {
  const s = planBooking({ question: "book kara friday 3pm", patient: { id: "p1", fullName: "Kara Testpatient" }, todayIso: MON, appointments: appts, settings });
  if (s.kind !== "draft") throw new Error("no draft");
  const r = retime(s.draft, "4p", appts, settings)!;
  assert.equal(r.time, "16:00");
  assert.equal(r.taken, false);
  const rec = bookingRecord({ ...s.draft, override: true }, "new1", appts);
  assert.equal(rec.patientId, "p1");
  assert.equal(rec.startTime, "14:45");
  assert.equal(rec.status, "Scheduled");
  assert.equal(rec.provider, "Dr. Mock");
  const late = retime(s.draft, "7pm", appts, settings)!;
  assert.equal(late.outsideHours, true);
  assert.equal(bookingRecord({ ...late, override: true }, "x", appts).overrideOfficeHours, true);
});
test("office: to-do, cases (active + submitted), schedule any day, contacts, settings", () => {
  assert.match(answerOffice("what's on my to do list", data)!.text, /Call mock attorney/);
  const c = answerOffice("how many cases do I have", data)!;
  assert.match(c.text, /Active cases: 2\.\nSubmitted \(checks waiting\): 1\./);
  assert.match(answerOffice("how many checks are we waiting on", data)!.text, /Submitted.*1/);
  assert.match(answerOffice("who's on the schedule friday", data)!.text, /Nothing is scheduled Fri 10\/16\/2026|1 appointment/);
  assert.match(answerOffice("what's the schedule today", data)!.text, /Mock p3/);
  assert.match(answerOffice("mock imaging fax", data)!.text, /555-0101/);
  assert.ok(answerOffice("where do i change office hours", data)!.links!.length > 0);
  assert.equal(answerOffice("when was her last mri", data), null);
});
test("office follow-ups: and tomorrow? / list them / their email", () => {
  const s = answerOffice("schedule today", data)!;
  assert.match(answerOffice("and tomorrow?", data, s.memory)!.text, /Mock p2/);
  const c = answerOffice("how many submitted cases", data)!;
  assert.match(answerOffice("list them", data, c.memory)!.text, /Jane Sample/);
  const k = answerOffice("mock imaging phone", data)!;
  assert.match(answerOffice("their email?", data, k.memory)!.text, /img@example\.com/);
});
console.log(`${passed} passed`);

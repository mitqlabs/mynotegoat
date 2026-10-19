/**
 * Schedule questions in plain wording (by appointment type and time range), mock data only.
 * Run: npx tsx scripts/tests/goat-eval/schedule-questions.test.ts
 */
import assert from "node:assert/strict";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { answerOffice } from "../../../src/lib/goat-office";
import { detectNewPatientRequest } from "../../../src/lib/goat-intents";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../../src/lib/schedule-appointments";
import type { PracticeData } from "../../../src/lib/goat-practice";

const TODAY = "2026-10-19"; // Monday
const appt = (id: string, patientId: string, patientName: string, date: string, startTime: string, type: string, location = "Mock Glendale", status = "Scheduled"): ScheduleAppointmentRecord => ({
  id, patientId, patientName, provider: "Dr. Mock", location, appointmentType: type, caseLabel: "", room: "", date, startTime, durationMin: 30, status: status as ScheduleAppointmentRecord["status"], note: "", overrideOfficeHours: false,
});
const data: PracticeData = {
  today: TODAY,
  patients: [
    { id: "p-ana", fullName: "Ana Mock", caseStatus: "Active", attorney: "" },
    { id: "p-ben", fullName: "Ben Sample", caseStatus: "Active", attorney: "" },
    { id: "p-cal", fullName: "Cal Test", caseStatus: "Active", attorney: "" },
    { id: "p-dee", fullName: "Dee Example", caseStatus: "Active", attorney: "" },
  ] as PracticeData["patients"],
  tasks: [],
  contacts: [],
  appointments: [
    appt("a1", "p-ana", "Ana Mock", "2026-10-19", "09:00", "Follow-Up Visit"),
    appt("a2", "p-ben", "Ben Sample", "2026-10-20", "10:00", "New Patient", "Mock Texas"),
    appt("a3", "p-cal", "Cal Test", "2026-10-22", "14:30", "New Patient"),
    appt("a4", "p-dee", "Dee Example", "2026-10-23", "11:00", "Re-Exam"),
    appt("a5", "p-ana", "Ana Mock", "2026-10-27", "09:00", "New Patient"),
    appt("a6", "p-ana", "Ana Mock", "2026-10-28", "09:00", "New Patient"),
    appt("a7", "p-dee", "Dee Example", "2026-10-21", "09:00", "New Patient", "Mock Glendale", "Canceled"),
  ],
};
const ctx: DialogCtx = { data, team: [], openPatientId: null, settings: getDefaultScheduleSettings() };
const ask = (q: string) => answerOffice(q, data)!;
let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log(`ok - ${name}`); };

ok("typo '>' upcoming new patients", () => {
  const a = ask("do i have any upcoming new patients>");
  assert.match(a.text, /^4 new patient appointments coming up/);
  assert.match(a.text, /Tue 10\/20\/2026 10:00 AM — Ben Sample, New Patient \(Mock Texas\)/);
  assert.ok(!/Dee Example, New Patient/.test(a.text), "canceled excluded");
  const names = a.links!.filter((l) => l.href.startsWith("/patients/")).map((l) => l.label);
  assert.deepEqual(names, ["Ben Sample", "Cal Test", "Ana Mock"], "each patient linked once");
});
ok("goatTurn does not fall back to help", () => {
  const r = goatTurn("do i have any upcoming new patients>", emptyDialog(), ctx).reply;
  assert.equal(r.kind, "office");
  assert.match(r.say, /Ben Sample/);
});
ok("new patients this week", () => assert.match(ask("new patients this week?").text, /^2 new patient appointments this week/));
ok("new patients next week", () => assert.match(ask("any new pts next week").text, /^2 new patient appointments next week/));
ok("new patients tomorrow", () => assert.match(ask("new patients tomorrow").text, /^1 new patient appointment tomorrow:\n.*Ben Sample/));
ok("any re-exams friday", () => assert.match(ask("any re-exams friday").text, /Dee Example, Re-Exam/));
ok("none found", () => assert.match(ask("any discharges this week").text, /^No discharge appointments this week/));
ok("when is the next new patient", () => {
  const a = ask("when is the next new patient??");
  assert.match(a.text, /^Next new patient appointment:\n• Tue 10\/20\/2026 10:00 AM — Ben Sample/);
  assert.equal(a.text.split("\n").length, 2);
});
ok("how many appointments today (existing answer)", () => assert.match(ask("how many appointments today").text, /^1 appointment/));
ok("who's coming in tomorrow (existing answer)", () => assert.match(ask("who's coming in tomorrow").text, /Ben Sample/));
ok("intake still detected", () => {
  assert.equal(detectNewPatientRequest("new patient John Mock friday at 10"), true);
  assert.equal(detectNewPatientRequest("schedule new patient John Mock friday at 10"), true);
  assert.equal(detectNewPatientRequest("new patients this week?"), false);
  assert.equal(detectNewPatientRequest("any new patients tomorrow"), false);
});
ok("unclear message asks a short question, not the help dump", () => {
  const r = goatTurn("hmm the thing from before", emptyDialog(), ctx).reply;
  assert.ok(!/Here's what I can do/.test(r.say));
  assert.ok(r.say.length < 200, r.say);
  assert.match(r.say, /\?$/);
});
console.log(`${n} passed`);

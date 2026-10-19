/**
 * Weekday rule, full-name matching and the in-chat new patient booking (mock data only).
 * Run: npx tsx scripts/tests/goat-eval/weekday-names-newpt.test.ts
 */
import assert from "node:assert/strict";
import { resolveRequestedDay, weekdayOccurrence } from "../../../src/lib/goat-howto";
import { takeDueDate } from "../../../src/lib/goat-briefs";
import { findPatientsInQuestion, type ChatPatient } from "../../../src/lib/goat-ai/global-chat";
import { findNameAnywhere } from "../../../src/lib/goat-commands";
import { bookingType } from "../../../src/lib/goat-booking";
import { continueNewPatientBooking, startNewPatientBooking, type NewPatientCtx } from "../../../src/lib/goat-new-patient-booking";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";

let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log(`ok - ${name}`); };
const MON = "2026-10-19";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Weekday rule, from every day of one week.
const week = ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
for (const today of week) {
  for (let d = 0; d < 7; d++) {
    ok(`${today} ${DAYS[d]}`, () => {
      const ahead = (d - new Date(`${today}T12:00:00`).getDay() + 7) % 7;
      const add = (k: number) => { const x = new Date(`${today}T12:00:00`); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
      assert.equal(resolveRequestedDay(DAYS[d], today)!.iso, add(ahead));
      assert.equal(resolveRequestedDay(`this ${DAYS[d]}`, today)!.iso, add(ahead));
      assert.equal(resolveRequestedDay(`next ${DAYS[d]}`, today)!.iso, add(ahead + 7));
      assert.equal(takeDueDate(`call atty next ${DAYS[d]}`, today).due, add(ahead + 7));
      assert.equal(takeDueDate(`call atty ${DAYS[d]}`, today).due, add(ahead));
    });
  }
}
ok("examples from Mon 10/19/2026", () => {
  assert.equal(resolveRequestedDay("wednesday", MON)!.iso, "2026-10-21");
  assert.equal(resolveRequestedDay("this wednesday", MON)!.iso, "2026-10-21");
  assert.equal(resolveRequestedDay("next wednesday", MON)!.iso, "2026-10-28");
  assert.equal(resolveRequestedDay("this monday", MON)!.iso, "2026-10-19");
  assert.equal(resolveRequestedDay("next monday", MON)!.iso, "2026-10-26");
  assert.equal(resolveRequestedDay("next thursday", MON)!.iso, "2026-10-29");
  assert.equal(weekdayOccurrence(MON, 3, false), "2026-10-21");
});

// Names: a mock John Margaryan, no John Smith.
const P = (id: string, fullName: string): ChatPatient => ({ id, fullName, caseStatus: "Active" } as ChatPatient);
const pts = [P("p1", "Margaryan, John"), P("p2", "Smyth, Kara"), P("p3", "Miller, John"), P("p4", "Miller, Johnny"), P("p5", "Sample, Jane")];
ok("john smith never matches John Margaryan", () => {
  const f = findPatientsInQuestion("Schedule john smith next thursday for initial appointment", pts);
  assert.equal(f.confident, null);
  assert.equal(f.candidates.length, 0);
  assert.equal(f.named, "John Smith");
  assert.equal(findNameAnywhere("Schedule john smith next thursday for initial appointment", pts), null);
});
ok("small typo on the same last name still matches", () => {
  assert.equal(findPatientsInQuestion("book john margaryn friday at 10", pts).confident?.patient.id, "p1");
});
ok("several with the same full name → ask which", () => {
  const two = [...pts, P("p6", "Margaryan, John")];
  const f = findPatientsInQuestion("book john margaryan friday", two);
  assert.equal(f.confident, null);
  assert.equal(f.candidates.length, 2);
});
ok("first name alone still works", () => assert.equal(findPatientsInQuestion("when is jane's next visit", pts).confident?.patient.id, "p5"));
ok("first name + verb is not a surname", () => assert.equal(findPatientsInQuestion("jane called about her bill", pts).confident?.patient.id, "p5"));

ok("New Patient type words", () => {
  const types = ["Personal Injury Office Visit", "Personal Injury New Patient", "PI Re-Exam", "Follow-Up Visit"];
  for (const w of ["initial appointment", "initial", "new appt", "first visit", "NP", "eval", "new patient"]) assert.equal(bookingType(`book john ${w} friday`, types).type, "Personal Injury New Patient", w);
});

// In-chat new patient flow.
const settings = getDefaultScheduleSettings();
const ctx: NewPatientCtx = { todayIso: MON, settings, appointments: [], types: [{ name: "Personal Injury New Patient", durationMin: 60 }, { name: "Follow-Up Visit", durationMin: 15 }], provider: "Dr. Mock", location: "Mock Glendale" };
ok("asks phone, then time, then one card", () => {
  const s1 = startNewPatientBooking("John Smith", "Schedule john smith next thursday for initial appointment", ctx);
  assert.equal(s1.kind, "ask");
  if (s1.kind !== "ask") return;
  assert.equal(s1.field, "phone");
  assert.equal(s1.pending.date, "2026-10-29");
  assert.equal(continueNewPatientBooking(s1.pending, "phone", "dunno", ctx), null);
  const s2 = continueNewPatientBooking(s1.pending, "phone", "818 555 0100", ctx)!;
  assert.equal(s2.kind, "ask");
  if (s2.kind !== "ask") return;
  assert.equal(s2.field, "time");
  const s3 = continueNewPatientBooking(s2.pending, "time", "10am", ctx)!;
  assert.equal(s3.kind, "card");
  if (s3.kind !== "card") return;
  assert.equal(s3.card.phone, "818-555-0100");
  assert.equal(s3.card.draft.date, "2026-10-29");
  assert.equal(s3.card.draft.time, "10:00");
  assert.equal(s3.card.draft.type, "Personal Injury New Patient");
  assert.equal(s3.card.provider, "Dr. Mock");
  assert.match(s3.say, /10\/29\/2026/);
});
ok("everything given → straight to the card", () => {
  const s = startNewPatientBooking("John Smith", "book john smith 818-555-0100 wednesday at 2pm new patient", ctx);
  assert.equal(s.kind, "card");
  if (s.kind === "card") { assert.equal(s.card.draft.date, "2026-10-21"); assert.equal(s.card.draft.time, "14:00"); }
});
ok("conflict is flagged on the card", () => {
  const busy = { ...ctx, appointments: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, patientId: `q${i}`, patientName: "Mock", provider: "", location: "", appointmentType: "Follow-Up Visit", caseLabel: "", room: "", date: "2026-10-21", startTime: "14:00", durationMin: 60, status: "Scheduled", note: "", overrideOfficeHours: false })) } as NewPatientCtx;
  const s = startNewPatientBooking("John Smith", "book john smith 818-555-0100 wednesday at 2pm", busy);
  assert.equal(s.kind, "card");
  if (s.kind === "card") assert.ok(s.card.draft.taken || s.card.draft.outsideHours);
});
console.log(`${n} passed`);

// "+ Case" Appt Date + Time.
import { planCaseFirstVisit } from "../../../src/lib/new-patient-intake";
{
  const types = [{ name: "Follow-Up Visit", durationMin: 15 }, { name: "Personal Injury New Patient", durationMin: 60 }];
  const s = getDefaultScheduleSettings();
  ok("+ Case: blank date books nothing", () => assert.equal(planCaseFirstVisit({ dateMdy: "", timeText: "10am", patientId: "p1" }, [], s, types).kind, "none"));
  ok("+ Case: date + time → New Patient visit", () => {
    const p = planCaseFirstVisit({ dateMdy: "10/22/2026", timeText: "10:00 AM", patientId: "p1" }, [], s, types);
    assert.equal(p.kind, "book");
    if (p.kind === "book") { assert.equal(p.date, "2026-10-22"); assert.equal(p.time, "10:00"); assert.equal(p.type, "Personal Injury New Patient"); }
  });
  ok("+ Case: missing time warns", () => assert.equal(planCaseFirstVisit({ dateMdy: "10/22/2026", timeText: "", patientId: "p1" }, [], s, types).kind, "error"));
  ok("+ Case: saved twice → no duplicate", () => {
    const existing = [{ id: "a1", patientId: "p1", patientName: "Mock", provider: "", location: "", appointmentType: "Personal Injury New Patient", caseLabel: "", room: "", date: "2026-10-22", startTime: "10:00", durationMin: 60, status: "Scheduled", note: "", overrideOfficeHours: false }] as never;
    assert.equal(planCaseFirstVisit({ dateMdy: "10/22/2026", timeText: "10am", patientId: "p1" }, existing, s, types).kind, "exists");
  });
  console.log(`${n} passed (with + Case)`);
}

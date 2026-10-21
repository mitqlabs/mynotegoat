/**
 * G.O.A.T. learning list (merge-safe, no names) + quick schedule/case cards (mock data only).
 * Run: npx tsx scripts/tests/goat-learned-quick.test.ts
 */
import assert from "node:assert/strict";
import { emptyLearned, learnedMap, mergeLearned, safeTemplate, withMiss, withPhrase, withoutEntry } from "../../src/lib/goat-learned";
import { phraseTemplate, understand, type UContext } from "../../src/lib/goat-understand";
import { planQuick } from "../../src/lib/goat-quick";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const ctx: UContext = { today: "2026-10-20", patients: [{ id: "P1", fullName: "Smith, John" }, { id: "P2", fullName: "Rivera, Ana" }], lastPatientId: null };

// Templates hold no names, dates or times.
const tpl = phraseTemplate("Squeeze John Smith in friday at 2", ctx.patients, ctx.today);
assert.equal(tpl, "squeeze {patient} in {date} {time}");
assert.ok(safeTemplate(tpl));
assert.ok(!safeTemplate("call John 555"));
assert.ok(!/ana|rivera/.test(phraseTemplate("can ana squeeze in", ctx.patients, ctx.today)));

// Learned → used first next time (same wording, another patient).
let l = withPhrase(emptyLearned(), "squeeze {patient} in {date} {time}", "book", "2026-10-20T10:00:00Z");
assert.equal(understand("squeeze ana rivera in monday at 4", { ...ctx, learned: learnedMap(l) })?.action, "book");
l = withPhrase(l, "squeeze {patient} in {date} {time}", "book", "2026-10-20T10:05:00Z");
assert.equal(l.phrases[0].count, 2);

// Merge-safe: two computers' copies keep both; a delete (tombstone) wins over an older copy.
const a = withPhrase(emptyLearned(), "x {patient}", "open", "2026-10-20T10:00:00Z");
const b = withMiss(withPhrase(emptyLearned(), "y {patient}", "cancel", "2026-10-20T10:01:00Z"), "z", "reply", "2026-10-20T10:02:00Z");
const m = mergeLearned(a, b);
assert.equal(m.phrases.length, 2);
assert.equal(m.misses.length, 1);
const del = withoutEntry(m, "phrase", "x {patient}", "2026-10-20T11:00:00Z");
assert.equal(learnedMap(mergeLearned(a, del))["x {patient}"], undefined, "delete survives an older copy");

// Quick cards
const settings = getDefaultScheduleSettings();
const ap = (id: string, date: string, time: string, status = "Scheduled", pid = "P1") => ({ id, patientId: pid, patientName: "Smith, John", provider: "Dr. Mock", location: "Main", appointmentType: "Follow-Up Visit", caseLabel: "", room: "", date, startTime: time, durationMin: 15, status, note: "", overrideOfficeHours: false }) as ScheduleAppointmentRecord;
const appts = [ap("a1", "2026-10-20", "10:00"), ap("a2", "2026-10-22", "14:00"), ap("b1", "2026-10-23", "10:00", "Scheduled", "P2")];
const q = (text: string) => planQuick(understand(text, ctx)!, { today: ctx.today, appointments: appts, settings, currentDoi: "2026-09-01" });
const r1 = q("check in john smith");
assert.ok("summary" in r1 && r1.appointmentId === "a1" && /Check in John Smith \(10:00 AM/.test(r1.summary), JSON.stringify(r1));
const r2 = q("cancel smith thursday");
assert.ok("summary" in r2 && r2.appointmentId === "a2" && /Cancel John Smith's Follow-Up Visit on Thu/.test(r2.summary), JSON.stringify(r2));
const r3 = q("move jon smiths appt to friday 10am");
assert.ok("summary" in r3 && r3.appointmentId === "a1", JSON.stringify(r3));
assert.ok("time" in r3 && r3.date === "2026-10-23" && r3.time === "10:00" && /from Tue 10\/20\/2026 at 10:00 AM to Fri 10\/23\/2026 at 10:00 AM/.test(r3.summary), JSON.stringify(r3));
const r3b = q("move smith from thursday to friday at 3");
assert.ok("date" in r3b && r3b.appointmentId === "a2" && r3b.date === "2026-10-23" && r3b.time === "15:00", JSON.stringify(r3b));
const r4 = q("set john smith doi to 8/30/2026");
assert.ok("doi" in r4 && r4.doi === "2026-08-30" && /\(was 09\/01\/2026\)/.test(r4.summary));
const r5 = q("ana rivera arrived");
assert.ok("say" in r5 && /Ana has no visit today/.test(r5.say));
console.log("goat-learned-quick ok");

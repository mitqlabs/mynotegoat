/**
 * Closed key dates: still schedule, mark Canceled, and say so.
 * Run: npx tsx scripts/tests/closed-date-booking.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closedDateHit, closedDateNote, closedDateNotice } from "../../src/lib/closed-date-booking";
import { bookingRecord, draftSummary } from "../../src/lib/goat-booking";
import type { KeyDateRecord } from "../../src/lib/key-dates";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const row = (over: Partial<KeyDateRecord> = {}): KeyDateRecord => ({
  id: "kd-sick",
  startDate: "2026-11-12",
  endDate: "2026-11-12",
  officeStatus: "Closed",
  reason: "Sick day",
  ...over,
});

assert.equal(closedDateHit([row()], "2026-11-12")?.reason, "Sick day");
assert.equal(closedDateHit([row({ officeStatus: "Covered" })], "2026-11-12"), null);
assert.equal(closedDateHit([row({ openEnd: "14:00" })], "2026-11-12"), null, "partial day stays bookable");
assert.equal(closedDateHit([row()], "2026-11-13"), null);

assert.equal(closedDateNote("Sick day", "Bring MRI"), "Closed: Sick day — Bring MRI");
assert.equal(closedDateNote("", ""), "Closed");
assert.equal(closedDateNote("Sick day", "Closed: Sick day — Bring MRI"), "Closed: Sick day — Bring MRI");

const one = closedDateNotice([{ dateIso: "2026-11-12", reason: "Sick day" }]);
assert.match(one, /11\/12\/2026 \(Sick day\) is a closed day/);
assert.match(one, /still scheduled and marked Canceled/);
const many = closedDateNotice([
  { dateIso: "2026-11-12", reason: "Sick day" },
  { dateIso: "2026-11-13", reason: "" },
]);
assert.match(many, /11\/12\/2026 \(Sick day\)/);
assert.match(many, /11\/13\/2026/);
assert.match(many, /Those appointments were still scheduled/);

const draft = {
  patientId: "p1",
  patientName: "Haddad, Layla",
  date: "2026-11-12",
  time: "11:30",
  type: "New Patient",
  durationMin: 30,
  notes: [],
  taken: false,
  outsideHours: false,
  suggestions: [],
  closedReason: "Sick day",
};
const saved = bookingRecord(draft, "appt-1", [] as ScheduleAppointmentRecord[]);
assert.equal(saved.status, "Canceled");
assert.match(saved.note, /Closed: Sick day/);
assert.match(draftSummary(draft), /marks it Canceled/);
assert.equal(bookingRecord({ ...draft, closedReason: undefined }, "appt-2", []).status, "Scheduled");

for (const file of [
  "src/components/new-appointment-modal.tsx",
  "src/app/(portal)/appointments/page.tsx",
  "src/components/reschedule-appointment-modal.tsx",
  "src/components/edit-appointment-modal.tsx",
]) {
  const src = readFileSync(file, "utf8");
  assert.match(src, /closedDateNotice/);
  assert.doesNotMatch(src, /Cannot schedule on CLOSED|Cannot reschedule onto CLOSED|Cannot move onto CLOSED|will be skipped/);
}

console.log("closed-date-booking ok");

/**
 * Key Dates table + Warning List stay clean (mock data only):
 * a red "N still booked" count only on upcoming Closed days, "—" everywhere
 * else, mm/dd/yy dates, and no stale filter on a past date.
 * Run: npx tsx scripts/tests/key-dates-clean.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatKeyDateRangeShort,
  formatShortDateFromIso,
  formatKeyDateAppointmentCount,
  isStillBookedStatus,
  keyDateAppointmentCounts,
  todayIsoLocal,
  upcomingClosedBookings,
  type KeyDateRecord,
} from "../../src/lib/key-dates";
import { closedDates } from "../../src/lib/reminder-server";
import { withoutClosedDates } from "../../src/lib/reminder-automation";
import { keyDatesHelp } from "../../src/lib/goat-keydates-help";

const TODAY = "2026-10-28";
const kd = (over: Partial<KeyDateRecord>): KeyDateRecord => ({
  id: "KD-1",
  startDate: "2026-10-29",
  endDate: "2026-10-29",
  officeStatus: "Closed",
  reason: "Texas",
  ...over,
});

// ── "still booked" = Scheduled / Reschedule only ──
assert.equal(isStillBookedStatus("Scheduled"), true);
assert.equal(isStillBookedStatus("Reschedule"), true);
assert.equal(isStillBookedStatus(undefined), true);
for (const s of ["Canceled", "No Show", "Check In", "Check Out"]) assert.equal(isStillBookedStatus(s), false, s);

// ── dates are mm/dd/yy ──
assert.equal(formatShortDateFromIso("2026-10-29"), "10/29/26");
assert.equal(formatKeyDateRangeShort({ startDate: "2026-12-24", endDate: "2027-01-03" }), "12/24/26 - 01/03/27");
assert.equal(formatKeyDateRangeShort({ startDate: "2025-10-13", endDate: "2025-10-13" }), "10/13/25");
assert.match(todayIsoLocal(new Date(2026, 9, 28)), /^2026-10-28$/);

const appts = [
  { id: "a1", date: "2026-10-29", status: "Scheduled" },
  { id: "a2", date: "2026-10-29", status: "Reschedule" },
  { id: "a3", date: "2026-10-29", status: "Canceled" },
  { id: "a4", date: "2026-10-29", status: "No Show" },
  { id: "a5", date: "2026-10-29", status: "Check Out" },
  { id: "a6", date: "2026-10-29", status: "Check In" },
  { id: "p1", date: "2025-10-15", status: "Scheduled" }, // old
  { id: "p2", date: "2024-11-07", status: "Scheduled" }, // old
  { id: "o1", date: "2026-11-02", status: "Scheduled" }, // Open day
  { id: "c1", date: "2026-11-05", status: "Scheduled" }, // Covered day
  { id: "r1", date: "2026-10-28", status: "Scheduled" }, // today, in a range
  { id: "r2", date: "2026-10-27", status: "Scheduled" }, // yesterday, same range
];
const rows: KeyDateRecord[] = [
  kd({}), // KD-1: closed 10/29 with 2 still booked
  kd({ id: "PAST-COVERED", startDate: "2025-10-13", endDate: "2025-10-19", officeStatus: "Covered" }),
  kd({ id: "PAST-CLOSED", startDate: "2024-11-07", endDate: "2024-11-07" }), // old Closed with a leftover visit
  kd({ id: "PAST-CLOSED-2", startDate: "2025-10-15", endDate: "2025-10-15" }),
  kd({ id: "OPEN", startDate: "2026-11-02", endDate: "2026-11-02", officeStatus: "Open" }),
  kd({ id: "COVERED", startDate: "2026-11-05", endDate: "2026-11-05", officeStatus: "Covered" }),
  kd({ id: "EMPTY-CLOSED", startDate: "2026-12-25", endDate: "2026-12-25" }),
  kd({ id: "RANGE", startDate: "2026-10-27", endDate: "2026-10-28" }), // started yesterday, ends today
];
const cleared = new Set(["a1"]);
const m = upcomingClosedBookings(rows, appts, TODAY, cleared);
assert.deepEqual(m.get("KD-1"), { count: 2, cleared: 1 }, "Scheduled + Reschedule only; canceled / no-show / seen excluded");
assert.deepEqual(m.get("RANGE"), { count: 1, cleared: 0 }, "a range that includes today counts today's visit but not yesterday's");
for (const id of ["PAST-COVERED", "PAST-CLOSED", "PAST-CLOSED-2", "OPEN", "COVERED", "EMPTY-CLOSED"]) {
  assert.equal(m.has(id), false, `${id} has no count (shows —)`);
}
assert.equal(m.size, 2);
// Past dates never get a count, even when today moves past them.
assert.equal(upcomingClosedBookings(rows, appts, "2026-10-30").has("KD-1"), false, "once the day has passed there is no count");

// Partial day: only visits outside the open hours count.
const half = kd({ id: "HALF", openStart: "08:00", openEnd: "14:00" });
const halfAppts = [
  { id: "h1", date: "2026-10-29", startTime: "10:00", status: "Scheduled" },
  { id: "h2", date: "2026-10-29", startTime: "15:30", status: "Scheduled" },
];
assert.equal(upcomingClosedBookings([half], halfAppts, TODAY).get("HALF")?.count, 1);

// ── safety from PR #148 is untouched: Closed blocks reminders ──
assert.deepEqual([...closedDates([kd({})])], ["2026-10-29"]);
assert.deepEqual(withoutClosedDates([{ visitDate: "2026-10-29" }, { visitDate: "2026-10-30" }], closedDates([kd({})])), [{ visitDate: "2026-10-30" }]);

// ── EVERY key date row shows a clickable appointment count (all statuses) ──
const counts = keyDateAppointmentCounts(rows, appts);
assert.deepEqual(counts.get("KD-1"), { total: 6, canceled: 1 }, "all statuses on the day, canceled noted");
assert.deepEqual(counts.get("PAST-CLOSED"), { total: 1, canceled: 0 }, "past dates keep their count");
assert.deepEqual(counts.get("PAST-CLOSED-2"), { total: 1, canceled: 0 });
assert.deepEqual(counts.get("OPEN"), { total: 1, canceled: 0 }, "Open days show their appointments");
assert.deepEqual(counts.get("COVERED"), { total: 1, canceled: 0 }, "Covered days show their appointments");
assert.deepEqual(counts.get("RANGE"), { total: 2, canceled: 0 }, "a range counts every day in it");
assert.equal(counts.has("EMPTY-CLOSED"), false, "a date with truly 0 appointments is absent → shows —");
assert.equal(formatKeyDateAppointmentCount({ total: 28, canceled: 0 }), "28 appointments");
assert.equal(formatKeyDateAppointmentCount({ total: 1, canceled: 0 }), "1 appointment");
assert.equal(formatKeyDateAppointmentCount({ total: 18, canceled: 10 }), "18 appointments · 10 canceled");
// The warning count is still a separate, narrower thing.
assert.equal(m.get("KD-1")?.count, 2);

// ── the page wires it up ──
assert.ok(readFileSync("src/app/(portal)/key-dates/page.tsx", "utf8").includes("keyDateAppointmentCounts(keyDates, scheduleAppointments)"));
const page = readFileSync("src/app/(portal)/key-dates/page.tsx", "utf8");
assert.ok(page.includes("upcomingClosedBookings(keyDates, scheduleAppointments, todayIso, dismissals)"));
assert.ok(page.includes("still booked"));
assert.ok(!/cleared<\/span>|\{cleared\} cleared/.test(page), "no 'N cleared' counts in the main table");
assert.ok(!page.includes("· closed"), "no '1 appointment · closed' pill");
assert.ok(page.includes("Canceled") && page.includes("Showing {formatKeyDateRangeShort(focusedKeyDate)}"), "full per-date list with Canceled tag and the Showing bar");
assert.ok(!page.includes("Hide ${"), "no 'Hide N cleared warnings' row");
assert.ok(page.includes("Show past &amp; cleared") || page.includes("Show past & cleared"), "history is behind a small link");
// Past rows can't be clicked, and a stale filter is dropped automatically.
assert.ok(page.includes("appointmentCountByKeyDateId.has(focus.id)") && page.includes("bookingsByKeyDateId.has(focus.id)"), "a stale filter is dropped");
assert.ok(page.includes("Showing {formatKeyDateRangeShort(focusedKeyDate)}") && page.includes("Show all"));
assert.ok(!/formatUsDateFromIso\(row\.appointment\.date\)/.test(page), "warning dates are mm/dd/yy");

// ── Handbook + G.O.A.T. use the same words ──
const handbook = readFileSync("src/lib/handbook-content.ts", "utf8");
assert.ok(handbook.includes("still booked") && handbook.includes("Show past & cleared") && handbook.includes("28 appointments"));
const help = keyDatesHelp("what does closed do on key dates");
assert.ok(help && /still booked/.test(help.text) && /Show past & cleared/.test(help.text) && /appointments/.test(help.text));
assert.ok(!/how many you've cleared/.test(help!.text));

console.log("key-dates-clean: OK");

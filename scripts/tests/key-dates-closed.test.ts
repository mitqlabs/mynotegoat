/**
 * Key Dates: a Closed date blocks reminders on every path, and the Key Dates
 * table shows the real number of booked visits (mock data only).
 * Run: npx tsx scripts/tests/key-dates-closed.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planCatchUp,
  planReminderRun,
  planScheduledRun,
  withoutClosedDates,
} from "../../src/lib/reminder-automation";
import { defaultSmsReminderSettings } from "../../src/lib/sms-reminders";
import { closedDates, hoursByDateFromKeyDates } from "../../src/lib/reminder-server";
import {
  dismissalsToResetForClosure,
  summarizeKeyDateBookings,
  type KeyDateRecord,
} from "../../src/lib/key-dates";
import { broadcastTimeOk, normalizeHHMM } from "../../src/lib/reminder-automation";
import { loadBroadcastQueue } from "../../src/lib/reminder-server";
import { keyDatesHelp } from "../../src/lib/goat-keydates-help";

const hours = (open: number[]) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, enabled: open.includes(d) }));
const officeHours = hours([1, 3, 4]); // Mon/Wed/Thu → runs Sun/Tue/Wed
const s = { ...defaultSmsReminderSettings(), enabled: true, optOutLine: false, dryRun: false };

const kd = (over: Partial<KeyDateRecord>): KeyDateRecord => ({
  id: "KD-1",
  startDate: "2026-10-29",
  endDate: "2026-10-29",
  officeStatus: "Closed",
  reason: "Texas",
  ...over,
});

// ── closedDates: reason is only a label ──
assert.deepEqual([...closedDates([kd({})])], ["2026-10-29"], "Closed + reason 'Texas' closes the date");
assert.deepEqual([...closedDates([kd({ reason: "" })])], ["2026-10-29"]);
assert.deepEqual([...closedDates([kd({ officeStatus: "Covered" })])], [], "Covered stays bookable and gets reminders");
assert.deepEqual([...closedDates([kd({ officeStatus: "Open" })])], []);
assert.deepEqual([...closedDates([kd({ openEnd: "14:00" })])], [], "Closed WITH hours is a partial day");
assert.ok(hoursByDateFromKeyDates([kd({ openEnd: "14:00" })]).has("2026-10-29"));
// Range: every day in it is closed, the day after is not.
const range = closedDates([kd({ startDate: "2026-12-24", endDate: "2027-01-03", reason: "Christmas/New Year" })]);
assert.equal(range.size, 11);
assert.ok(range.has("2026-12-24") && range.has("2026-12-31") && range.has("2027-01-03"));
assert.ok(!range.has("2026-12-23") && !range.has("2027-01-04"));
// A row with no status field counts as Closed (same as normalizeKeyDates).
assert.ok(closedDates([{ startDate: "2026-10-29", endDate: "2026-10-29" }]).has("2026-10-29"));
// Several rows, only the Closed one counts.
const mixed = closedDates([
  kd({ id: "a", officeStatus: "Covered", startDate: "2026-08-08", endDate: "2026-08-30", reason: "Armenia" }),
  kd({ id: "b" }),
  kd({ id: "c", officeStatus: "Open", startDate: "2026-11-11", endDate: "2026-11-11" }),
]);
assert.deepEqual([...mixed], ["2026-10-29"]);

// ── Every path blocks tomorrow when it is Closed (incident: Wed 10/28 9:05 AM PT → Thu 10/29) ──
const wed905 = new Date("2026-10-28T16:05:00Z");
const closed = closedDates([kd({})]);
const covered = closedDates([kd({ officeStatus: "Covered" })]);

// Scheduled
let plan = planScheduledRun({ now: wed905, settings: s, officeHours, closedIsoDates: closed });
assert.ok(!plan.dates.some((d) => d.visitDate === "2026-10-29"), "scheduled run skips the closed date");
assert.match(plan.reason, /closed tomorrow/i);
plan = planScheduledRun({ now: wed905, settings: s, officeHours, closedIsoDates: covered });
assert.ok(plan.dates.some((d) => d.visitDate === "2026-10-29" && d.mode === "tomorrow"), "Covered still gets reminders");
// Send Now / catch-up (force)
plan = planCatchUp({ now: wed905, settings: s, officeHours, closedIsoDates: closed });
assert.ok(!plan.dates.some((d) => d.visitDate === "2026-10-29"), "catch-up skips the closed date");
// Even off a run day, Send Now never sends for a closed date
const tue = new Date("2026-10-27T16:05:00Z");
plan = planCatchUp({ now: tue, settings: s, officeHours, closedIsoDates: new Set(["2026-10-28"]) });
assert.ok(!plan.dates.some((d) => d.visitDate === "2026-10-28" && d.mode === "tomorrow"));
// Today closed → no same-day catch-up either
plan = planCatchUp({ now: new Date("2026-10-29T17:00:00Z"), settings: s, officeHours, closedIsoDates: closed });
assert.ok(!plan.dates.some((d) => d.visitDate === "2026-10-29"), "closed today → no same-day texts");
// Preview / single-day planner
for (const force of [false, true]) {
  const p = planReminderRun({ now: wed905, settings: s, officeHours, closedIsoDates: closed, force });
  assert.equal(p.run, false);
}
// Range closure blocks the first day after the weekend run etc.
plan = planScheduledRun({ now: new Date("2026-12-23T17:00:00Z"), settings: s, officeHours, closedIsoDates: range });
assert.ok(!plan.dates.some((d) => d.visitDate === "2026-12-24"), "range closure blocks its first day");

// Route-level backstop
const groups = [{ visitDate: "2026-10-28" }, { visitDate: "2026-10-29" }];
assert.deepEqual(withoutClosedDates(groups, closed), [{ visitDate: "2026-10-28" }]);
assert.deepEqual(withoutClosedDates(groups, new Set()), groups);

// ── Appointments column: real counts ──
const appts = [
  { id: "a1", date: "2026-10-29", status: "Scheduled" },
  { id: "a2", date: "2026-10-29", status: "Scheduled" },
  { id: "a3", date: "2026-10-29", status: "Canceled" },
  { id: "a4", date: "2026-10-29", status: "No Show" },
  { id: "a5", date: "2026-10-30", status: "Scheduled" },
  { id: "a6", date: "2026-12-30", status: "Scheduled" },
  { id: "a7", date: "2027-01-03", status: "Reschedule" },
];
const rows = [kd({}), kd({ id: "KD-2", startDate: "2026-12-24", endDate: "2027-01-03" }), kd({ id: "KD-3", startDate: "2026-11-26", endDate: "2026-11-26" })];
// Every 10/29 visit was "Cleared" earlier: the old column read None.
const cleared = new Set(["a1", "a2"]);
const sum = summarizeKeyDateBookings(rows, appts, cleared);
assert.deepEqual(sum.get("KD-1"), { booked: 2, cleared: 2 }, "cleared visits still count; canceled / no-show do not");
assert.deepEqual(sum.get("KD-2"), { booked: 2, cleared: 0 }, "a range counts every day in it");
assert.deepEqual(sum.get("KD-3"), { booked: 0, cleared: 0 });
assert.deepEqual(summarizeKeyDateBookings(rows, appts).get("KD-1"), { booked: 2, cleared: 0 });

// Switching Covered → Closed forgets old Clears on upcoming visits only
assert.deepEqual(dismissalsToResetForClosure(kd({}), appts, cleared, "2026-10-28").sort(), ["a1", "a2"]);
assert.deepEqual(dismissalsToResetForClosure(kd({}), appts, cleared, "2026-10-30"), [], "past visits are left alone");
assert.deepEqual(dismissalsToResetForClosure(kd({ officeStatus: "Covered" }), appts, cleared, "2026-10-28"), []);
assert.deepEqual(dismissalsToResetForClosure(kd({ openEnd: "14:00" }), appts, cleared, "2026-10-28"), [], "partial day keeps its clears");

// ── G.O.A.T. + Handbook ──
const help = keyDatesHelp("I marked the 29th closed but they still got reminder texts");
assert.ok(help);
assert.match(help!.text, /Closed:[^\n]*NO text reminders/);
assert.match(help!.text, /Covered:[^\n]*STILL go out/);
assert.match(help!.text, /reason is only a label/i);
assert.ok(keyDatesHelp("what does covered mean on key dates"));
assert.equal(keyDatesHelp("/note something about key dates"), null);
assert.equal(keyDatesHelp("text everyone we're closed Thursday"), null, "a command is never intercepted");
assert.equal(keyDatesHelp("tell patients we are closed on the 29th, no reminders"), null);
assert.equal(keyDatesHelp("how many visits tomorrow"), null);
const handbook = readFileSync("src/lib/handbook-content.ts", "utf8");
assert.ok(handbook.includes("Covered = someone covers"), "Handbook explains Closed vs Covered");
assert.ok(handbook.includes("the Appointments column shows how many visits are really booked"));

// The page wires the real count, the closed-with-bookings alert and the form notice.
const page = readFileSync("src/app/(portal)/key-dates/page.tsx", "utf8");
assert.ok(page.includes("summarizeKeyDateBookings(keyDates, scheduleAppointments, dismissals)"));
assert.ok(page.includes("Closed days that still have patients booked"));
assert.ok(page.includes("dismissalsToResetForClosure"));
const route = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
assert.ok(route.includes("withoutClosedDates(groups, config.closedIsoDates)"), "queue route backstop");

// ── Broadcasts are never blocked by Key Dates, and time-less recipients are never "already passed" ──
assert.equal(normalizeHHMM(""), "");
assert.equal(normalizeHHMM("  "), "");
assert.equal(normalizeHHMM("9:05"), "09:05");
assert.equal(broadcastTimeOk("", { notBefore: "10:12" }), true, "all-active recipient (no visit time) on today's broadcast");
assert.equal(broadcastTimeOk("", { startTime: "14:00" }), false, "a chosen window still needs a visit time");
assert.equal(broadcastTimeOk("09:00", { notBefore: "10:12" }), false, "a visit that already passed is skipped");
assert.equal(broadcastTimeOk("11:00", { notBefore: "10:12" }), true);

const bc = { message: "Mock office message", target_date: "2026-10-28", created_at: "2026-10-28T17:12:06Z", canceled_at: null, start_time: null, end_time: null };
const recips = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, patient_id: `p${i}`, appointment_id: null, claimed_by: null, claimed_until: null, reminder_broadcasts: bc }));
const pats = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, phone: `(555) 010-${String(1000 + i)}`, text_reminders_off: false }));
const fakeAdmin = {
  from: (table: string) => {
    const b: Record<string, unknown> = {
      then: (res: (v: unknown) => void) =>
        res({ data: table === "patients" ? pats : table === "reminder_broadcast_recipients" ? recips : [], error: null }),
    };
    for (const m of ["select", "eq", "gte", "is", "order", "limit", "in", "neq"]) b[m] = () => b;
    return b;
  },
};
(async () => {
  // Closed tomorrow must not matter here: the broadcast queue has no key-date input at all.
  const queued = await loadBroadcastQueue(
    fakeAdmin as never,
    { id: "d", workspace_id: "w" } as never,
    "2026-10-28",
    new Date("2026-10-28T17:12:31Z"),
    "10:12",
    { optOutLine: false },
  );
  assert.equal(queued.length, 30, "all 30 all-active recipients are handed to the device mid-morning");
  assert.ok(queued.every((q) => q.phone.startsWith("+1") && q.text === "Mock office message"));
  const routeSrc = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
  assert.ok(
    routeSrc.indexOf("withoutClosedDates(groups") < routeSrc.indexOf("loadBroadcastQueue(admin"),
    "closed-date filtering applies to reminder groups only; broadcasts load separately",
  );
  const composer = readFileSync("src/components/message-patients-composer.tsx", "utf8");
  assert.ok(!/primaryBtn =[^;]*bg-white/.test(composer), "primary button must not also set bg-white (invisible white-on-white)");
  console.log("key-dates-closed: OK");
})();

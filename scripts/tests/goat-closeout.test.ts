/**
 * End-of-day closeout. Run: npx tsx scripts/tests/goat-closeout.test.ts
 */
import assert from "node:assert/strict";
import { buildCloseout } from "../../src/lib/goat-closeout";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";

const settings = { ...getDefaultScheduleSettings(), maxAppointmentsPerSlot: 1 };
const model = buildCloseout({
  todayIso: "2026-11-09", // Monday
  settings,
  appointments: [
    { id: "in", patientId: "p1", patientName: "Nguyen, Ethan", date: "2026-11-09", startTime: "09:00", status: "Check In" },
    { id: "out", patientId: "p2", patientName: "Haddad, Layla", date: "2026-11-09", startTime: "10:00", status: "Check Out" },
    { id: "tmw", patientId: "p3", patientName: "Brooks, Marcus", date: "2026-11-10", startTime: "09:00", status: "Scheduled" },
  ],
  notes: [
    { id: "n1", patientId: "p2", patientName: "Haddad, Layla", encounterDate: "11/09/2026", signed: false, appointmentId: "out" },
    { id: "n2", patientId: "p9", patientName: "Old, Note", encounterDate: "2026-11-01", signed: false },
  ],
});

assert.deepEqual(model.unsigned.map((row) => row.name), ["Haddad, Layla"]);
assert.deepEqual(model.checkedInWithoutNote.map((row) => row.name), ["Nguyen, Ethan"]);
assert.equal(model.tomorrowClosed, false);
assert.ok(model.openings.length > 0);
assert.ok(!model.openings.includes("9:00 AM"), model.openings.join(", "));

const sunday = buildCloseout({
  todayIso: "2026-11-14", // Saturday → Sunday closed on defaults
  settings,
  appointments: [],
  notes: [],
});
assert.equal(sunday.tomorrowClosed, true);

console.log("goat-closeout ok", model.openings.slice(0, 4));

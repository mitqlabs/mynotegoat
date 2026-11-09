/**
 * Untouched reminders: 3- and 7-day lien nudges, unsent R&B / medicals, unbooked referrals.
 * Run: npx tsx scripts/tests/goat-untouched.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listUntouchedItems, markHandled, GOAT_UNTOUCHED_KEY } from "../../src/lib/goat-untouched";
import { CLOUD_KEY_REGISTRY } from "../../src/lib/cloud-key-registry";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const today = "2026-11-09";
const appt = (over: Partial<ScheduleAppointmentRecord> = {}): ScheduleAppointmentRecord => ({
  id: "a", patientId: "booked", patientName: "Booked, Bea", provider: "", location: "", appointmentType: "New Patient",
  caseLabel: "", room: "", date: "2026-11-10", startTime: "09:00", durationMin: 30, status: "Scheduled", note: "", overrideOfficeHours: false, ...over,
});

const items = listUntouchedItems({
  todayIso: today,
  appointments: [appt()],
  tasks: [
    { id: "t1", title: "Send medicals to Yepremyan", priority: "High", done: false, dueDate: "", createdAt: "", updatedAt: "", patientId: "m1", patientName: "Med, Mia" },
    { id: "t2", title: "Send medicals", priority: "High", done: true, dueDate: "", createdAt: "", updatedAt: "" },
  ],
  patients: [
    { id: "lien3", fullName: "Lien, Three", caseStatus: "Active", dateOfLoss: "2026-01-01", matrix: { lien: "11/05/2026 Requested" } },
    { id: "lien7", fullName: "Lien, Seven", caseStatus: "Active", dateOfLoss: "2026-01-01", matrix: { lien: "10/20/2026 Requested" } },
    { id: "lien1", fullName: "Lien, New", caseStatus: "Active", dateOfLoss: "2026-01-01", matrix: { lien: "11/08/2026 Requested" } },
    { id: "rb", fullName: "Bill, Bea", caseStatus: "Discharged", dateOfLoss: "2026-02-01", matrix: { lien: "Received", rbSent: "" } },
    { id: "sent", fullName: "Sent, Sam", caseStatus: "Discharged", dateOfLoss: "2026-02-01", matrix: { rbSent: "11/01/2026" } },
    { id: "wait", fullName: "Wait, Wes", caseStatus: "Active", dateOfLoss: "" },
    { id: "booked", fullName: "Booked, Bea", caseStatus: "Active", dateOfLoss: "" },
  ],
});

const ids = items.map((item) => item.id);
assert.ok(ids.includes("lien:lien3:3"), ids.join(","));
assert.ok(ids.includes("lien:lien7:7"));
assert.ok(!ids.some((id) => id.startsWith("lien:lien1")));
assert.ok(ids.includes("rb:rb"));
assert.ok(!ids.includes("rb:sent"));
assert.ok(ids.includes("unbooked:wait"));
assert.ok(!ids.includes("unbooked:booked"));
assert.ok(ids.includes("medicals:t1"));
assert.ok(!ids.includes("medicals:t2"));

const hidden = listUntouchedItems({
  todayIso: today,
  appointments: [],
  patients: [{ id: "wait", fullName: "Wait, Wes", caseStatus: "Active", dateOfLoss: "" }],
  handled: markHandled([], "unbooked:wait", "Front desk", "2026-11-09T12:00:00.000Z"),
});
assert.equal(hidden.length, 0);
assert.equal(CLOUD_KEY_REGISTRY[GOAT_UNTOUCHED_KEY], "workspace");

const page = readFileSync(new URL("../../src/app/(portal)/goat-page/page.tsx", import.meta.url), "utf8");
assert.match(page, /UntouchedItems/);
assert.match(page, /saveHandledMarks/);

console.log("goat-untouched ok", ids);

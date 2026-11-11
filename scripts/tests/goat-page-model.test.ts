/**
 * G.O.A.T. Page counts from schedule and patient records already in the app.
 * Run: npx tsx scripts/tests/goat-page-model.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGoatPageModel } from "../../src/lib/goat-page-model";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const now = new Date(2026, 10, 9, 10, 15); // Mon Nov 9, 2026 10:15 local
const appt = (over: Partial<ScheduleAppointmentRecord>): ScheduleAppointmentRecord => ({
  id: "a",
  patientId: "p",
  patientName: "Haddad, Layla",
  provider: "",
  location: "",
  appointmentType: "Follow Up",
  caseLabel: "",
  room: "",
  date: "2026-11-09",
  startTime: "11:30",
  durationMin: 15,
  status: "Scheduled",
  note: "",
  overrideOfficeHours: false,
  ...over,
});

const model = buildGoatPageModel({
  now,
  officeName: "Main Office",
  closedStatuses: ["Dropped", "Paid"],
  patients: [
    { id: "in1", fullName: "New, Nora", caseStatus: "Active", dateOfLoss: "", phone: "818-555-0101" },
    { id: "open1", fullName: "Open, Omar", caseStatus: "Active", dateOfLoss: "2026-01-02", matrix: { lien: "" } },
    { id: "rb", fullName: "Done, Dana", caseStatus: "Discharged", dateOfLoss: "2026-02-02", matrix: { lien: "Received" } },
    { id: "paid", fullName: "Paid, Pat", caseStatus: "Paid", dateOfLoss: "2025-01-01" },
    { id: "cash", fullName: "Cash, Cam", caseStatus: "Active", dateOfLoss: "", isCashPatient: true },
  ],
  appointments: [
    appt({ id: "past", startTime: "09:00", status: "Check In", patientName: "Nguyen, Ethan" }),
    appt({ id: "next", startTime: "11:30", patientName: "Haddad, Layla", appointmentType: "New Patient" }),
    appt({ id: "ns", startTime: "13:00", status: "No Show", patientName: "Brooks, Marcus" }),
    appt({ id: "cx", startTime: "15:00", status: "Canceled", patientName: "Okoro, Amara" }),
    appt({ id: "otherday", date: "2026-11-10", startTime: "09:00" }),
  ],
});

assert.equal(model.greeting, "Good Morning");
assert.equal(model.dateLabel, "Monday, Nov. 9, 2026");
assert.equal(model.officeName, "Main Office");
assert.equal(model.appointments, 3); // canceled excluded from the count
assert.equal(model.intake.length, 1);
assert.equal(model.intake[0].name, "New, Nora");
assert.equal(model.schedule.checkedIn, 1);
assert.equal(model.schedule.noShow, 1);
assert.equal(model.schedule.newPatients, 1);
assert.equal(model.schedule.rows.find((r) => r.id === "next")?.badge, "Arriving soon");
assert.equal(model.schedule.rows.find((r) => r.id === "cx")?.badge, "Canceled");
assert.equal(model.schedule.rows.some((r) => r.id === "otherday"), false);
assert.equal(model.snapshot.inIntake, 1);
assert.equal(model.snapshot.openCases, 2); // Omar + Dana; Nora is intake, Pat closed, Cam cash
assert.equal(model.snapshot.awaitingRb, 1);
assert.equal(model.snapshot.missingLien, 1);

const header = readFileSync(new URL("../../src/components/global-goat.tsx", import.meta.url), "utf8");
assert.match(header, /href="\/goat-page"/);
assert.match(header, /Clear chat/);
const button = readFileSync(new URL("../../src/components/global-goat-button.tsx", import.meta.url), "utf8");
assert.match(button, /href="\/goat-page"/);
assert.match(button, /Open G\.O\.A\.T\. chat/);
assert.match(button, /fixed bottom-4 right-4/);
const shell = readFileSync(new URL("../../src/components/app-shell.tsx", import.meta.url), "utf8");
assert.match(shell, /<GoatChatFab/);
const view = readFileSync(new URL("../../src/components/goat-page-view.tsx", import.meta.url), "utf8");
assert.doesNotMatch(view, /Lien badge|office badge/i);
assert.match(view, /data-goat-page-layout="full"/);
assert.doesNotMatch(view, /max-w-6xl|mx-auto/);
assert.doesNotMatch(view, /\/goat\?q=/);
assert.doesNotMatch(view, /onChip/);
const board = readFileSync(new URL("../../src/lib/goat-board.ts", import.meta.url), "utf8");
assert.doesNotMatch(board, /"goat-answers":/);
assert.match(board, /Next open day/);
assert.match(board, /End of Day Handoff/);
assert.doesNotMatch(board, /Waiting On/);
assert.doesNotMatch(board, /Open slots/);

console.log("goat-page-model ok");

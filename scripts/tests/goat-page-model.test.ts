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
    { id: "atty", fullName: "Atty, Ann", caseStatus: "Active", attorney: "Ward Law", dateOfLoss: "2026-03-01", phone: "818-555-0199" },
    { id: "booked", fullName: "Booked, Bea", caseStatus: "Active", attorney: "SELF", dateOfLoss: "", matrix: { lien: "Received" } },
    { id: "open1", fullName: "Open, Omar", caseStatus: "Active", attorney: "Sample Law", dateOfLoss: "2026-01-02", matrix: { lien: "", initialExam: "01/15/2026" } },
    { id: "rb", fullName: "Done, Dana", caseStatus: "Discharged", attorney: "Sample Law", dateOfLoss: "2026-02-02", matrix: { lien: "Received", initialExam: "02/10/2026" } },
    { id: "paid", fullName: "Paid, Pat", caseStatus: "Paid", attorney: "Self", dateOfLoss: "2025-01-01", matrix: { initialExam: "02/01/2025" } },
    { id: "cash", fullName: "Cash, Cam", caseStatus: "Active", dateOfLoss: "", isCashPatient: true },
  ],
  appointments: [
    appt({ id: "past", startTime: "09:00", status: "Check In", patientName: "Nguyen, Ethan" }),
    appt({ id: "next", startTime: "11:30", patientName: "Haddad, Layla", appointmentType: "New Patient" }),
    appt({ id: "ns", startTime: "13:00", status: "No Show", patientName: "Brooks, Marcus" }),
    appt({ id: "cx", startTime: "15:00", status: "Canceled", patientName: "Okoro, Amara" }),
    appt({ id: "otherday", date: "2026-11-10", startTime: "09:00" }),
    appt({ id: "bea", patientId: "booked", patientName: "Booked, Bea", appointmentType: "Personal Injury New Patient", date: "2026-11-12", startTime: "09:00" }),
  ],
});

assert.equal(model.greeting, "Good Morning");
assert.equal(model.dateLabel, "Monday, Nov. 9, 2026");
assert.equal(model.officeName, "Main Office");
assert.equal(model.appointments, 3); // canceled excluded from the count
assert.equal(model.intake.length, 2);
assert.deepEqual(model.intake.map((row) => row.name).sort(), ["Atty, Ann", "New, Nora"]);
assert.equal(model.schedule.checkedIn, 1);
assert.equal(model.schedule.noShow, 1);
assert.equal(model.schedule.newPatients, 1);
assert.equal(model.schedule.rows.find((r) => r.id === "next")?.badge, "Arriving soon");
assert.equal(model.schedule.rows.find((r) => r.id === "cx")?.badge, "Canceled");
assert.equal(model.schedule.rows.some((r) => r.id === "otherday"), false);
assert.equal(model.snapshot.inIntake, 2);
assert.equal(model.snapshot.openCases, 3); // Omar + Dana + Bea (booked); Nora and Ann are intake, Pat closed, Cam cash
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

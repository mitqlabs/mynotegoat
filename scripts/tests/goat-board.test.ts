/**
 * G.O.A.T. Page briefing board: default order, visit groups, and office statuses.
 * Run: npx tsx scripts/tests/goat-board.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_BOX_ORDER,
  HANDOFF_TODAY_ITEMS,
  VISIT_GROUP_LABELS,
  appointmentVisible,
  dropRetiredBoxes,
  DEFAULT_MAX_H,
  MAX_BOX_H,
  clampMaxH,
  defaultBoard,
  defaultTypePriority,
  matchesPeriod,
  parseBoard,
  snapshotStatusesToShow,
  newStatusBox,
  nextOpenDayLabel,
  nextOpenOfficeDay,
  patientsInStatus,
  sortAppointments,
  todayVisitGroups,
} from "../../src/lib/goat-board";
import type { KeyDateRecord } from "../../src/lib/key-dates";
import { withoutAutoApptCheck } from "../../src/lib/goat-ai/global-chat";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";

assert.deepEqual([...DEFAULT_BOX_ORDER], [
  "goat-mail",
  "appointment-check",
  "quick-biz",
  "case-review",
  "schedule",
  "tomorrow-schedule",
  "intake",
  "todos",
  "case-snapshot",
  "end-of-day",
]);
assert.deepEqual(defaultBoard().map((box) => box.kind), [...DEFAULT_BOX_ORDER]);
assert.deepEqual(
  dropRetiredBoxes([{ i: "morning-rundown", kind: "morning-rundown" as never, x: 0, y: 0, w: 4, h: 8 }, defaultBoard()[0]]).map((box) => box.kind),
  ["goat-mail"],
);
const withAnswers = dropRetiredBoxes([
  { i: "intake", kind: "intake", x: 0, y: 0, w: 3, h: 8 },
  { i: "goat-answers", kind: "goat-answers" as never, x: 3, y: 0, w: 3, h: 8 },
  { i: "todos", kind: "todos", x: 6, y: 0, w: 6, h: 8 },
]);
assert.deepEqual(withAnswers.map((box) => box.kind), ["intake", "todos"]);
assert.equal(withAnswers.find((box) => box.kind === "todos")?.x, 3);
assert.equal(defaultBoard().some((box) => (box.kind as string) === "goat-answers"), false);
assert.deepEqual([...VISIT_GROUP_LABELS], ["New Patient", "Seen", "No Show", "Rebook", "Canceled"]);
assert.deepEqual(HANDOFF_TODAY_ITEMS.map((item) => item.label), [
  "Seen",
  "New patients seen",
  "No-shows",
  "Canceled",
  "Rebooks needed",
  "Unsigned notes",
  "Checked in, no note",
]);

const groups = todayVisitGroups(
  [
    { id: "a", patientId: "p1", patientName: "A", date: "2026-11-10", startTime: "09:00", status: "Check Out", appointmentType: "New Patient" },
    { id: "b", patientId: "p2", patientName: "B", date: "2026-11-10", startTime: "10:00", status: "No Show", appointmentType: "Follow Up" },
    { id: "c", patientId: "p3", patientName: "C", date: "2026-11-10", startTime: "11:00", status: "Canceled", appointmentType: "Follow Up" },
    { id: "d", patientId: "p4", patientName: "D", date: "2026-11-12", startTime: "09:00", status: "Reschedule", appointmentType: "Follow Up" },
    { id: "e", patientId: "p5", patientName: "E", date: "2026-11-10", startTime: "12:00", status: "Check In", appointmentType: "Follow Up" },
  ],
  "2026-11-10",
);
assert.deepEqual(groups.map((group) => group.label), [...VISIT_GROUP_LABELS]);
assert.deepEqual(groups.find((group) => group.label === "Canceled")?.rows.map((row) => row.name), ["C"]);
assert.equal(groups.some((group) => group.rows.some((row) => row.name === "E")), false);

const texas = ["Active", "Discharged", "Submitted", "Dropped", "Paid", "Ready to Discharge"];
const people = [
  { id: "1", fullName: "Lee, Ann", caseStatus: "Ready to Discharge" },
  { id: "2", fullName: "Kay, Bo", caseStatus: "Active" },
  { id: "3", fullName: "Kay, Bo", caseStatus: "ready to discharge", deleted: true },
];
assert.deepEqual(patientsInStatus(people, texas[5]).map((row) => row.id), ["1"]);
const custom = newStatusBox("Ready to Discharge", "Texas discharge", []);
assert.equal(custom.kind, "status-cases");
assert.equal(custom.statusName, "Ready to Discharge");
assert.equal(custom.title, "Texas discharge");

const ui = readFileSync(new URL("../../src/components/goat-briefing-board.tsx", import.meta.url), "utf8");
assert.match(ui, /compactType="vertical"/);
assert.match(ui, /isDraggable=\{arrange\}/);
assert.match(ui, /isResizable=\{arrange\}/);
assert.match(ui, /href=\{`\/patients\/\$\{patient.id\}`\}/);
assert.match(ui, /nextOpenDayLabel/);
assert.match(ui, /Tomorrow's Appointments/);
assert.match(ui, /aria-label="G.O.A.T. Page settings"/);
assert.doesNotMatch(ui, /Waiting On/);
assert.doesNotMatch(ui, /Open slots|Tomorrow's openings/);
assert.doesNotMatch(ui, /aria-label=\{`Remove /);
const settingsUi = readFileSync(new URL("../../src/components/goat-page-settings.tsx", import.meta.url), "utf8");
assert.match(settingsUi, /data-goat-page-settings/);
assert.match(settingsUi, /Save as office default/);
assert.match(settingsUi, /Reset Layout/);
assert.match(settingsUi, /Boxes On Board/);
assert.match(settingsUi, /Box By Status/);
assert.match(settingsUi, /Box By Referrals/);
assert.match(settingsUi, /case statuses/);
const registry = readFileSync(new URL("../../src/lib/cloud-key-registry.ts", import.meta.url), "utf8");
assert.match(registry, /"casemate\.goat-board-layout\.v1": "user"/);
assert.match(registry, /"casemate\.goat-page-office-default\.v1": "workspace"/);
const settingsPage = readFileSync(new URL("../../src/app/(portal)/settings/page.tsx", import.meta.url), "utf8");
assert.match(settingsPage, /href="\/settings\/goat"/);
const goatSettings = readFileSync(new URL("../../src/app/(portal)/settings/goat/page.tsx", import.meta.url), "utf8");
assert.match(goatSettings, /G\.O\.A\.T\. Page/);
assert.match(goatSettings, /G\.O\.A\.T\. Mail/);

const hours = getDefaultScheduleSettings();
hours.officeHours = hours.officeHours.map((row) => (row.dayOfWeek === 2 ? { ...row, enabled: false } : row));
const skippedTuesday = nextOpenOfficeDay("2026-11-09", hours, []);
assert.equal(skippedTuesday.closed, false);
assert.equal(skippedTuesday.date, "2026-11-11");
assert.equal(nextOpenDayLabel(skippedTuesday.date), "Next open day: Wed, Nov 11");

const openWeek = getDefaultScheduleSettings();
openWeek.officeHours = openWeek.officeHours.map((row) => ({ ...row, enabled: row.dayOfWeek !== 0 && row.dayOfWeek !== 6 }));
const holiday: KeyDateRecord = {
  id: "closed-tue",
  startDate: "2026-11-10",
  endDate: "2026-11-10",
  officeStatus: "Closed",
  reason: "Training",
};
const skippedHoliday = nextOpenOfficeDay("2026-11-09", openWeek, [holiday]);
assert.equal(skippedHoliday.date, "2026-11-11");
const partial: KeyDateRecord = { ...holiday, openStart: "08:00", openEnd: "12:00" };
assert.equal(nextOpenOfficeDay("2026-11-09", openWeek, [partial]).date, "2026-11-10");

const types = ["Follow Up", "New Patient", "Re-Exam"];
assert.deepEqual(defaultTypePriority(types), ["New Patient"]);
const sorted = sortAppointments(
  [
    { id: "f", startTime: "09:00", appointmentType: "Follow Up" },
    { id: "n", startTime: "11:00", appointmentType: "New Patient" },
    { id: "r", startTime: "08:00", appointmentType: "Re-Exam" },
  ],
  defaultTypePriority(types),
);
assert.deepEqual(sorted.map((row) => row.id), ["n", "r", "f"]);
assert.equal(appointmentVisible("Follow Up", ["Follow Up"]), false);
assert.equal(matchesPeriod({ matrix: { initialExam: "2026-03-01" } }, "this-year", "2026-11-11"), true);
assert.equal(matchesPeriod({ matrix: { initialExam: "2025-03-01" } }, "this-year", "2026-11-11"), false);
assert.equal(matchesPeriod({ dateOfLoss: "2025-01-02" }, "last-year", "2026-11-11"), true);
assert.equal(matchesPeriod({}, "this-year", "2026-11-11"), false);
assert.equal(matchesPeriod({}, "all", "2026-11-11"), true);

const statuses = ["Active", "Discharged", "Ready to Submit"];
assert.equal(snapshotStatusesToShow(undefined, statuses), null, "missing status keeps every group");
assert.equal(snapshotStatusesToShow("all", statuses), null);
assert.equal(snapshotStatusesToShow("All statuses", statuses), null);
assert.equal(snapshotStatusesToShow("Discharged", statuses), "Discharged");
assert.equal(snapshotStatusesToShow("discharged", statuses), "Discharged");
assert.equal(snapshotStatusesToShow("Dropped", statuses), null, "a status the office no longer has falls back to every group");
const saved = parseBoard(JSON.stringify([
  { i: "case-snapshot", kind: "case-snapshot", x: 0, y: 0, w: 6, h: 10, period: "this-year", snapshotStatus: "Active" },
]));
assert.equal(saved?.[0].period, "this-year");
assert.equal(saved?.[0].snapshotStatus, "Active", "status is stored on the board with period");

assert.equal(DEFAULT_MAX_H, 28);
assert.equal(MAX_BOX_H, 40);
assert.equal(clampMaxH(undefined), 28);
assert.equal(clampMaxH(40), 40);
assert.equal(clampMaxH(41), 40);
assert.equal(clampMaxH(16), 16);
assert.equal(clampMaxH(3), 4);
const boardSrc = readFileSync(new URL("../../src/components/goat-briefing-board.tsx", import.meta.url), "utf8");
assert.match(boardSrc, /goat-box-header/);
assert.match(boardSrc, /color-mix\(in_srgb,var\(--brand-primary\)_14%,transparent\)/);
assert.match(boardSrc, /rounded-t-2xl/);
assert.match(boardSrc, /font-bold text-\[var\(--brand-primary\)\]/);
assert.match(boardSrc, /isResizable=\{arrange\}/);
assert.match(boardSrc, /touch-pan-y/);
assert.match(boardSrc, /saveBoard/);
assert.match(boardSrc, /data-testid="case-snapshot-period"/);
assert.match(boardSrc, /data-testid="case-snapshot-status"/);
assert.match(boardSrc, /All statuses/);
assert.match(boardSrc, /snapshotStatus: event\.target\.value/);
assert.match(boardSrc, /grid-cols-2/);
assert.match(boardSrc, /\{body\(box\)\}/);
assert.doesNotMatch(boardSrc, /initialOpenBoxIds|data-goat-box-open/);

const chat = readFileSync(new URL("../../src/components/global-goat.tsx", import.meta.url), "utf8");
assert.match(chat, /data-goat-thumbsdown/);
assert.match(chat, /Not what I meant\?/);
assert.match(chat, /text-\[var\(--text-muted\)\]/);
assert.match(chat, /<GoatMeantLink onMiss=\{\(\) => markMissed\(m\)\} \/>/);
assert.match(chat, /What can I do for you\?/);
assert.doesNotMatch(chat, /opening && !briefHidden \? opening\.brief/);
assert.match(chat, /withoutAutoApptCheck/);
assert.doesNotMatch(chat, /👎/);
assert.doesNotMatch(chat, /runChip\("Appointment Check"\)/);
const handbook = readFileSync(new URL("../../src/lib/handbook-goat.ts", import.meta.url), "utf8");
assert.match(handbook, /Appointment Check runs when you tap it/);
assert.match(handbook, /Not what I meant\?/);
assert.doesNotMatch(handbook, /Each box starts closed/);
assert.doesNotMatch(handbook, /👎/);

const kept = { id: "q", role: "user" as const, text: "when was her MRI", at: "t" };
const answer = { id: "a", role: "goat" as const, text: "Last MRI was 01/02/2026.", at: "t" };
const ask = { id: "u", role: "user" as const, text: "Appointment Check", at: "t" };
const list = { id: "g", role: "goat" as const, text: "Appointment Check — 2 active patients need to be scheduled", at: "t" };
const typed = { id: "u2", role: "user" as const, text: "who needs to be scheduled", at: "t" };
const stripped = withoutAutoApptCheck({ messages: [kept, answer, ask, list], patientId: "p1" });
assert.deepEqual(stripped.messages.map((m) => m.id), ["q", "a"]);
assert.equal(stripped.patientId, "p1");
const asked = withoutAutoApptCheck({ messages: [typed, list], patientId: null });
assert.deepEqual(asked.messages.map((m) => m.id), ["u2", "g"], "a typed question stays");
assert.equal(withoutAutoApptCheck({ messages: [ask, list], patientId: null }).messages.length, 0);

console.log("goat board ok");

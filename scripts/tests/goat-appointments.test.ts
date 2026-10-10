/**
 * G.O.A.T. appointment questions: canceled / no-show / rescheduled / upcoming,
 * by appointment type, with dates (MM/DD/YYYY + weekday) and counts.
 * Mock data only: no network, no database.
 *
 * Run:  npx tsx scripts/tests/goat-appointments.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatAnswer, type GoatAppointment, type GoatContext } from "../../src/lib/goat";
import { apptStatus, statusesAsked, typesAsked, appointmentLinesForAi } from "../../src/lib/goat-appointments";

let pass = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name);
    throw e;
  }
}

const appt = (date: string, type: string, status: string, startTime = "10:00", note = ""): GoatAppointment => ({ date, startTime, type, status, note });

// Mock patient: today is Sat 10/10/2026.
const APPTS: GoatAppointment[] = [
  appt("2026-08-03", "New Patient", "Check Out", "09:00"),
  appt("2026-08-05", "Spinal Decompression - L/S", "Check Out"),
  appt("2026-08-07", "Spinal Decompression - L/S", "Check Out"),
  appt("2026-08-10", "Spinal Decompression - C/S", "Check Out"),
  appt("2026-08-12", "Spinal Decompression - L/S", "Canceled", "15:30", "Pt called - car trouble"),
  appt("2026-08-14", "Follow-Up Visit", "No Show"),
  appt("2026-08-17", "Follow-Up Visit", "Reschedule"),
  appt("2026-08-19", "Spinal Decompression - L/S", "Check Out"),
  appt("2026-09-01", "PI Re-Exam", "Check Out"),
  appt("2026-09-14", "PI Discharge Visit", "Check Out", "11:15"),
  appt("2026-10-01", "Follow-Up Visit", "Scheduled"), // past, never marked
  appt("2026-10-14", "Spinal Decompression - L/S", "Scheduled", "14:00"),
  appt("2026-10-21", "Follow-Up Visit", "Scheduled", "09:30"),
];

function ctx(over: Partial<GoatContext> = {}): GoatContext {
  return {
    today: "2026-10-10",
    patientName: "Doe, Jane",
    dob: "",
    phone: "",
    email: "",
    address: "",
    alerts: [],
    attorney: "",
    caseStatus: "",
    lien: "",
    review: "",
    isCashPatient: false,
    doi: "",
    initialExam: "",
    priorCare: "",
    xrayFindings: "",
    mriFindings: "",
    specialistRecommendations: "",
    imaging: [],
    specialists: [],
    notes: "",
    appointments: APPTS,
    encounters: [],
    plans: [],
    diagnoses: [],
    details: null,
    billing: null,
    termGroups: [],
    people: [],
    ...over,
  };
}

const card = (q: string, c = ctx()): GoatAnswer | undefined => askGoat(c, q).answers.find((a) => a.source.startsWith("Appointments (") || a.source === "Hidden for your account");
const text = (a: GoatAnswer | undefined) =>
  a ? [a.title, ...a.lines, ...(a.groups ?? []).flatMap((g) => g.blocks.flatMap((b) => [b.heading, ...b.items])), a.flag ?? ""].join("\n") : "";

/** Pasted into the PR / report. */
export function render(q: string, c = ctx()): string {
  const r = askGoat(c, q);
  return r.answers
    .map((a) => [`## ${a.title}`, ...a.lines, ...(a.groups ?? []).flatMap((g) => g.blocks.flatMap((b) => [b.heading ? `[${b.heading}]` : "", ...b.items.map((i) => `• ${i}`)])), a.flag ? `⚑ ${a.flag}` : "", `From: ${a.source}`].filter(Boolean).join("\n"))
    .join("\n\n");
}

test("status labels", () => {
  assert.equal(apptStatus("Check In"), "Checked In");
  assert.equal(apptStatus("Check Out"), "Checked Out");
  assert.equal(apptStatus("cancelled"), "Canceled");
  assert.equal(apptStatus("no-show"), "No Show");
  assert.equal(apptStatus("Reschedule"), "Rescheduled");
  assert.equal(apptStatus("Scheduled"), "Scheduled");
});

test("status synonyms", () => {
  for (const q of ["when did they cancel", "cancelled appts", "any cancellations", "how many cx", "CXL dates"]) {
    assert.deepEqual(statusesAsked(q).statuses, ["Canceled"], q);
  }
  for (const q of ["no shows?", "any no-show", "noshow dates", "did they NS", "when didn't they show"]) {
    assert.deepEqual(statusesAsked(q).statuses, ["No Show"], q);
  }
  assert.deepEqual(statusesAsked("missed appointments").statuses, ["Canceled", "No Show"]);
  assert.deepEqual(statusesAsked("rescheduled visits").statuses, ["Rescheduled"]);
  assert.deepEqual(statusesAsked("ns appointments").statuses, [], "lowercase ns is not a status");
  assert.equal(statusesAsked("upcoming appointments").upcoming, true);
});

test("type matching", () => {
  const types = APPTS.map((a) => a.type);
  assert.deepEqual(typesAsked("how many lumbar decompression appointments", types), ["Spinal Decompression - L/S"]);
  assert.deepEqual(typesAsked("neck decompression", types), ["Spinal Decompression - C/S"]);
  assert.deepEqual(typesAsked("when was the last Discharge", types), ["PI Discharge Visit"]);
  assert.deepEqual(typesAsked("list new patient visits", types), ["New Patient"]);
  assert.deepEqual(typesAsked("re-exam dates", types), ["PI Re-Exam"]);
  assert.equal(typesAsked("when did they cancel their appt", types), null);
  assert.deepEqual(typesAsked("massage appointments", types), [], "kind named but none on file");
});

test("when did they cancel their appt → date, weekday, type, note", () => {
  const a = card("when did they cancel their appt");
  assert.ok(a, "appointment card");
  assert.equal(a!.title, "Canceled appointments");
  assert.match(a!.lines[0], /^1 canceled appointment: 08\/12\/2026 \(Wed\) 3:30 PM — Spinal Decompression - L\/S — Note: Pt called - car trouble\.$/);
  // First card, and the Visits summary is still there.
  const r = askGoat(ctx(), "when did they cancel their appt");
  assert.equal(r.answers[0].title, "Canceled appointments");
  assert.ok(r.answers.some((x) => x.title === "Visits" && /13 appointments on file/.test(x.lines.join(" "))));
});

test("which appointments did they cancel → list with count", () => {
  const two = [...APPTS, appt("2026-09-08", "Follow-Up Visit", "Cancelled", "16:00")];
  const a = card("which appointments did they cancel", ctx({ appointments: two }));
  assert.match(a!.lines[0], /^2 canceled appointments\. Most recent: 09\/08\/2026 \(Tue\) 4:00 PM — Follow-Up Visit\./);
  const items = a!.groups![0].blocks[0].items;
  assert.equal(a!.groups![0].blocks[0].heading, "Canceled (2) · newest first");
  assert.deepEqual(items.map((i) => i.slice(0, 10)), ["09/08/2026", "08/12/2026"]);
});

test("no-shows and missed", () => {
  const ns = card("any no shows?");
  assert.match(ns!.lines[0], /^1 no-show appointment: 08\/14\/2026 \(Fri\) 10:00 AM — Follow-Up Visit\./);
  assert.match(ns!.flag ?? "", /1 past appointment still marked Scheduled.*10\/01\/2026 \(Thu\)/);
  const missed = card("how many missed appointments");
  assert.match(missed!.lines[0], /^2 canceled or no-show appointments\./);
  assert.deepEqual(missed!.groups![0].blocks.map((b) => b.heading), ["Canceled (1) · newest first", "No Show (1) · newest first"]);
});

test("rescheduled", () => {
  const a = card("which visits were rescheduled");
  assert.match(a!.lines[0], /^1 rescheduled appointment: 08\/17\/2026 \(Mon\)/);
});

test("by type: lumbar decompression appointments", () => {
  const a = card("how many lumbar decompression appointments");
  assert.ok(a);
  assert.equal(a!.title, "Lumbar decompression appointments");
  assert.match(a!.lines[0], /^5 lumbar decompression appointments on file: 1 canceled, 3 checked out, 1 upcoming\./);
  const heads = a!.groups![0].blocks.map((b) => b.heading);
  assert.deepEqual(heads, ["Upcoming (1) · soonest first", "Past (4) · newest first"]);
  assert.equal(a!.groups![0].blocks[1].items[0].slice(0, 16), "08/19/2026 (Wed)");
});

test("by type: last Discharge", () => {
  const a = card("when was the last Discharge");
  assert.match(a!.lines[0], /^Last Discharge: 09\/14\/2026 \(Mon\) 11:15 AM — PI Discharge Visit · Checked Out\./);
});

test("by type: list new patient visits", () => {
  const a = card("list new patient visits");
  assert.equal(a!.title, "New patient appointments");
  assert.match(text(a), /08\/03\/2026 \(Mon\) 9:00 AM — New Patient · Checked Out/);
});

test("status + type: canceled decompression appts", () => {
  const a = card("canceled decompression appts");
  assert.equal(a!.title, "Decompression · Canceled appointments");
  assert.match(a!.lines[0], /^1 canceled appointment: 08\/12\/2026/);
  const none = card("canceled cervical decompression appointments");
  assert.match(none!.lines[0], /^No canceled cervical decompression appointments on file\./);
});

test("upcoming list, soonest first", () => {
  const a = card("list upcoming appointments");
  const items = a!.groups![0].blocks[0].items;
  assert.deepEqual(items.map((i) => i.slice(0, 10)), ["10/14/2026", "10/21/2026"]);
});

test("whole history", () => {
  const a = card("list all appointments");
  assert.match(a!.lines[0], /^13 appointments on file:/);
  assert.equal(a!.groups![0].blocks[1].items.length, 11);
});

test("long lists show 15 then 'Show all'", () => {
  const many = Array.from({ length: 30 }, (_, i) => appt(`2026-0${1 + Math.floor(i / 10)}-${String(1 + (i % 10)).padStart(2, "0")}`, "Follow-Up Visit", "Check Out"));
  const a = card("list all visits", ctx({ appointments: many }));
  const b = a!.groups![0].blocks[0];
  assert.equal(b.items.length, 30);
  assert.equal(b.focus!.length, 15);
  assert.equal(b.more, "appointments");
});

test("hidden appointments section is never read", () => {
  const a = card("when did they cancel their appt", ctx({ appointments: null }));
  assert.equal(a!.source, "Hidden for your account");
  assert.doesNotMatch(text(a), /08\/12/);
  const r = askGoat(ctx({ appointments: null }), "car trouble");
  assert.ok(!r.hits.some((h) => h.kind === "Appointment"));
});

test("appointment notes are searchable", () => {
  const r = askGoat(ctx(), "car trouble");
  const hit = r.hits.find((h) => h.kind === "Appointment");
  assert.ok(hit);
  assert.match(hit!.title, /08\/12\/2026/);
});

test("doesn't hijack other questions", () => {
  for (const q of ["when was the lumbar MRI done", "next visit", "how many visits", "gaps in care", "how many decompression sessions", "lumbar findings", "diagnosis codes"]) {
    assert.equal(card(q), undefined, q);
  }
});

test("Smart mode lines: every appointment, newest first", () => {
  const lines = appointmentLinesForAi(APPTS);
  assert.equal(lines.length, 13);
  assert.equal(lines[0], "10/21/2026 (Wed) 9:30 AM — Follow-Up Visit · Scheduled");
  assert.ok(lines.includes("08/12/2026 (Wed) 3:30 PM — Spinal Decompression - L/S · Canceled — Note: Pt called - car trouble"));
  assert.deepEqual(appointmentLinesForAi(null), []);
});

console.log(`\n${pass} passed`);

if (process.env.GOAT_EXAMPLES) {
  const two = ctx({ appointments: [...APPTS, appt("2026-09-08", "Follow-Up Visit", "Cancelled", "16:00")] });
  for (const q of ["when did they cancel their appt", "which appointments did they cancel"]) {
    console.log(`\n=== Q: ${q} (1 canceled)\n${render(q)}`);
    console.log(`\n=== Q: ${q} (2 canceled)\n${render(q, two)}`);
  }
}

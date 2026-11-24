/**
 * New Patient popup: a taken time shows open times + "Book anyway" (the Schedule's override).
 * Fictional data only.  Run:  npx tsx scripts/tests/new-patient-book-anyway.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planNewPatientFirstVisit } from "../../src/lib/new-patient-intake";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const types = [{ name: "New Patient", durationMin: 30, isDefault: true }, { name: "Follow Up", durationMin: 15 }];
const settings = { ...getDefaultScheduleSettings(), maxAppointmentsPerSlot: 1 };
const busy: ScheduleAppointmentRecord = {
  id: "a1", patientId: "p1", patientName: "Testerly, Quinn", provider: "", location: "", appointmentType: "Follow Up",
  caseLabel: "", room: "", date: "2026-08-10", startTime: "16:00", durationMin: 15, status: "Scheduled", note: "", overrideOfficeHours: false,
};
const input = { dateMdy: "08/10/2026", timeText: "4:00 PM" };

test("nothing typed -> nothing to book", () => {
  assert.deepEqual(planNewPatientFirstVisit({ dateMdy: "", timeText: "" }, [], settings, types), { kind: "none" });
});

test("open time books normally, no override", () => {
  const plan = planNewPatientFirstVisit(input, [], settings, types);
  assert.equal(plan.kind, "book");
  if (plan.kind === "book") { assert.equal(plan.time, "16:00"); assert.equal(plan.override, false); }
});

test("taken time -> conflict with open nearby chips and override allowed", () => {
  const plan = planNewPatientFirstVisit(input, [busy], settings, types);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") {
    assert.equal(plan.reason, "taken");
    assert.equal(plan.message, "4:00 PM is taken.");
    assert.equal(plan.canOverride, true);
    assert.ok(plan.suggestions.length > 0);
    assert.ok(!plan.suggestions.includes("16:00"));
    // clicking a chip sets that time, which then books cleanly
    const again = planNewPatientFirstVisit({ ...input, timeText: plan.suggestions[0] }, [busy], settings, types);
    assert.equal(again.kind, "book");
  }
});

test("Book anyway books the taken time with override on", () => {
  const plan = planNewPatientFirstVisit({ ...input, bookAnyway: true }, [busy], settings, types);
  assert.equal(plan.kind, "book");
  if (plan.kind === "book") { assert.equal(plan.time, "16:00"); assert.equal(plan.override, true); }
});

test("overrides turned off in Settings -> Schedule: Book anyway is ignored", () => {
  const strict = { ...settings, allowOverride: false };
  const plan = planNewPatientFirstVisit({ ...input, bookAnyway: true }, [busy], strict, types);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.equal(plan.canOverride, false);
});

test("outside office hours (Sunday) is a conflict, override books it", () => {
  const sunday = { dateMdy: "08/09/2026", timeText: "10:00 AM" };
  const plan = planNewPatientFirstVisit(sunday, [], settings, types);
  assert.equal(plan.kind, "conflict");
  if (plan.kind === "conflict") assert.equal(plan.reason, "outside");
  const forced = planNewPatientFirstVisit({ ...sunday, bookAnyway: true }, [], settings, types);
  assert.equal(forced.kind, "book");
  if (forced.kind === "book") assert.equal(forced.override, true);
});

test("bad date / missing time still give plain errors", () => {
  assert.equal(planNewPatientFirstVisit({ dateMdy: "8/10", timeText: "4:00 PM" }, [], settings, types).kind, "error");
  assert.equal(planNewPatientFirstVisit({ dateMdy: "08/10/2026", timeText: "" }, [], settings, types).kind, "error");
});

test("popup saves the override flag and wires chips + checkbox", () => {
  const src = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
  assert.match(src, /overrideOfficeHours: firstVisit\.override/);
  assert.match(src, /new-patient-slot-chip/);
  assert.match(src, /Book anyway at \{to12hLabel/);
});

console.log(`${passed} passed`);

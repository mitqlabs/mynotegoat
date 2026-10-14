import assert from "node:assert/strict";
import {
  autoRunDays,
  buildDeviceQueue,
  generateDeviceToken,
  hashDeviceToken,
  planReminderRun,
  renderReminderText,
  splitPatientName,
  toE164,
} from "../../src/lib/reminder-automation";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { expandTokens } from "../../src/lib/sms-render";
import type { PatientRecord } from "../../src/lib/mock-data";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

// Mock data only.
const hours = (open: number[]) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, enabled: open.includes(d) }));
const monWedThu = hours([1, 3, 4]);
assert.deepEqual(autoRunDays(monWedThu), [0, 2, 3], "Mon/Wed/Thu office → Sun/Tue/Wed runs");
assert.deepEqual(autoRunDays(hours([1, 2, 3, 4, 5])), [0, 1, 2, 3, 4]);

const s = { ...defaultSmsReminderSettings(), enabled: true };
assert.equal(s.sendHour, 8);
assert.equal(s.dryRun, true, "new setups start in dry run");
// 2026-10-18 is a Sunday. 08:05 PT = 15:05Z.
const sun8 = new Date("2026-10-18T15:05:00Z");
let plan = planReminderRun({ now: sun8, settings: s, officeHours: monWedThu, closedIsoDates: new Set() });
assert.equal(plan.run, true);
assert.equal(plan.visitDate, "2026-10-19", "Sunday's run covers Monday");
plan = planReminderRun({ now: new Date("2026-10-19T15:05:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set() });
assert.equal(plan.run, false, "Monday is not a run day");
plan = planReminderRun({ now: new Date("2026-10-18T14:05:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set() });
assert.equal(plan.run, false, "07:05 is before the 8 AM send time");
plan = planReminderRun({ now: sun8, settings: s, officeHours: monWedThu, closedIsoDates: new Set(["2026-10-19"]) });
assert.equal(plan.run, false, "closed tomorrow → no run");
plan = planReminderRun({ now: sun8, settings: { ...s, enabled: false }, officeHours: monWedThu, closedIsoDates: new Set() });
assert.equal(plan.run, false);
plan = planReminderRun({ now: new Date("2026-10-19T15:05:00Z"), settings: { ...s, runDays: [1] }, officeHours: monWedThu, closedIsoDates: new Set() });
assert.equal(plan.run, true, "manual run days override");
const n = normalizeSmsReminderSettings({ runDays: [3, 0, 9, 3], dryRun: false });
assert.deepEqual(n.runDays, [0, 3]);
assert.equal(n.dryRun, false);
assert.equal(normalizeSmsReminderSettings({}).runDays, null);

assert.equal(expandTokens("Call {{OFFICE_PHONE}}", { office: { officeName: "", doctorName: "", phone: "555-0100" } }), "Call 555-0100");
assert.deepEqual(splitPatientName("Doe, Jane"), { firstName: "Jane", lastName: "Doe" });
assert.deepEqual(splitPatientName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
assert.equal(toE164("5550100123"), "+15550100123");

const appt = (id: string, patientId: string, status: string, time = "10:30") =>
  ({ id, patientId, patientName: "", appointmentType: "Office Visit", date: "2026-10-19", startTime: time, status }) as unknown as ScheduleAppointmentRecord;
const pt = (id: string, extra: Partial<PatientRecord> = {}) =>
  ({ id, fullName: `Mock, Pat${id}`, phone: "(555) 010-0100", ...extra }) as PatientRecord;
const patientsById = new Map<string, PatientRecord>([
  ["p1", pt("p1", { locationId: "loc-b" })],
  ["p2", pt("p2", { textRemindersOff: true })],
  ["p3", pt("p3", { phone: "" })],
  ["p4", pt("p4")],
  ["p5", pt("p5")],
]);
const appointments = [
  appt("a1", "p1", "Scheduled"),
  appt("a2", "p2", "Scheduled"),
  appt("a3", "p3", "Scheduled"),
  appt("a4", "p4", "Canceled"),
  appt("a5", "p5", "No Show"),
  appt("a6", "p1", "Scheduled", "15:00"),
  appt("a7", "p5", "Scheduled", "09:00"),
];
const office = { officeName: "Mock Chiro", doctorName: "Dr. Mock", phone: "555-0000", locations: [{ id: "loc-b", phone: "555-0222" }] };
const body = "Hi {{FIRST_NAME}}, see you {{DATE}} at {{TIME}} at {{OFFICE_NAME}}. {{OFFICE_PHONE}}";
const items = buildDeviceQueue({ appointments, patientsById, settings: s, visitDate: "2026-10-19", templateBody: body, office, alreadySentIds: new Set() });
assert.deepEqual(items.map((i) => i.id), ["a7", "a1"], "skips opted-out, no phone, canceled, no-show, second same-day visit; time order");
assert.equal(items.find((i) => i.id === "a1")?.text, "Hi Patp1, see you 10/19/2026 at 10:30 AM at Mock Chiro. 555-0222", "location phone wins");
assert.ok(items.every((i) => Object.keys(i).sort().join() === "id,phone,text"), "only id, phone, text leave the server");
const again = buildDeviceQueue({ appointments, patientsById, settings: s, visitDate: "2026-10-19", templateBody: body, office, alreadySentIds: new Set(["a7"]) });
assert.deepEqual(again.map((i) => i.id), ["a1"], "already-sent reminders are not sent twice");
assert.equal(renderReminderText("{{FIRST_NAME}}", { appointmentId: "", patientId: "", patientName: "Roe, Ann", phone: "", date: "2026-10-19", time: "08:00", appointmentType: "" }, undefined, office), "Ann");

void (async () => {
  const token = generateDeviceToken();
  assert.match(token, /^ngr_[0-9a-f]{64}$/);
  assert.notEqual(generateDeviceToken(), token);
  const h = await hashDeviceToken(token);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await hashDeviceToken(token), h);
  console.log("PASS text-reminders-automation (run days, plan, render, queue, dedupe, tokens; mock data)");
})();

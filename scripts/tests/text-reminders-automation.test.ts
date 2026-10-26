import assert from "node:assert/strict";
import {
  autoRunDays,
  backupWaitReason,
  broadcastBackupHold,
  buildDeviceQueue,
  decodeQueueItemId,
  encodeReminderItemId,
  pickBroadcastRecipients,
  planCatchUp,
  planScheduledRun,
  broadcastTimeOk,
  todayWording,
  generateDeviceToken,
  hashDeviceToken,
  planReminderRun,
  renderReminderText,
  splitPatientName,
  toE164,
} from "../../src/lib/reminder-automation";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { expandTokens } from "../../src/lib/sms-render";
import {
  findClosedKeyDateForDate,
  formatKeyDateHours,
  isTimeWithinHours,
  keyDateHoursForDate,
  type KeyDateRecord,
} from "../../src/lib/key-dates";
import { closedDates, hoursByDateFromKeyDates } from "../../src/lib/reminder-server";
import type { PatientRecord } from "../../src/lib/mock-data";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

// Mock data only.
const hours = (open: number[]) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, enabled: open.includes(d) }));
const monWedThu = hours([1, 3, 4]);
assert.deepEqual(autoRunDays(monWedThu), [0, 2, 3], "Mon/Wed/Thu office → Sun/Tue/Wed runs");
assert.deepEqual(autoRunDays(hours([1, 2, 3, 4, 5])), [0, 1, 2, 3, 4]);

const s = { ...defaultSmsReminderSettings(), enabled: true, optOutLine: false };
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
// Send Now (force): skips run day + send hour, still needs enabled.
plan = planReminderRun({ now: new Date("2026-10-19T22:00:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set(), force: true });
assert.equal(plan.run, true, "force runs on a non-run day");
assert.equal(plan.visitDate, "2026-10-20");
plan = planReminderRun({ now: new Date("2026-10-18T14:05:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set(), force: true });
assert.equal(plan.run, false, "force still respects quiet hours (07:05 is before quiet end 8)");
plan = planReminderRun({ now: sun8, settings: { ...s, enabled: false }, officeHours: monWedThu, closedIsoDates: new Set(), force: true });
assert.equal(plan.run, false, "force never overrides the off switch");
plan = planReminderRun({ now: new Date("2026-10-18T17:00:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set(), lastRunAt: sun8 });
assert.equal(plan.run, false, "once a day (dry-run polling)");
plan = planReminderRun({ now: new Date("2026-10-18T17:00:00Z"), settings: s, officeHours: monWedThu, closedIsoDates: new Set(), lastRunAt: sun8, force: true });
assert.equal(plan.run, true, "Send Now after a run is allowed");
// Backup device timing (8 AM send hour → backup from 8:30 PT).
assert.ok(backupWaitReason({ now: new Date("2026-10-18T15:10:00Z"), settings: s, requestedAt: null, selfForced: false })?.includes("8:30"));
assert.equal(backupWaitReason({ now: new Date("2026-10-18T15:31:00Z"), settings: s, requestedAt: null, selfForced: false }), null);
assert.equal(backupWaitReason({ now: new Date("2026-10-18T15:10:00Z"), settings: s, requestedAt: null, selfForced: true }), null, "forced on the device itself");
const req = new Date("2026-10-18T20:00:00Z");
assert.ok(backupWaitReason({ now: new Date("2026-10-18T20:10:00Z"), settings: s, requestedAt: req, selfForced: false }));
assert.equal(backupWaitReason({ now: new Date("2026-10-18T20:31:00Z"), settings: s, requestedAt: req, selfForced: false }), null, "Send Now: backup after 30 min");

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
{
  const withLine = buildDeviceQueue({ appointments, patientsById, settings: { ...s, optOutLine: true }, visitDate: "2026-10-19", templateBody: body, office, alreadySentIds: new Set() });
  assert.equal(withLine.find((i) => i.id === "a1")?.text, "Hi Patp1, see you 10/19/2026 at 10:30 AM at Mock Chiro. 555-0222 Reply STOP to opt out.", "opt-out line appended");
}
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

// ---- "Send Reminders Now" catch-up planning ----
{
  const on = { ...defaultSmsReminderSettings(), enabled: true, optOutLine: false };
  const allOpen = hours([0, 1, 2, 3, 4, 5, 6]);
  // Mon 2026-10-19 07:30 PT (14:30Z): quiet until 8 → nothing.
  let c = planCatchUp({ now: new Date("2026-10-19T14:30:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set() });
  assert.deepEqual(c.dates, []);
  assert.match(c.reason, /Quiet/);
  // Mon 08:10 PT: today (after 08:10) + tomorrow (run day, past send hour).
  c = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set() });
  assert.deepEqual(c.dates, [
    { visitDate: "2026-10-19", mode: "today", onlyAfter: "08:10" },
    { visitDate: "2026-10-20", mode: "tomorrow" },
  ]);
  assert.equal(c.visitDate, "2026-10-20");
  // Later send hour: at 08:10 tomorrow isn't due yet, today still is.
  c = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: { ...on, sendHour: 10 }, officeHours: allOpen, closedIsoDates: new Set() });
  assert.deepEqual(c.dates.map((d) => d.mode), ["today"]);
  assert.match(c.reason, /10:00/);
  // Not a run day for tomorrow (Mon/Wed/Thu office; Monday → Tuesday closed).
  c = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: on, officeHours: monWedThu, closedIsoDates: new Set() });
  assert.deepEqual(c.dates.map((d) => d.mode), ["today"]);
  // Closures (Key Dates) skip that day.
  c = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set(["2026-10-19"]) });
  assert.deepEqual(c.dates.map((d) => d.visitDate), ["2026-10-20"]);
  assert.match(c.reason, /closed today/);
  // Turned off → nothing.
  c = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: { ...on, enabled: false }, officeHours: allOpen, closedIsoDates: new Set() });
  assert.deepEqual(c.dates, []);

  // Same-day queue: past visits skipped, "today" wording, already-sent skipped.
  const appts = [
    { id: "a1", patientId: "p1", patientName: "Doe, Jane", appointmentType: "Office Visit", date: "2026-10-19", startTime: "08:00", status: "Scheduled" },
    { id: "a2", patientId: "p2", patientName: "Roe, Rick", appointmentType: "Office Visit", date: "2026-10-19", startTime: "10:30", status: "Scheduled" },
    { id: "a3", patientId: "p3", patientName: "Poe, Pat", appointmentType: "Office Visit", date: "2026-10-19", startTime: "11:00", status: "Scheduled" },
  ] as unknown as ScheduleAppointmentRecord[];
  const pts = new Map(
    ["p1", "p2", "p3"].map((id, i) => [id, { id, fullName: "", phone: `555000000${i}` } as unknown as PatientRecord]),
  );
  const q = buildDeviceQueue({
    appointments: appts,
    patientsById: pts,
    settings: on,
    visitDate: "2026-10-19",
    templateBody: "Hi {{FIRST_NAME}}, see you tomorrow at {{TIME}}. Tomorrow!",
    office: { officeName: "X", doctorName: "Y", phone: "1" },
    alreadySentIds: new Set(["a3"]),
    onlyAfter: "08:10",
    sameDay: true,
  });
  assert.deepEqual(q.map((i) => i.id), ["a2"], "past (08:00) and already-sent (a3) are skipped");
  assert.equal(q[0].text, "Hi Rick, see you today at 10:30 AM. Today!");
  assert.equal(todayWording("TOMORROW tomorrow Tomorrow"), "TODAY today Today");

  // Item ids round-trip through ack.
  assert.equal(encodeReminderItemId("2026-10-20", "a9", "2026-10-20"), "a9");
  assert.equal(encodeReminderItemId("2026-10-19", "a2", "2026-10-20"), "r:2026-10-19:a2");
  assert.deepEqual(decodeQueueItemId("r:2026-10-19:a2", "2026-10-20"), { kind: "reminder", visitDate: "2026-10-19", appointmentId: "a2" });
  assert.deepEqual(decodeQueueItemId("a9", "2026-10-20"), { kind: "reminder", visitDate: "2026-10-20", appointmentId: "a9" });
  assert.deepEqual(decodeQueueItemId("b:xyz", ""), { kind: "broadcast", recipientId: "xyz" });
  assert.equal(decodeQueueItemId("a9", ""), null);

  // Message patients: valid phone, once per patient, skip canceled/opted-out.
  const picked = pickBroadcastRecipients(
    [
      { appointmentId: "1", patientId: "p1", patientName: "A", time: "09:00", status: "Scheduled", phone: "(555) 000-0001" },
      { appointmentId: "2", patientId: "p1", patientName: "A", time: "11:00", status: "Scheduled", phone: "(555) 000-0001" },
      { appointmentId: "3", patientId: "p2", patientName: "B", time: "08:00", status: "Canceled", phone: "5550000002" },
      { appointmentId: "4", patientId: "p3", patientName: "C", time: "10:00", status: "Scheduled", phone: "123" },
      { appointmentId: "5", patientId: "p4", patientName: "D", time: "10:00", status: "Scheduled", phone: "5550000004", optedOut: true },
    ],
    { excludeCanceled: true },
  );
  assert.deepEqual(picked.map((r) => r.appointmentId), ["1"]);
  assert.equal(pickBroadcastRecipients([{ appointmentId: "3", patientId: "p2", patientName: "B", time: "08:00", status: "Canceled", phone: "5550000002" }], { excludeCanceled: false }).length, 1);
  // Backup waits 30 min after a broadcast is queued unless tapped by hand.
  const t0 = new Date("2026-10-19T16:00:00Z");
  assert.equal(broadcastBackupHold(t0, new Date("2026-10-19T16:10:00Z"), false), true);
  assert.equal(broadcastBackupHold(t0, new Date("2026-10-19T16:10:00Z"), true), false);
  assert.equal(broadcastBackupHold(t0, new Date("2026-10-19T16:31:00Z"), false), false);
  // ---- Partial closures / special hours + scheduled run + broadcast window ----
  {
    const early = { id: "k1", startDate: "2026-10-19", endDate: "2026-10-19", officeStatus: "Closed", reason: "Early close", openEnd: "14:00" } as unknown as KeyDateRecord;
    const full = { id: "k2", startDate: "2026-10-21", endDate: "2026-10-21", officeStatus: "Closed", reason: "Holiday" } as unknown as KeyDateRecord;
    const rows = [early, full];
    assert.equal(findClosedKeyDateForDate(rows, "2026-10-19"), null, "partial closure is not a full closure");
    assert.ok(findClosedKeyDateForDate(rows, "2026-10-21"), "full-day closure stays backward-compatible");
    const h = keyDateHoursForDate(rows, "2026-10-19");
    assert.ok(h);
    assert.equal(isTimeWithinHours("13:30", h), true);
    assert.equal(isTimeWithinHours("14:00", h), false);
    assert.equal(isTimeWithinHours("", h), true, "unknown time counts as inside");
    assert.equal(keyDateHoursForDate(rows, "2026-10-20"), null);
    assert.match(formatKeyDateHours(early), /2:00 PM/);
    assert.deepEqual([...closedDates(rows as never)].sort(), ["2026-10-21"]);
    assert.equal(hoursByDateFromKeyDates(rows as never).get("2026-10-19")?.end, "14:00");

    // Planner attaches hours; device queue drops visits outside them.
    const hoursByDate = new Map([["2026-10-19", h!]]);
    const cu = planCatchUp({ now: new Date("2026-10-19T15:10:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set(), hoursByDate });
    assert.equal(cu.dates[0].hours?.end, "14:00");
    const dq = buildDeviceQueue({
      appointments: [
        { id: "x1", patientId: "p1", patientName: "Doe, Jane", appointmentType: "Office Visit", date: "2026-10-19", startTime: "13:00", status: "Scheduled" },
        { id: "x2", patientId: "p2", patientName: "Roe, Rick", appointmentType: "Office Visit", date: "2026-10-19", startTime: "15:00", status: "Scheduled" },
      ] as unknown as ScheduleAppointmentRecord[],
      patientsById: pts,
      settings: on,
      visitDate: "2026-10-19",
      templateBody: "Hi {{FIRST_NAME}}",
      office: { officeName: "X", doctorName: "Y", phone: "1" },
      alreadySentIds: new Set(),
      hours: h,
    });
    assert.deepEqual(dq.map((i) => i.id), ["x1"], "15:00 visit is after the 2 PM close");

    // Regular (non-force) 8 AM run: today's remaining + tomorrow; quiet hours/too early block.
    let sr = planScheduledRun({ now: new Date("2026-10-19T15:10:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set() });
    assert.deepEqual(sr.dates.map((d) => d.mode), ["today", "tomorrow"]);
    sr = planScheduledRun({ now: new Date("2026-10-19T14:30:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set() });
    assert.deepEqual(sr.dates, []);
    sr = planScheduledRun({ now: new Date("2026-10-20T05:00:00Z"), settings: on, officeHours: allOpen, closedIsoDates: new Set() });
    assert.deepEqual(sr.dates, [], "10 PM = quiet hours");
    sr = planScheduledRun({ now: new Date("2026-10-19T15:10:00Z"), settings: { ...on, sendHour: 10 }, officeHours: allOpen, closedIsoDates: new Set() });
    assert.deepEqual(sr.dates, [], "before send hour");

    // Message patients time window ("closing at 2 PM, text 2 PM and later").
    assert.equal(broadcastTimeOk("14:00", { startTime: "14:00" }), true);
    assert.equal(broadcastTimeOk("13:45", { startTime: "14:00" }), false);
    assert.equal(broadcastTimeOk("16:00", { startTime: "14:00", endTime: "16:00" }), false);
    assert.equal(broadcastTimeOk("", {}), true);
    assert.equal(broadcastTimeOk("", { startTime: "14:00" }), false);
    const win = pickBroadcastRecipients(
      [
        { appointmentId: "1", patientId: "p1", patientName: "A", time: "09:00", status: "Scheduled", phone: "5550000001" },
        { appointmentId: "2", patientId: "p2", patientName: "B", time: "14:30", status: "Scheduled", phone: "5550000002" },
      ],
      { excludeCanceled: true, startTime: "14:00" } as never,
    );
    assert.deepEqual(win.map((r) => r.appointmentId), ["2"]);
  }
}
console.log("catch-up planning tests passed");

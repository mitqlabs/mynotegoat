/**
 * Expired claims come back, late birthdays do not, and a morning that
 * fetched-but-didn't-send is visible the same day. Mock data only.
 * Run: npx tsx scripts/tests/reminder-claim-heal.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { birthdayClaimDecision } from "../../src/lib/birthday-texts";
import {
  catchUpClockLabels,
  leaseCanTake,
  shortcutBatchSize,
  CLAIM_MINUTES,
} from "../../src/lib/reminder-automation";
import { morningRunStatus, morningWorkDue, MORNING_GRACE_MINUTES } from "../../src/lib/reminder-automation-health";
import { defaultSmsReminderSettings, type SmsReminderSettings } from "../../src/lib/sms-reminders";
import type { PatientRecord } from "../../src/lib/mock-data";
import type { ScheduleAppointmentRecord } from "../../src/lib/schedule-appointments";

const tz = "America/Los_Angeles";
// Tue 2026-11-17, 8:20 AM PT.
const at = (hhmm: string, day = "2026-11-17") => new Date(`${day}T${hhmm}:00-08:00`);
const base = {
  now: at("08:20"),
  timeZone: tz,
  sendHour: 8,
  active: true,
  hasIphone: true,
  dueToday: true,
  logTimes: [] as string[],
  iphones: [] as { lastSeenAt: string | null; lastRunAt: string | null }[],
  birthdayClaims: [] as { claimedAt: string }[],
  broadcastClaims: [] as { claimedUntil: string | null }[],
};

assert.equal(shortcutBatchSize(null), 0);
assert.equal(shortcutBatchSize(""), 0);
assert.equal(shortcutBatchSize("8"), 8);
assert.equal(shortcutBatchSize("0"), 0);
assert.equal(shortcutBatchSize("8.5"), 0);
assert.equal(shortcutBatchSize("999"), 40);
assert.deepEqual(catchUpClockLabels(8), ["8:00 AM", "8:30 AM", "9:00 AM"]);
assert.deepEqual(catchUpClockLabels(11), ["11:00 AM", "11:30 AM", "12:00 PM"]);
assert.deepEqual(catchUpClockLabels(15), ["3:00 PM", "3:30 PM", "4:00 PM"]);

const now = at("08:20");
assert.equal(leaseCanTake(null, null, "dev", now), true, "never leased");
assert.equal(leaseCanTake("other", at("08:30").toISOString(), "dev", now), false, "live lease is someone else's");
assert.equal(leaseCanTake("dev", at("08:30").toISOString(), "dev", now), true, "this device may refresh its own lease");
assert.equal(leaseCanTake("other", at("08:00").toISOString(), "dev", now), true, "an expired lease can be taken");

assert.equal(
  birthdayClaimDecision({ claimedAt: at("08:10").toISOString(), todayIso: "2026-11-17", now, timeZone: tz }),
  "hold",
);
assert.equal(
  birthdayClaimDecision({ claimedAt: at("08:00").toISOString(), todayIso: "2026-11-17", now, timeZone: tz }),
  "reoffer",
);
assert.equal(
  birthdayClaimDecision({ claimedAt: at("08:00", "2026-11-16").toISOString(), todayIso: "2026-11-17", now, timeZone: tz }),
  "expire",
);
assert.equal(CLAIM_MINUTES, 15);
assert.equal(MORNING_GRACE_MINUTES, 20);

const status = (over: Partial<typeof base>) => morningRunStatus({ ...base, ...over });
assert.equal(status({ now: at("07:30") }).kind, "hidden", "before the send hour");
assert.equal(status({ active: false }).kind, "hidden");
assert.equal(status({ hasIphone: false }).kind, "hidden");
assert.equal(
  status({ iphones: [{ lastSeenAt: at("08:00").toISOString(), lastRunAt: null }], now: at("08:10") }).kind,
  "pending",
  "a fetch still inside the claim window stays quiet",
);
assert.equal(
  status({ iphones: [{ lastSeenAt: at("08:00").toISOString(), lastRunAt: at("07:00", "2026-11-16").toISOString() }] }).kind,
  "unfinished",
);
assert.equal(status({ iphones: [{ lastSeenAt: at("08:00").toISOString(), lastRunAt: at("07:00", "2026-11-16").toISOString() }] }).lead, "This morning's texts were fetched but not sent.");
assert.match(status({ birthdayClaims: [{ claimedAt: at("08:00").toISOString() }] }).action, /Send Reminders Now/);
assert.equal(
  status({
    iphones: [{ lastSeenAt: at("08:00").toISOString(), lastRunAt: at("08:02").toISOString() }],
    logTimes: [at("08:01").toISOString()],
  }).kind,
  "hidden",
  "acks after the fetch mean it finished",
);
assert.equal(status({ birthdayClaims: [{ claimedAt: at("08:00").toISOString() }] }).kind, "unfinished");
assert.equal(status({ birthdayClaims: [{ claimedAt: at("08:10").toISOString() }], now: at("08:20") }).kind, "pending");
assert.equal(status({ birthdayClaims: [{ claimedAt: at("08:00", "2026-11-16").toISOString() }], dueToday: false }).kind, "hidden", "yesterday's birthday claim is not this morning");
assert.equal(
  status({ broadcastClaims: [{ claimedUntil: at("08:15").toISOString() }] }).kind,
  "unfinished",
  "a broadcast lease that expired with no ack",
);
assert.equal(status({ broadcastClaims: [{ claimedUntil: at("08:40").toISOString() }] }).kind, "pending");
assert.equal(status({ now: at("08:25"), dueToday: true }).kind, "missed");
assert.equal(status({ now: at("08:25"), dueToday: true }).lead, "This morning's texts have not gone out.");
assert.equal(status({ now: at("08:10"), dueToday: true }).kind, "hidden", "too soon to call a silent morning missed");
assert.equal(status({ now: at("09:00"), dueToday: false }).kind, "hidden", "nothing was due");

const settings: SmsReminderSettings = { ...defaultSmsReminderSettings(), enabled: true, dryRun: false, runDays: [0, 1, 2, 3, 4, 5, 6], birthdayTexts: false };
const patient = { id: "p1", fullName: "Ann Sample", phone: "8175550101", dob: "1990-01-01", textRemindersOff: false } as PatientRecord;
const appt = (date: string, startTime: string): ScheduleAppointmentRecord => ({
  id: "a1", patientId: "p1", patientName: "Ann Sample", provider: "", location: "", appointmentType: "Adjustment",
  caseLabel: "", room: "", date, startTime, durationMin: 15, status: "Scheduled", note: "", overrideOfficeHours: false,
});
const due = (appointments: ScheduleAppointmentRecord[], extra: Partial<SmsReminderSettings> = {}) =>
  morningWorkDue({
    now: at("08:20"),
    settings: { ...settings, ...extra },
    officeHours: [],
    appointments,
    patients: [patient],
  });
assert.equal(due([appt("2026-11-18", "09:00")]), true, "tomorrow is a run day");
assert.equal(due([appt("2026-11-17", "09:30")]), true, "a visit still ahead at 8 AM");
assert.equal(due([appt("2026-11-17", "07:15")]), false, "a visit already past at 8 AM");
assert.equal(
  morningWorkDue({
    now: at("08:20"),
    settings: { ...settings, enabled: false, birthdayTexts: true },
    officeHours: [],
    appointments: [],
    patients: [{ ...patient, dob: "1990-11-17" }],
  }),
  true,
);

const queue = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
assert.ok(queue.indexOf("shortcutBatchSize") < queue.indexOf("claimReminders"), "the batch is cut before anything is claimed");
assert.match(queue, /reofferClaims: willSend/);
assert.match(queue, /!truncated/);
assert.match(readFileSync("src/lib/reminder-server.ts", "utf8"), /leaseCanTake/);
const sql = readFileSync("supabase/reminder_devices_send_now.sql", "utf8");
assert.match(sql, /c\.claimed_until < now\(\)/);
assert.match(sql, /c\.device_id = excluded\.device_id/);
assert.match(readFileSync("src/components/app-shell.tsx", "utf8"), /<ReminderMorningBanner/);
const banner = readFileSync("src/components/reminder-morning-banner.tsx", "utf8");
assert.doesNotMatch(banner, /localStorage\.setItem/);
assert.match(banner, /Send Reminders Now/);

const built = spawnSync("python3", ["tools/build-shortcuts.py", "send"], { encoding: "utf8" });
assert.equal(built.status, 0, built.stderr || built.stdout);

for (const [file, wfName, urlPart] of [
  ["Send-Reminders.shortcut", "Send Reminders", "format=shortcut&batch=5"],
  ["Send-Reminders-Now.shortcut", "Send Reminders Now", "format=shortcut&force=1&batch=5"],
] as const) {
  const raw = spawnSync("python3", ["-c", `
import json, plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
acts = []
for a in p["WFWorkflowActions"]:
    params = a.get("WFWorkflowActionParameters", {})
    ident = a["WFWorkflowActionIdentifier"]
    acts.append({"id": ident.split("is.workflow.actions.", 1)[-1], "key": params.get("WFDictionaryKey"), "url": params.get("WFURL"), "show": params.get("ShowWhenRun"), "cond": params.get("WFCondition"), "cmp": params.get("WFConditionalActionString"), "count": params.get("WFRepeatCount"), "delay": params.get("WFDelayTime")})
print(json.dumps({"name": p["WFWorkflowName"], "acts": acts}))
`, `public/shortcuts/${file}`], { encoding: "utf8" });
  assert.equal(raw.status, 0, raw.stderr);
  const parsed = JSON.parse(raw.stdout) as { name: string; acts: { id: string; key?: string; url?: string; show?: boolean; cond?: number; cmp?: string; count?: number; delay?: number }[] };
  assert.equal(parsed.name, wfName);
  const ids = parsed.acts.map((a) => a.id);
  assert.deepEqual(ids.filter((id) => id === "repeat.count").length, 2);
  assert.ok(ids.indexOf("repeat.count") < ids.indexOf("repeat.each"));
  assert.ok(ids.indexOf("conditional") < ids.indexOf("sendmessage"));
  assert.ok(ids.includes("exit"));
  const queueCall = parsed.acts.find((a) => a.id === "downloadurl" && String(a.url).includes("/queue"));
  assert.ok(queueCall && String(queueCall.url).includes(urlPart), String(queueCall?.url));
  const send = parsed.acts.find((a) => a.id === "sendmessage");
  assert.equal(send?.show, false, "Show When Run stays off");
  const iff = parsed.acts.find((a) => a.id === "conditional" && a.cond === 4);
  assert.equal(iff?.cmp, "yes");
  assert.equal(parsed.acts.find((a) => a.id === "repeat.count")?.count, 8);
  assert.equal(parsed.acts.find((a) => a.id === "delay")?.delay, 2);
}

console.log("reminder-claim-heal: all checks passed");

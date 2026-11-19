/**
 * Saved texts: old settings become rows, phone times don't repeat,
 * and a 9 AM birthday does not go out at 8 AM.
 * Run: npx tsx scripts/tests/text-rules.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { macSetupSteps, phoneStepsForClocks, readSetupPlatform } from "../../src/lib/iphone-setup";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { automationClocks, clockWords, dueScope, legacyRules, ruleWhen, withRules } from "../../src/lib/text-rules";

const base = defaultSmsReminderSettings();

// Nothing configured yet stays an empty list. Nothing turns on by itself.
assert.deepEqual(legacyRules(base), []);
assert.equal(normalizeSmsReminderSettings({ enabled: true }).rules, null, "old settings stay on the old path until saved");

const moved = legacyRules({ ...base, enabled: true, templateId: "rem", sendHour: 8, birthdayTexts: true, birthdayTemplateId: "bday", birthdayHour: 8 });
assert.equal(moved.length, 2);
assert.equal(moved[0].on, true);
assert.equal(moved[1].kind, "birthday");
const off = legacyRules({ ...base, templateId: "rem", birthdayTemplateId: "bday" });
assert.equal(off.every((rule) => rule.on === false), true, "attached but off stays off");

const saved = withRules(base, [
  { id: "a", templateId: "rem", on: true, kind: "day-before", hour: 8 },
  { id: "b", templateId: "bday", on: true, kind: "birthday", hour: 9 },
]);
assert.equal(saved.enabled, true);
assert.equal(saved.sendHour, 8);
assert.equal(saved.templateId, "rem");
assert.equal(saved.birthdayTexts, true);
assert.equal(saved.birthdayHour, 9);
assert.equal(saved.birthdayTemplateId, "bday");
assert.equal(ruleWhen(saved.rules![1]), "Birthdays, 9:00 AM");

const roundTrip = normalizeSmsReminderSettings(saved);
assert.equal(roundTrip.rules?.length, 2);
assert.equal(roundTrip.birthdayHour, 9);

// 8:00 and 9:00, plus one catch-up an hour after the last. No half hours.
const clocks = automationClocks(saved.rules!);
assert.deepEqual(clocks.map((c) => clockWords(c.hour, c.minute)), ["8:00 AM", "9:00 AM", "10:00 AM"]);
assert.equal(clocks.length <= 3, true);
const same = automationClocks([
  { id: "a", templateId: "rem", on: true, kind: "day-before", hour: 8 },
  { id: "b", templateId: "bday", on: true, kind: "birthday", hour: 8 },
]);
assert.deepEqual(same.map((c) => clockWords(c.hour, c.minute)), ["8:00 AM", "9:00 AM"]);
const many = automationClocks([
  { id: "a", templateId: "rem", on: true, kind: "day-before", hour: 7 },
  { id: "b", templateId: "bday", on: true, kind: "birthday", hour: 9 },
  { id: "c", templateId: "rem", on: true, kind: "open-day", hour: 11 },
  { id: "d", templateId: "rem", on: true, kind: "hours-before", hour: 15 },
]);
assert.deepEqual(many.map((c) => clockWords(c.hour, c.minute)), ["7:00 AM", "3:00 PM", "4:00 PM"]);
assert.equal(many.length, 3, "never more than 3 time automations");

const built = phoneStepsForClocks(clocks);
const steps = built.map((step) => step.text.replace(/\*\*/g, ""));
assert.equal(steps[0], "Tap Add to this Device.");
assert.equal(steps[1], "Tap Add Shortcut.");
assert.deepEqual(built[2].lines, [
  "Open **Shortcuts**.",
  "Tap **Automation**.",
  "Tap **+**.",
  "Tap **Time of Day**.",
  "Set **8:00 AM**.",
  "Tap **Every Day**.",
  "Tap **Run Immediately**.",
  "Turn **Notify When Run** off.",
  "Tap **Next**.",
  "Tap **NoteGoat**.",
  "Tap **Done**.",
]);
assert.equal(steps[3], "Same as step 3, but set 9:00 AM.");
assert.equal(steps[4], "Same as step 3, but set 10:00 AM.");
assert.ok(built[5].lines?.includes("Type **STOP**."));
assert.equal(steps[6], "Tap Test.");
assert.equal(steps.length, 7);
assert.equal(steps.some((step) => step.includes("8:30")), false);

assert.equal(readSetupPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 0), "iphone");
assert.equal(readSetupPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), "mac");
assert.equal(readSetupPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), "iphone", "iPadOS reports as a Mac with touch");
const mac = macSetupSteps(clocks);
const macLines = mac.flatMap((step) => step.lines ?? [step.text]);
assert.equal(macLines[0], "Click **Add to this Device**.");
assert.ok(macLines.includes("Click **Time of Day**."));
assert.ok(macLines.includes("Click **Daily**."));
assert.ok(macLines.some((line) => line.includes("If you do not see **Message**")));
assert.equal(macLines[macLines.length - 1], "Click **Test**.");
assert.equal(macLines.some((line) => line.includes("Tap ")), false, "Mac steps use the words on a Mac");

// Friday 8:00 AM Pacific, office closed Fridays, not a Key Date.
const friday8 = new Date("2026-11-20T16:00:00Z");
const hours = [
  { dayOfWeek: 1, enabled: true },
  { dayOfWeek: 2, enabled: true },
  { dayOfWeek: 3, enabled: true },
  { dayOfWeek: 4, enabled: true },
  { dayOfWeek: 5, enabled: false },
];
const openOnly = dueScope({
  rules: [{ id: "o", templateId: "rem", on: true, kind: "open-day", hour: 8 }],
  now: friday8,
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(openOnly.today, false, "a closed Friday is not an open day");
assert.equal(openOnly.tomorrow, false);

const monday8 = new Date("2026-11-16T16:00:00Z");
const monday = dueScope({
  rules: [{ id: "o", templateId: "rem", on: true, kind: "open-day", hour: 8 }],
  now: monday8,
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(monday.today, true);
assert.equal(monday.tomorrow, false);

const closedMonday = dueScope({
  rules: [{ id: "o", templateId: "rem", on: true, kind: "open-day", hour: 8 }],
  now: monday8,
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(["2026-11-16"]),
});
assert.equal(closedMonday.today, false, "a Key Date closure wins");

const noHours = dueScope({
  rules: [{ id: "o", templateId: "rem", on: true, kind: "open-day", hour: 8 }],
  now: monday8,
  timeZone: "America/Los_Angeles",
  officeHours: [],
  closedIsoDates: new Set(),
});
assert.equal(noHours.today, false, "no office hours means not open");

const at8 = dueScope({
  rules: saved.rules!,
  now: friday8,
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(at8.today, true);
assert.equal(at8.tomorrow, true);
assert.equal(at8.birthday, false, "9 AM birthdays wait");
assert.equal(at8.limitTomorrowToNow, false);

const at9 = dueScope({
  rules: saved.rules!,
  now: new Date("2026-11-20T17:00:00Z"),
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(at9.birthday, true);

const within = dueScope({
  rules: [{ id: "h", templateId: "rem", on: true, kind: "hours-before", hour: 8 }],
  now: friday8,
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(within.today, true);
assert.equal(within.tomorrow, true);
assert.equal(within.limitTomorrowToNow, true);

const early = dueScope({
  rules: saved.rules!,
  now: new Date("2026-11-20T15:00:00Z"),
  timeZone: "America/Los_Angeles",
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(early.today, false, "before 8 AM nothing is due");
assert.equal(early.birthday, false);

const queue = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
assert.match(queue, /dueScope/);
assert.match(queue, /notAfter/);
assert.match(readFileSync("src/lib/reminder-automation.ts", "utf8"), /notAfter/);

console.log("text-rules: all checks passed");

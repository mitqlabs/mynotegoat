/**
 * Named shortcuts: one template, one send time, one Time of Day automation.
 * The old NoteGoat shortcut (no rule id) still sends every due rule.
 * Run: npx tsx scripts/tests/shortcut-rules.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { oneShortcutLines, stopCatcherLines } from "../../src/lib/iphone-setup";
import { buildNamedShortcut } from "../../src/lib/shortcut-plist";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import {
  clockWords,
  ensureShortcutNames,
  legacyRules,
  normalizeShortcutRuns,
  pickRuleQueue,
  shortcutName,
  shortcutStatusText,
  withRules,
} from "../../src/lib/text-rules";

const base = defaultSmsReminderSettings();
const hours = [
  { dayOfWeek: 1, enabled: true },
  { dayOfWeek: 2, enabled: true },
  { dayOfWeek: 3, enabled: true },
  { dayOfWeek: 4, enabled: true },
  { dayOfWeek: 5, enabled: false },
];
const friday8 = new Date("2026-11-20T16:00:00Z");
const monday8 = new Date("2026-11-16T16:00:00Z");

const birthday = { id: "birthday", templateId: "bday", on: true, kind: "birthday" as const, hour: 9 };
const dayBefore = { id: "reminder", templateId: "rem", on: true, kind: "day-before" as const, hour: 8 };
const openDay = { id: "open", templateId: "rem", on: true, kind: "open-day" as const, hour: 8 };
const within = { id: "soon", templateId: "rem", on: true, kind: "hours-before" as const, hour: 8 };

assert.equal(shortcutName(birthday), "NoteGoat – Birthdays 9 AM");
assert.equal(shortcutName(dayBefore), "NoteGoat – Day Before 8 AM");
assert.equal(shortcutName(openDay), "NoteGoat – Open Days 8 AM");
assert.equal(shortcutName(within), "NoteGoat – 24 Hours Before 8 AM");

const moved = ensureShortcutNames(withRules(base, legacyRules({ ...base, enabled: true, templateId: "rem", sendHour: 8, birthdayTexts: false, birthdayTemplateId: "bday" })));
assert.equal(moved.rules?.[0].on, true);
assert.equal(moved.rules?.[0].shortcutName, "NoteGoat – Day Before 8 AM");
const off = ensureShortcutNames(withRules(base, legacyRules({ ...base, templateId: "rem", birthdayTemplateId: "bday" })));
assert.equal(off.rules?.every((rule) => rule.on === false), true, "migration does not turn a rule on");
assert.equal(off.rules?.find((rule) => rule.kind === "birthday")?.shortcutName, "NoteGoat – Birthdays 8 AM");
assert.equal(ensureShortcutNames(moved), moved, "naming twice does not rewrite settings");

const roundTrip = normalizeSmsReminderSettings(moved);
assert.equal(roundTrip.rules?.[0].shortcutName, "NoteGoat – Day Before 8 AM");
assert.equal(normalizeSmsReminderSettings({ rules: [{ id: "x", kind: "birthday", hour: 9, on: true, templateId: "b", shortcutName: "NoteGoat – Birthdays 9 AM" }] }).rules?.[0].shortcutName, "NoteGoat – Birthdays 9 AM");

const runs = normalizeShortcutRuns({
  birthday: { at: "2026-11-18T17:05:00Z", status: "ok", summary: "2 birthday text(s)" },
  soon: { at: "2026-11-18T16:00:00Z", status: "error", summary: "Did not send" },
  bad: { status: "maybe" },
});
assert.equal(Object.keys(runs).join(","), "birthday,soon");
assert.equal(shortcutStatusText({ on: true }, runs.birthday, "America/Los_Angeles"), "Last run 11/18/26 9:05 AM. OK");
assert.equal(shortcutStatusText({ on: true }, runs.soon, "America/Los_Angeles"), "Last run 11/18/26 8:00 AM. Didn't connect. Tap Add to this Device again.");
assert.equal(shortcutStatusText({ on: true }, undefined, "America/Los_Angeles"), "Not run yet");
assert.equal(shortcutStatusText({ on: false }, runs.birthday, "America/Los_Angeles"), "Off");

const templates = [
  { id: "bday", body: "Happy birthday {first name}" },
  { id: "rem", body: "See you {appt time}" },
];
const saved = withRules(base, [birthday, dayBefore, openDay, within]);

const at9 = pickRuleQueue({ ruleId: "birthday", settings: saved, templates, now: new Date("2026-11-20T17:00:00Z"), officeHours: hours, closedIsoDates: new Set() });
assert.equal(at9.rule?.id, "birthday");
assert.equal(at9.scope.birthday, true);
assert.equal(at9.scope.today, false, "a birthday shortcut does not send visit texts");
assert.equal(at9.birthdayBody, "Happy birthday {first name}");
assert.equal(at9.templateBody, "");

const tooEarly = pickRuleQueue({ ruleId: "birthday", settings: saved, templates, now: friday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(tooEarly.scope.birthday, false, "9 AM birthdays wait");

const visits = pickRuleQueue({ ruleId: "reminder", settings: saved, templates, now: friday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(visits.scope.today, true);
assert.equal(visits.scope.tomorrow, true);
assert.equal(visits.scope.birthday, false);
assert.equal(visits.scope.limitTomorrowToNow, false);
assert.equal(visits.templateBody, "See you {appt time}");

const closedFriday = pickRuleQueue({ ruleId: "open", settings: saved, templates, now: friday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(closedFriday.scope.today, false, "Friday is not an open business day");
const closedKeyDate = pickRuleQueue({ ruleId: "open", settings: saved, templates, now: monday8, officeHours: hours, closedIsoDates: new Set(["2026-11-16"]) });
assert.equal(closedKeyDate.scope.today, false, "a Key Date closure wins");
const openMonday = pickRuleQueue({ ruleId: "open", settings: saved, templates, now: monday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(openMonday.scope.today, true);

const soon = pickRuleQueue({ ruleId: "soon", settings: saved, templates, now: friday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(soon.scope.limitTomorrowToNow, true, "24 hours before stays inside the next day");
assert.equal(soon.scope.birthday, false);

const missing = pickRuleQueue({ ruleId: "gone", settings: saved, templates, now: friday8, officeHours: hours, closedIsoDates: new Set() });
assert.equal(missing.rule, null);
assert.equal(missing.scope.today, false);
assert.equal(missing.scope.tomorrow, false);
assert.equal(missing.scope.birthday, false);

const turnedOff = pickRuleQueue({
  ruleId: "birthday",
  settings: withRules(base, [{ ...birthday, on: false }]),
  templates,
  now: new Date("2026-11-20T17:00:00Z"),
  officeHours: hours,
  closedIsoDates: new Set(),
});
assert.equal(turnedOff.scope.birthday, false, "an off shortcut sends nothing");

const lines = oneShortcutLines("iphone", "NoteGoat – Birthdays 9 AM", clockWords(9));
assert.deepEqual(lines, [
  "Tap **Add Shortcut**.",
  "Open **Shortcuts**.",
  "Tap **Automation**.",
  "Tap **+**.",
  "Tap **Time of Day**.",
  "Set **9:00 AM**.",
  "Tap **Every Day**.",
  "Tap **Run Immediately**.",
  "Turn **Notify When Run** off.",
  "Tap **Next**.",
  "Tap **\"NoteGoat – Birthdays 9 AM\"**.",
  "Tap **Done**.",
]);
assert.equal(lines.filter((line) => line.includes("9:00 AM")).length, 1, "only one time");
assert.equal(lines.some((line) => /STOP|Test|8:30|catch/i.test(line)), false, "no STOP and no second time");
assert.equal(lines.every((line) => line.split("**").length <= 3 || line.startsWith("Turn")), true);
const mac = oneShortcutLines("mac", "NoteGoat – Birthdays 9 AM", "9:00 AM");
assert.ok(mac[0].startsWith("Click "));
assert.ok(mac.includes("Click **Daily**."));
assert.ok(mac.includes("Click **\"NoteGoat – Birthdays 9 AM\"**."));
const stop = stopCatcherLines("iphone");
assert.ok(stop.includes("Type **STOP**."));
assert.ok(stop.includes("Tap **NoteGoat**."));
assert.equal(stopCatcherLines("mac").some((line) => line.includes("Message")), true);

const token = `ngr_${"ab".repeat(32)}`;
const file = buildNamedShortcut({ token, name: "NoteGoat – Birthdays 9 AM", ruleId: "birthday", origin: "https://www.mynotegoat.com" });
assert.match(file, /NoteGoat – Birthdays 9 AM/);
assert.match(file, /format=shortcut&amp;force=1&amp;batch=5&amp;rule=birthday/);
assert.ok(file.includes(token));
assert.equal(file.includes("STOP TEST"), false, "the named shortcut does not catch STOP");
assert.match(file, /\/api\/reminders\/ack/);
const parsed = spawnSync("python3", ["-c", "import plistlib,sys; plistlib.loads(sys.stdin.buffer.read())"], { input: file });
assert.equal(parsed.status, 0, parsed.stderr.toString());

const queue = readFileSync("src/app/api/reminders/queue/route.ts", "utf8");
assert.match(queue, /params\.get\("rule"\)/);
assert.match(queue, /pickRuleQueue/);
assert.match(queue, /dueScope\(\{\s*rules: settings\.rules/);
assert.match(queue, /loadBroadcastQueue/);
assert.match(queue, /recordShortcutRun/);
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
assert.match(panel, /ensureShortcutNames/);
assert.match(panel, /mode="stop"/);
assert.match(readFileSync("src/components/sms-templates-section.tsx", "utf8"), /title="SMS Templates"/);
assert.match(readFileSync("src/components/create-shortcut-section.tsx", "utf8"), /title="Create Shortcut"/);
for (const file of ["src/components/create-shortcut-section.tsx", "src/components/sms-templates-section.tsx"]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /iPhone|the phone|your phone|this phone/, file);
}

console.log("shortcut-rules: all checks passed");

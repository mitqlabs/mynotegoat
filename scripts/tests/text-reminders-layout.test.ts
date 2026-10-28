import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fmtDate,
  fmtDateTime,
  fmtDay,
  fmtRunSummary,
  officeMacSeen,
  queuedStatusText,
  reminderSetupDone,
  runSummary,
  sectionOpen,
  sentFromText,
  summaryAfterEmptyRun,
} from "../../src/lib/reminder-format";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { reminderPageHelp } from "../../src/lib/goat-reminders-help";

// Dates are mm/dd/yy.
assert.equal(fmtDate("2026-10-29"), "10/29/26");
assert.equal(fmtDate("2026-01-05"), "01/05/26");
assert.equal(fmtDate("not a date"), "not a date");
assert.equal(fmtDate(null), "");
assert.equal(fmtDateTime("2026-10-28T16:05:00Z", "America/Los_Angeles"), "10/28/26 9:05 AM");
assert.equal(fmtDateTime("2026-10-29T01:30:00Z", "America/Los_Angeles"), "10/28/26 6:30 PM");
assert.equal(fmtDateTime(null), "never");
assert.equal(fmtDay("2026-10-28T16:05:00Z", "America/Los_Angeles"), "10/28/26");
assert.equal(fmtRunSummary("2026-10-29: 1 sent"), "10/29/26: 1 sent");
assert.equal(fmtRunSummary("2026-10-29: nothing to send"), "10/29/26: nothing to send");
assert.equal(fmtRunSummary(null), "");

// Run summary is the day's total, e.g. "10/29/26: 14 sent".
assert.equal(runSummary("2026-10-29", { sent: 14, failed: 0, dryRun: 0 }), "2026-10-29: 14 sent");
assert.equal(fmtRunSummary(runSummary("2026-10-29", { sent: 14, failed: 0, dryRun: 0 })), "10/29/26: 14 sent");
assert.equal(runSummary("2026-10-29", { sent: 3, failed: 1, dryRun: 2 }), "2026-10-29: 3 sent, 1 failed, 2 dry-run");
// A later empty poll keeps the real totals, but replaces an unrelated or empty summary.
assert.equal(summaryAfterEmptyRun("2026-10-29: 14 sent", "2026-10-29"), "2026-10-29: 14 sent");
assert.equal(summaryAfterEmptyRun("2026-10-28: 14 sent", "2026-10-29"), "2026-10-29: nothing to send");
assert.equal(summaryAfterEmptyRun("2026-10-29: nothing to send", "2026-10-29"), "2026-10-29: nothing to send");
assert.equal(summaryAfterEmptyRun(null, "2026-10-29"), "2026-10-29: nothing to send");
// The ack route totals the day from the log (not the single request) and the queue route keeps totals.
const ack = readFileSync("src/app/api/reminders/ack/route.ts", "utf8");
assert.match(ack, /from\("reminder_log"\)[\s\S]{0,200}count: "exact"[\s\S]{0,300}\.eq\("visit_date", visitDate\)/, "ack counts the day from the log");
assert.match(readFileSync("src/app/api/reminders/queue/route.ts", "utf8"), /summaryAfterEmptyRun\(device\.last_run_summary, visitDate\)/);

// The iMac is named only for an active, non-revoked Mac that has been seen.
const dev = (o: Partial<{ kind: string; revoked_at: string | null; last_seen_at: string | null; last_run_at: string | null }>) => ({
  kind: "mac", revoked_at: null, last_seen_at: null, last_run_at: null, ...o,
});
assert.equal(officeMacSeen([]), false);
assert.equal(officeMacSeen([dev({})]), false, "a Mac that never checked in");
assert.equal(officeMacSeen([dev({ last_seen_at: "2026-10-28T10:00:00Z", revoked_at: "2026-10-28T11:00:00Z" })]), false, "revoked");
assert.equal(officeMacSeen([dev({ kind: "iphone", last_seen_at: "2026-10-28T10:00:00Z" })]), false, "an iPhone is not a Mac");
assert.equal(officeMacSeen([dev({ last_seen_at: "2026-10-28T10:00:00Z" })]), true);
assert.doesNotMatch(queuedStatusText(30, false, false), /iMac/);
assert.match(queuedStatusText(30, false, false), /Run "Send Reminders Now" on your iPhone/);
assert.match(queuedStatusText(30, false, true), /iMac also sends it automatically within about 10 minutes/);
assert.match(queuedStatusText(30, true, true), /Dry run is on/);
assert.equal(sentFromText(false), "your iPhone");
assert.equal(sentFromText(true), "your iPhone or iMac");
const composer = readFileSync("src/components/message-patients-composer.tsx", "utf8");
assert.doesNotMatch(composer, /The iMac sends it automatically/);
assert.match(composer, /macConnected = false/, "iMac text is off unless a Mac has been seen");

// Set up is collapsed by default only when the box is ticked AND a device has run.
const run = dev({ kind: "iphone", last_run_at: "2026-10-28T15:00:00Z" });
assert.equal(reminderSetupDone(true, [run]), true);
assert.equal(reminderSetupDone(false, [run]), false);
assert.equal(reminderSetupDone(true, [dev({ kind: "iphone" })]), false, "no device has run");
assert.equal(reminderSetupDone(true, [{ ...run, revoked_at: "2026-10-28T16:00:00Z" }]), false, "revoked devices don't count");
assert.equal(sectionOpen({}, "setup", true), true);
assert.equal(sectionOpen({}, "setup", false), false);
assert.equal(sectionOpen({ setup: true }, "setup", false), true, "a saved choice beats the default");
assert.equal(sectionOpen({ texts: false }, "texts", true), false);
assert.equal(sectionOpen(undefined, "sends", true), true);

// Open/closed state lives in the cloud-backed settings and survives normalize.
assert.deepEqual(defaultSmsReminderSettings().sections, {});
const saved = normalizeSmsReminderSettings({ sections: { setup: true, texts: false, messages: "yes", bogus: true, sends: false } });
assert.deepEqual(saved.sections, { setup: true, texts: false, sends: false });
assert.deepEqual(normalizeSmsReminderSettings({ sections: "x" }).sections, {});
assert.deepEqual(normalizeSmsReminderSettings(null).sections, {});
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
assert.match(panel, /update\(\{ sections: \{ \.\.\.settings\.sections, \[key\]: open \} \}\)/, "toggles save through update() -> cloud settings");
assert.match(panel, /dualWriteKv\(SMS_REMINDER_SETTINGS_KEY/);
assert.doesNotMatch(panel, /localStorage\.setItem\([^)]*section/i, "no localStorage-only section state");
for (const id of ["section-setup", "section-texts", "recent-sends"]) assert.match(panel, new RegExp(`testId="${id}"`));
assert.match(composer, /testId="recent-messages"/);
// Layout: the warning sits outside Set up; the checklist, devices, shortcuts and opt-out are inside it; send settings, composer and Recent sends are in Texts.
const iWarn = panel.indexOf("<AutomationWarning");
const iSetup = panel.indexOf('testId="section-setup"');
const iTexts = panel.indexOf('testId="section-texts"');
assert.ok(iWarn > 0 && iWarn < iSetup && iSetup < iTexts, "warning, Set up, Texts in that order");
const inSetup = panel.slice(iSetup, iTexts);
for (const needle of ["<ReminderSetupChecklist", "Sending devices", "How it works", "Two shortcuts on the iPhone", 'data-testid="opt-out-settings"', 'data-testid="iphone-steps"', 'data-testid="mac-steps"'])
  assert.ok(inSetup.includes(needle), `Set up contains ${needle}`);
const inTexts = panel.slice(iTexts);
for (const needle of ["Send reminders automatically", "Message template", "<MessagePatientsComposer", 'testId="recent-sends"'])
  assert.ok(inTexts.includes(needle), `Texts contains ${needle}`);
assert.ok(!inTexts.includes("Sending devices"), "devices are not in Texts");
// Every date on the page goes through the mm/dd/yy helpers.
assert.doesNotMatch(panel, /toLocale(Date|Time)?String/);
assert.doesNotMatch(panel, /\{row\.visit_date\}/);
assert.doesNotMatch(readFileSync("src/components/reminder-setup-checklist.tsx", "utf8"), /toLocale/);
assert.match(panel, /fmtRunSummary\(d\.last_run_summary\)/);

// G.O.A.T. answers layout / date questions and never edits anything.
const g = reminderPageHelp("where did the setup steps go on text reminders?");
assert.ok(g && /Set up/.test(g.text) && /mm\/dd\/yy/.test(g.text) && /10\/29\/26: 14 sent/.test(g.text));
assert.ok(reminderPageHelp("why does last run say 1 sent on the text reminders page"));
assert.equal(reminderPageHelp("what's the weather"), null);
assert.equal(reminderPageHelp("/note text reminders"), null);

console.log("text-reminders-layout: OK");

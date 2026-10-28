import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fmtDate,
  fmtDateTime,
  fmtDay,
  fmtRunSummary,
  devicesStatus,
  imacStatus,
  iphoneStatus,
  lastCheckedText,
  lastRunText,
  officeMacSeen,
  optOutSummary,
  queuedStatusText,
  reminderSetupDone,
  runSummary,
  sectionOpen,
  sentFromText,
  summaryAfterEmptyRun,
} from "../../src/lib/reminder-format";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { macSetupHelp, reminderPageHelp } from "../../src/lib/goat-reminders-help";

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
for (const needle of ["<ReminderSetupChecklist", "Sending devices", "How it works", "Send Reminders Now</b> (iPhone shortcut)", 'data-testid="opt-out-settings"', 'data-testid="iphone-steps"', 'data-testid="mac-steps"'])
  assert.ok(inSetup.includes(needle), `Set up contains ${needle}`);
const inTexts = panel.slice(iTexts);
for (const needle of ["Send reminders automatically", "Message template", "<MessagePatientsComposer", 'testId="recent-sends"'])
  assert.ok(inTexts.includes(needle), `Texts contains ${needle}`);
assert.ok(!inTexts.includes("Sending devices"), "devices are not in Texts");
// Every date on the page goes through the mm/dd/yy helpers.
assert.doesNotMatch(panel, /toLocale(Date|Time)?String/);
assert.doesNotMatch(panel, /\{row\.visit_date\}/);
assert.doesNotMatch(readFileSync("src/components/reminder-setup-checklist.tsx", "utf8"), /toLocale/);
assert.match(panel, /lastRunText\(d\.last_run_summary/);

// G.O.A.T. answers layout / date questions and never edits anything.
const g = reminderPageHelp("where did the setup steps go on text reminders?");
assert.ok(g && /Set up/.test(g.text) && /mm\/dd\/yy/.test(g.text) && /10\/29\/26: 14 sent/.test(g.text));
assert.ok(reminderPageHelp("why does last run say 1 sent on the text reminders page"));
assert.equal(reminderPageHelp("what's the weather"), null);
assert.equal(reminderPageHelp("/note text reminders"), null);


// ---- Set up cards: consistent, plain, one-line summaries, cloud-backed collapse state ----
assert.equal(lastCheckedText("2026-10-28T17:41:00Z", "America/Los_Angeles"), "Last checked 10/28/26 10:41 AM");
assert.equal(lastCheckedText(null), "Has not checked in yet");
assert.equal(lastRunText("2026-10-29: 14 sent", null), "Last run 10/29/26: 14 sent");
assert.equal(lastRunText(null, "2026-10-28T17:41:00Z"), "Last run 10/28/26 10:41 AM");
assert.equal(lastRunText(null, null), "");
assert.equal(optOutSummary(true, 0), "On · 0 opted out");
assert.equal(optOutSummary(false, 3), "Off · 3 opted out");
const named = (o: Partial<{ name: string; kind: string; is_primary: boolean; revoked_at: string | null; last_seen_at: string | null; last_run_at: string | null }>) => ({
  name: "Office iPhone", kind: "iphone", is_primary: true, revoked_at: null, last_seen_at: null, last_run_at: null, ...o,
});
assert.equal(devicesStatus([]).status, "todo");
assert.match(devicesStatus([]).summary, /Add iPhone/);
assert.equal(devicesStatus([named({})]).status, "todo", "added but never checked in");
const seenDev = named({ last_seen_at: "2026-10-28T17:41:00Z" });
assert.deepEqual(devicesStatus([seenDev], "America/Los_Angeles"), { status: "done", summary: "Office iPhone · Last checked 10/28/26 10:41 AM" });
assert.equal(devicesStatus([seenDev, named({ name: "Office iMac", kind: "mac", is_primary: false })]).summary.startsWith("2 devices"), true);
assert.equal(devicesStatus([named({ last_seen_at: "2026-10-28T17:41:00Z", revoked_at: "2026-10-28T18:00:00Z" })]).status, "todo", "revoked devices don't count");
assert.equal(iphoneStatus([seenDev]).status, "done");
assert.equal(iphoneStatus([]).status, "todo");
assert.equal(imacStatus([]).status, "optional");
assert.equal(imacStatus([named({ kind: "mac", last_seen_at: "2026-10-28T17:41:00Z" })]).status, "done");
const cardSections = normalizeSmsReminderSettings({ sections: { steps: false, devices: true, how: false, optout: true, iphone: false, imac: true, nope: true } });
assert.deepEqual(cardSections.sections, { steps: false, devices: true, how: false, optout: true, iphone: false, imac: true });
assert.equal(sectionOpen({}, "how", false), false);
for (const id of ["section-devices", "section-how", "section-optout", "section-iphone", "section-imac"]) assert.match(panel, new RegExp(`testId="${id}"`));
assert.match(panel, /setSection\("how", next\)/);
assert.match(panel, /sectionOpen\(settings\.sections, "how", false\)/, "How it works starts closed");
for (const k of ["optout", "iphone", "imac"]) assert.match(panel, new RegExp(`sectionOpen\\(settings\\.sections, "${k}", false\\)`), `${k} starts closed`);
// No duplicated "Two shortcuts" block; the shortcut notes live in How it works.
assert.doesNotMatch(panel, /Two shortcuts on the iPhone/);
assert.equal((panel.match(/How it works/g) ?? []).length >= 1, true);
// Device token: shown only after creating one, with Copy, Hide and a don't-share note.
assert.match(panel, /\{newToken && \(/);
for (const needle of ['data-testid="copy-device-token"', 'data-testid="hide-device-token"', "Do not share this code", "It will not be shown again"]) assert.ok(panel.includes(needle), needle);
assert.match(panel, /\+ Add iPhone[\s\S]{0,200}\+ Add Mac[\s\S]{0,400}testId="section-devices"/, "Add buttons sit in the Sending devices card header");
// iMac: the Sequoia "Not Opened" step is there, and the manual steps stay nested.
const iMac = panel.slice(panel.indexOf('testId="section-imac"'));
for (const needle of ['data-testid="mac-not-opened-step"', "Not Opened", "<b>Done</b>", "Privacy &amp; Security", "Open Anyway", 'testId="mac-steps-manual"', "<InnerFold"])
  assert.ok(iMac.includes(needle), `iMac setup contains ${needle}`);
assert.ok(iMac.indexOf("mac-not-opened-step") < iMac.indexOf("mac-steps-manual"), "Open Anyway step is before the Advanced fold");
// Same look everywhere: the page doesn't use tiny text for body copy.
assert.doesNotMatch(panel, /text-\[1\d?px\]|text-\[9px\]/);
assert.doesNotMatch(readFileSync("src/components/setup-card.tsx", "utf8"), /text-\[\d+px\]|text-lg|text-xl/);

// G.O.A.T. explains the macOS "Not Opened" / Open Anyway step.
const mh = macSetupHelp("the imac says Not Opened when I open the setup file");
assert.ok(mh && /Done/.test(mh.text) && /Privacy & Security/.test(mh.text) && /Open Anyway/.test(mh.text));
assert.ok(macSetupHelp("how do i set up the imac for text reminders"));
assert.equal(macSetupHelp("what's the weather"), null);
assert.equal(macSetupHelp("/note imac not opened"), null);
const pg = reminderPageHelp("where did the setup steps go on text reminders?");
assert.ok(pg && /Sending devices/.test(pg.text) && /How it works/.test(pg.text) && /iMac setup/.test(pg.text));

console.log("text-reminders-layout: OK");

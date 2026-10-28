/**
 * Is the 8 AM automation running? + G.O.A.T. reminders help. Mock data only.
 * Run: npx tsx scripts/tests/reminder-automation-health.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { automationHealth } from "../../src/lib/reminder-automation-health";
import { remindersHelp } from "../../src/lib/goat-reminders-help";
import { answerHowToFull } from "../../src/lib/goat-howto-handbook";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

const tz = "America/Los_Angeles";
// Wed 2026-10-28, 12:00 PDT (after the 8–10 AM window)
const now = new Date("2026-10-28T19:00:00Z");
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-07:00`).toISOString();
const base = { now, timeZone: tz, sendHour: 8, runDays: [0, 1, 2, 3, 4, 5, 6], deviceAddedAt: at("2026-10-01", "09:00"), hasDueReminders: () => true };

check("no log at all, reminders due → warns", () => {
  const h = automationHealth({ ...base, logTimes: [] });
  assert.equal(h.warn, true);
  assert.deepEqual(h.missed.slice(0, 2), ["2026-10-28", "2026-10-27"]);
});
check("sends near 8 AM → no warning", () => {
  const h = automationHealth({ ...base, logTimes: [at("2026-10-28", "08:00"), at("2026-10-27", "08:01"), at("2026-10-26", "08:00")] });
  assert.equal(h.warn, false);
});
check("manual afternoon sends don't count as automatic", () => {
  const h = automationHealth({ ...base, logTimes: [at("2026-10-28", "14:30"), at("2026-10-27", "15:00")] });
  assert.equal(h.warn, true);
});
check("only one missed day → no warning yet", () => {
  const h = automationHealth({ ...base, logTimes: [at("2026-10-27", "08:00"), at("2026-10-26", "08:00")] });
  assert.equal(h.warn, false);
  assert.deepEqual(h.missed.slice(0, 1), ["2026-10-28"]);
});
check("nothing due → nothing to judge, no warning", () => {
  const h = automationHealth({ ...base, logTimes: [], hasDueReminders: () => false });
  assert.equal(h.warn, false);
  assert.equal(h.judged.length, 0);
});
check("today isn't judged before the send window ends", () => {
  const early = new Date("2026-10-28T16:30:00Z"); // 9:30 AM PDT
  const h = automationHealth({ ...base, now: early, logTimes: [] });
  assert.equal(h.judged[0].date, "2026-10-27");
});
check("days before the device was added aren't judged", () => {
  const h = automationHealth({ ...base, deviceAddedAt: at("2026-10-27", "10:00"), logTimes: [] });
  assert.equal(h.warn, false);
});
check("non-run days are skipped", () => {
  const h = automationHealth({ ...base, runDays: [1, 2], logTimes: [] }); // Mon, Tue only
  assert.deepEqual(h.judged.slice(0, 2).map((j) => j.date), ["2026-10-27", "2026-10-26"]);
});
check("custom send hour 9 counts 9–11", () => {
  const h = automationHealth({ ...base, sendHour: 9, logTimes: [at("2026-10-28", "09:05"), at("2026-10-27", "09:05")] });
  assert.equal(h.warn, false);
});

// settings field
check("automationConfirmed defaults false and round-trips", () => {
  assert.equal(defaultSmsReminderSettings().automationConfirmed, false);
  const n = normalizeSmsReminderSettings({ automationConfirmed: true, automationConfirmedAt: "2026-10-27T10:00:00Z" });
  assert.equal(n.automationConfirmed, true);
  assert.equal(n.automationConfirmedAt, "2026-10-27T10:00:00Z");
  assert.equal(normalizeSmsReminderSettings({ automationConfirmed: "yes" }).automationConfirmed, false);
});

// G.O.A.T.
for (const q of [
  "reminders didn't send",
  "why didn't my reminders go out this morning",
  "the texts never went out automatically",
  "reminders are not sending",
]) {
  check(`goat trouble: ${q}`, () => {
    const r = remindersHelp(q, { sendHour: 8 });
    assert.ok(r, "no answer");
    assert.match(r!.text, /does NOT run by itself/);
    assert.match(r!.text, /Time of Day/);
    assert.match(r!.text, /Send-Reminders/);
    assert.match(r!.links[0].href, /chapter-text-reminders/);
  });
}
for (const q of ["how do I set up 8 AM reminders", "how do I set up the reminder automation", "how can I schedule the reminders on the iphone"]) {
  check(`goat setup: ${q}`, () => {
    const r = remindersHelp(q, { sendHour: 8 });
    assert.ok(r, "no answer");
    assert.match(r!.text, /Step 2 is required/);
    assert.match(r!.text, /8:00 AM/);
  });
}
check("goat uses the office's send hour", () => { assert.match(remindersHelp("reminders didn't send", { sendHour: 9 })!.text, /9:00 AM/); });
for (const q of ["who is coming in today", "how do I add a contact", "what notes does mock smith have", "how do I change the reminder wording"]) {
  check(`goat ignores: ${q}`, () => { assert.equal(remindersHelp(q), null); });
}

// Handbook
check("handbook how-to finds the reminders chapter", () => {
  const a = answerHowToFull("how do I set up the 8 AM reminder automation", { admin: true, manager: true });
  assert.ok(a.found, a.text);
  assert.match(a.text, /automation/i);
});
const hb = readFileSync("src/lib/handbook-content.ts", "utf8");
check("handbook says the shortcut does not run by itself", () => { assert.match(hb, /The shortcut does NOT run by itself/); });
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8") + readFileSync("src/components/reminder-setup-checklist.tsx", "utf8");
check("panel has the required step, checkbox and warning", () => {
  assert.match(panel, /does NOT run by itself/);
  assert.match(panel, /I created the \{time\} automation/);
  assert.match(panel, /may not be set up — see Step 2/);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optOutHowLabel, parseOptOutReply, phoneMatchKey, searchPatientsToOptOut, withOptOutLine } from "../../src/lib/reminder-automation";
import { optedOutSummary } from "../../src/lib/reminder-format";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";

for (const w of ["STOP", "stop", " Stop ", "STOP.", "stop!", "StopAll", "UNSUBSCRIBE", "End", "quit", '"STOP"']) {
  assert.equal(parseOptOutReply(w), "stop", w);
}
for (const w of ["START", " start ", "unstop"]) assert.equal(parseOptOutReply(w), "start", w);
for (const w of ["cancel", "CANCEL", "Can I cancel my 3pm?", "please stop texting me", "stopping by later", "", "STOP STOP", null, 5]) {
  assert.equal(parseOptOutReply(w), null, String(w));
}

assert.equal(phoneMatchKey("+1 (555) 010-0001"), "5550100001");
assert.equal(phoneMatchKey("5550100001"), "5550100001");
assert.equal(phoneMatchKey("15550100001"), phoneMatchKey("(555) 010-0001"));
assert.equal(phoneMatchKey("Jane Doe"), "");
assert.equal(phoneMatchKey("0100"), "");

const d = defaultSmsReminderSettings();
assert.equal(d.optOutLine, true);
assert.equal(d.optOutText, "Reply STOP to opt out.");
assert.equal(withOptOutLine("See you at 10.", d), "See you at 10. Reply STOP to opt out.");
assert.equal(withOptOutLine("Text STOP to quit.", d), "Text STOP to quit.");
assert.equal(withOptOutLine("See you.", { ...d, optOutLine: false }), "See you.");
assert.equal(withOptOutLine("", d), "");

const n = normalizeSmsReminderSettings({ optOutLine: false, optOutText: "  Text STOP to end.  " });
assert.equal(n.optOutLine, false);
assert.equal(n.optOutText, "Text STOP to end.");
assert.equal(normalizeSmsReminderSettings({}).optOutLine, true);
assert.equal(normalizeSmsReminderSettings({ optOutText: "  " }).optOutText, "Reply STOP to opt out.");
const people = [
  { id: "1", fullName: "Doe, Jane", phone: "817-555-0101", textRemindersOff: false },
  { id: "2", fullName: "Roe, John", phone: "817-555-0199", textRemindersOff: true },
  { id: "3", fullName: "Smith, Ann", phone: "214-555-0101", textRemindersOff: false, deleted: true },
];
assert.deepEqual(searchPatientsToOptOut(people, "j").map((p) => p.id), [], "too short");
assert.deepEqual(searchPatientsToOptOut(people, "jane").map((p) => p.id), ["1"]);
assert.deepEqual(searchPatientsToOptOut(people, "555-0199").map((p) => p.id), [], "already opted out");
assert.deepEqual(searchPatientsToOptOut(people, "214555").map((p) => p.id), [], "deleted");
assert.deepEqual(searchPatientsToOptOut(people, "0101").map((p) => p.id), ["1"]);
assert.equal(optOutHowLabel("iphone"), "Replied STOP");
assert.equal(optOutHowLabel("mac"), "Replied STOP");
assert.equal(optOutHowLabel("staff"), "Added by staff");
assert.equal(optOutHowLabel(null), "Added by staff");
assert.equal(optedOutSummary(3), "3 patients don't get texts");
assert.equal(optedOutSummary(1), "1 patient doesn't get texts");
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
const setup = panel.slice(panel.indexOf('testId="section-setup"'), panel.indexOf('testId="section-autotexts"'));
const afterBroadcast = panel.slice(panel.indexOf('testId="section-texts"'));
assert.ok(!setup.includes('data-testid="opt-out-list"'), "the list is not inside Set up");
assert.ok(setup.includes("optout-iphone-steps"), "Set up keeps the STOP phone steps");
assert.ok(afterBroadcast.indexOf('testId="section-opted-out"') > afterBroadcast.indexOf('title="Broadcast"'));
assert.match(panel, /placeholder="Add patient"/);
assert.match(panel, /action: "stop"/);
assert.match(panel, /source: "staff"/);
const sql = readFileSync("supabase/migrations/20261117210000_reminder_opt_out_staff_stop.sql", "utf8");
assert.match(sql, /action in \('stop', 'start'\)/);
assert.match(sql, /source = 'staff'/);
console.log("opt-out tests passed");

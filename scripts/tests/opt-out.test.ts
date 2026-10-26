import assert from "node:assert/strict";
import { parseOptOutReply, phoneMatchKey, withOptOutLine } from "../../src/lib/reminder-automation";
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
console.log("opt-out tests passed");

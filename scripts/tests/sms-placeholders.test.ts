import assert from "node:assert/strict";
import { expandTokens, todayUsDate } from "../../src/lib/sms-render";
import { DEFAULT_REMINDER_BODY, SMS_TOKENS } from "../../src/lib/sms-templates";

// Mock data only.
const ctx = { patient: { firstName: "Jane" }, appointment: { date: "10/19/2026", time: "2:30 PM", type: "Office Visit" }, today: "10/18/2026" };
assert.equal(expandTokens("{{APPT_DATE}}|{{TODAY}}|{{TIME}}", ctx), "10/19/2026|10/18/2026|2:30 PM");
assert.equal(expandTokens("{{DATE}}", ctx), "10/19/2026", "old {{DATE}} still = appointment date");
assert.equal(expandTokens("{{APPOINTMENT_TYPE}}", ctx), "Office Visit", "old type token still renders");

const tokens = SMS_TOKENS.map((t) => t.token);
assert.ok(tokens.includes("{{TODAY}}") && tokens.includes("{{APPT_DATE}}"));
assert.ok(!tokens.includes("{{DATE}}") && !tokens.includes("{{APPOINTMENT_TYPE}}"), "hidden from the list");
assert.ok(SMS_TOKENS.every((t) => t.label.length > 0));
assert.equal(SMS_TOKENS.find((t) => t.token === "{{TODAY}}")?.label, "Today's date");
assert.equal(SMS_TOKENS.find((t) => t.token === "{{APPT_DATE}}")?.label, "Appointment date");

assert.match(DEFAULT_REMINDER_BODY, /on \{\{APPT_DATE\}\} at \{\{TIME\}\}/);
assert.ok(!DEFAULT_REMINDER_BODY.includes("{{DATE}}"));

// 8 AM PT Sunday = 15:00Z; late-night PT stays on the PT date.
assert.equal(todayUsDate(new Date("2026-10-18T15:00:00Z")), "10/18/2026");
assert.equal(todayUsDate(new Date("2026-10-19T06:30:00Z")), "10/18/2026");
console.log("sms-placeholders: ok");

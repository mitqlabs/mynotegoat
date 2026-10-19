import assert from "node:assert/strict";
import { applyExternalValue, createDebouncer } from "../../src/lib/draft-field";
import { markLocalWrite, wasRecentlyWrittenLocally } from "../../src/lib/local-sync";
import { readFileSync } from "node:fs";
import { renderReminderText } from "../../src/lib/reminder-automation";
import { LEGACY_REMINDER_BODY, getDefaultSmsTemplates } from "../../src/lib/sms-templates";

// Mock data only. Regression: typing in the Text Reminders template box
// kept reverting because cloud echoes of each keystroke overwrote the field.

// 1. Outside values never replace what the user is typing.
const editing = { draft: "Hi {first}, see you tom", dirty: true, focused: true };
assert.deepEqual(applyExternalValue(editing, "Hi {first}, see"), editing, "stale echo ignored while focused");
assert.deepEqual(
  applyExternalValue({ ...editing, focused: false }, "Hi"),
  { ...editing, focused: false },
  "unsaved text kept even after blur",
);
assert.equal(applyExternalValue({ draft: "old", dirty: false, focused: false }, "new").draft, "new", "idle field takes outside updates");

// 2. Saves are debounced: one save per pause, with the latest text.
const saved: string[] = [];
const d = createDebouncer<string>((v) => saved.push(v), 800);
for (const v of ["H", "Hi", "Hi {", "Hi {first}"]) d.push(v);
assert.equal(saved.length, 0, "no save per keystroke");
d.flush();
assert.deepEqual(saved, ["Hi {first}"]);
d.push("x");
d.cancel();
d.flush();
assert.deepEqual(saved, ["Hi {first}"], "cancel drops pending");
void new Promise<void>((resolve) => {
  const t = createDebouncer<string>((v) => {
    assert.equal(v, "late");
    resolve();
  }, 20);
  t.push("early");
  t.push("late");
});

// 3. Local saves mark the key so realtime echoes are skipped.
markLocalWrite("casemate.sms-templates.v1");
assert.equal(wasRecentlyWrittenLocally("casemate.sms-templates.v1"), true);
const hook = readFileSync("src/hooks/use-sms-templates.ts", "utf8");
assert.match(hook, /markLocalWrite\(SMS_TEMPLATES_STORAGE_KEY\)/, "template saves guard against echoes");
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
assert.match(panel, /<DraftTextarea/, "template box uses the draft textarea");
assert.match(panel, /markLocalWrite\(SMS_REMINDER_SETTINGS_KEY\)/, "reminder settings saves guard against echoes");

console.log("sms-template-typing: ok");

// 4. {{DATE}}/{{TIME}} are the APPOINTMENT's date/time, and the default reminder text.
const text = renderReminderText(
  LEGACY_REMINDER_BODY,
  { appointmentId: "a", patientId: "p", patientName: "Doe, Jane", phone: "5550100", date: "2026-10-19", time: "14:30", appointmentType: "Office Visit" },
  undefined,
  { officeName: "Mock", doctorName: "Dr. Mock", phone: "5550199" },
);
assert.equal(
  text,
  "Hello Jane, just wanted to send over a reminder for your appointment on 10/19/2026 at 2:30 PM. For any questions feel free to contact us! Thank you!\n\n-Prime Spine & Wellness",
);
assert.ok(!/Office Visit/.test(text), "no appointment type");
assert.equal(getDefaultSmsTemplates().find((t) => /remind/i.test(t.name))?.body, LEGACY_REMINDER_BODY);
console.log("sms-template defaults: ok");

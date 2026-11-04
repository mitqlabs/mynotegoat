/**
 * Messages library + Auto Texts (mock data only).
 * Run: npx tsx scripts/tests/messages-auto-texts.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandTokens } from "../../src/lib/sms-render";
import { normalizeSmsTemplates, DEFAULT_REMINDER_BODY, type SmsTemplate } from "../../src/lib/sms-template-core";
import {
  AUTO_BIRTHDAY_MESSAGE_ID,
  AUTO_REMINDER_MESSAGE_ID,
  applyLiveEdit,
  autoTextsUsing,
  liveMessages,
  MESSAGE_WORDS,
  planAutoTextMigration,
  resolveBirthdayMessage,
  resolveReminderMessage,
  usesAppointmentWords,
} from "../../src/lib/message-library";
import { defaultSmsReminderSettings, DEFAULT_BIRTHDAY_MESSAGE, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import { pickBirthdayRecipients, renderBirthdayText } from "../../src/lib/birthday-texts";
import { unionMerge } from "../../src/lib/kv-merge";
import { UNION_MERGE_KEYS } from "../../src/lib/cloud-state";

const T0 = "2026-11-01T10:00:00.000Z";
const T1 = "2026-11-03T10:00:00.000Z";
const msg = (id: string, name: string, body: string, extra: Partial<SmsTemplate> = {}): SmsTemplate => ({ id, name, body, createdAt: T0, updatedAt: T0, ...extra });

// ---- friendly words ----
const ctx = {
  patient: { firstName: "Jane", lastName: "Doe", fullName: "Jane Doe" },
  appointment: { date: "11/04/26", time: "10:30 AM" },
  office: { officeName: "Mock Clinic", doctorName: "Dr. Mock", phone: "5550199" },
  today: "11/03/26",
};
assert.equal(expandTokens("Hi {first name}, see you {appt date} at {appt time}.", ctx), "Hi Jane, see you 11/04/26 at 10:30 AM.");
assert.equal(expandTokens("Hi {First_Name} {{FIRST_NAME}} {{ first name }}", ctx), "Hi Jane Jane Jane", "old and new spellings both work");
assert.equal(expandTokens("{{APPT_DATE}} {{TIME}} {{DATE}}", ctx), "11/04/26 10:30 AM 11/04/26", "old words keep working");
assert.equal(expandTokens("Call {office phone} - {office name} - {doctor name} - {today} - {full name} - {last name}", ctx), "Call 5550199 - Mock Clinic - Dr. Mock - 11/03/26 - Jane Doe - Doe");
assert.equal(expandTokens("Use {curly thing} and {{WHATEVER}} as typed", ctx), "Use {curly thing} and {{WHATEVER}} as typed", "unknown words are left alone");
for (const w of MESSAGE_WORDS) assert.notEqual(expandTokens(w.token, ctx), w.token, `${w.token} is understood`);
assert.ok(usesAppointmentWords("see you {appt time}") && usesAppointmentWords("on {{APPT_DATE}}") && !usesAppointmentWords("Happy birthday {first name}"));

// ---- saved messages: deleted markers survive normalizing ----
const normalized = normalizeSmsTemplates([{ id: "a", name: "A", body: "x", deleted: true }, { id: "b", name: "B", body: "y" }, { nope: 1 }]);
assert.equal(normalized.length, 2);
assert.equal(normalized[0].deleted, true);
assert.equal(normalized[1].deleted, undefined);
assert.deepEqual(liveMessages(normalized).map((t) => t.id), ["b"]);

// ---- applyLiveEdit: delete -> marker, add, revive, edit ----
const full = [msg("a", "A", "one"), msg("b", "B", "two"), msg("c", "C", "three", { deleted: true })];
const afterDelete = applyLiveEdit(full, [msg("a", "A", "one")], T1);
assert.equal(afterDelete.find((t) => t.id === "b")?.deleted, true, "removed message becomes a marker");
assert.equal(afterDelete.find((t) => t.id === "b")?.updatedAt, T1, "marker is newer so it wins when merged");
assert.equal(afterDelete.find((t) => t.id === "c")?.deleted, true, "old marker stays");
assert.equal(afterDelete.length, 3, "nothing is dropped");
const afterAdd = applyLiveEdit(full, [msg("a", "A", "one"), msg("b", "B", "two"), msg("n", "N", "new")], T1);
assert.equal(afterAdd.find((t) => t.id === "n")?.body, "new");
const revived = applyLiveEdit(full, [msg("a", "A", "one"), msg("b", "B", "two"), msg("c", "C", "back", { updatedAt: T1 })], T1);
assert.equal(revived.find((t) => t.id === "c")?.deleted, undefined, "a re-added message is live again");

// ---- the delete reaches another computer, a stale copy cannot bring it back ----
assert.ok(UNION_MERGE_KEYS.has("casemate.sms-templates.v1"), "library is merged, not overwritten");
const staleOtherComputer = [msg("a", "A", "one"), msg("b", "B", "two")];
const merged = unionMerge(afterDelete, staleOtherComputer) as SmsTemplate[];
assert.equal(merged.find((t) => t.id === "b")?.deleted, true, "newer delete marker wins over the stale copy");
const newOnOther = unionMerge(full, [msg("z", "Z", "made elsewhere")]) as SmsTemplate[];
assert.ok(newOnOther.some((t) => t.id === "z") && newOnOther.some((t) => t.id === "a"), "a message made on another computer is kept");

// ---- which message each Auto Text sends ----
const prodLike = [
  msg("hb", "Happy Birthday", "Happy birthday {{FIRST_NAME}}! Wishing you have an amazing day!"),
  msg("rv", "Review", "Please review us"),
  msg("ar", "Appointment Reminder", DEFAULT_REMINDER_BODY),
];
const s0 = defaultSmsReminderSettings();
assert.equal(resolveReminderMessage(s0, prodLike)?.id, "ar", "no attachment -> the reminder-named message");
assert.equal(resolveReminderMessage({ ...s0, templateId: "rv" }, prodLike)?.id, "rv", "attached one wins");
assert.equal(resolveReminderMessage({ ...s0, templateId: "gone" }, prodLike)?.id, "ar", "missing attachment falls back");
assert.equal(resolveReminderMessage({ ...s0, templateId: "rv" }, [msg("rv", "Review", "x", { deleted: true }), msg("ar", "Appointment Reminder", "y")])?.id, "ar", "deleted is never used");
assert.equal(resolveReminderMessage(s0, []), undefined);
const b0 = resolveBirthdayMessage(s0, prodLike);
assert.deepEqual(b0, { id: "hb", body: prodLike[0].body }, "birthday picks the saved Happy Birthday message");
assert.deepEqual(resolveBirthdayMessage({ ...s0, birthdayTemplateId: "rv" }, prodLike).id, "rv");
assert.deepEqual(resolveBirthdayMessage(s0, [prodLike[1]]), { id: null, body: DEFAULT_BIRTHDAY_MESSAGE }, "no birthday message -> the built-in wording");
assert.equal(resolveBirthdayMessage({ ...s0, birthdayMessage: "Cheers {first name}" }, prodLike).body, "Cheers {first name}", "an old custom wording is kept");
assert.deepEqual(autoTextsUsing("ar", { templateId: "ar", birthdayTemplateId: "ar" }), ["Reminders", "Birthday"]);
assert.deepEqual(autoTextsUsing("x", { templateId: "ar", birthdayTemplateId: "hb" }), []);

// ---- one-time attach (no switch changes, wording kept) ----
const plan = planAutoTextMigration(s0, prodLike, T1)!;
assert.deepEqual(plan.settingsPatch, { templateId: "ar", birthdayTemplateId: "hb" });
assert.equal(plan.addMessages.length, 0, "nothing new made when the wording already exists");
assert.equal(planAutoTextMigration({ ...s0, templateId: "ar", birthdayTemplateId: "hb" }, prodLike, T1), null, "already attached -> nothing to do");
const empty = planAutoTextMigration(s0, [], T1)!;
assert.deepEqual(empty.addMessages.map((m) => [m.id, m.body]), [[AUTO_REMINDER_MESSAGE_ID, DEFAULT_REMINDER_BODY], [AUTO_BIRTHDAY_MESSAGE_ID, DEFAULT_BIRTHDAY_MESSAGE]]);
assert.deepEqual(empty.settingsPatch, { templateId: AUTO_REMINDER_MESSAGE_ID, birthdayTemplateId: AUTO_BIRTHDAY_MESSAGE_ID });
const custom = planAutoTextMigration({ ...s0, birthdayMessage: "Cheers {first name}" }, [prodLike[2]], T1)!;
assert.equal(custom.addMessages.find((m) => m.id === AUTO_BIRTHDAY_MESSAGE_ID)?.body, "Cheers {first name}", "old custom birthday wording becomes a saved message");
assert.ok(!("enabled" in plan.settingsPatch) && !("birthdayTexts" in plan.settingsPatch), "never flips a switch");
// Two computers making the starter message end up with one copy (same id).
const both = unionMerge(empty.addMessages, empty.addMessages) as SmsTemplate[];
assert.equal(both.length, 2);

// ---- settings ----
assert.equal(defaultSmsReminderSettings().birthdayTemplateId, "");
assert.equal(normalizeSmsReminderSettings({ birthdayTemplateId: "hb", sections: { autotexts: false, library: true } }).birthdayTemplateId, "hb");
assert.equal(normalizeSmsReminderSettings({ sections: { autotexts: false, library: true } }).sections.autotexts, false);
assert.equal(normalizeSmsReminderSettings({ sections: { autotexts: false, library: true } }).sections.library, true);
assert.equal(normalizeSmsReminderSettings({ birthdayTemplateId: 5 }).birthdayTemplateId, "");

// ---- birthday text uses the attached message and all the words ----
const office = { officeName: "Mock Clinic", doctorName: "Dr. Mock", phone: "5550199" };
assert.equal(renderBirthdayText("Happy birthday {{FIRST_NAME}}! - {office name}", "SAMPLE, ANN", office), "Happy birthday Ann! - Mock Clinic");
assert.equal(renderBirthdayText("", "Ann Sample"), "Happy birthday, Ann! From all of us at Prime Spine.");
const picks = pickBirthdayRecipients(
  [{ patientId: "1", fullName: "Ann Sample", dob: "1990-11-03", phone: "5555550100", caseStatus: "Active" }],
  "2026-11-03",
  { birthdayMessage: resolveBirthdayMessage(s0, prodLike).body, optOutLine: false },
  office,
);
assert.equal(picks[0].text, "Happy birthday Ann! Wishing you have an amazing day!", "what goes out is the attached message");

// ---- wiring (source checks) ----
const server = readFileSync("src/lib/reminder-server.ts", "utf8");
assert.ok(/resolveReminderMessage\(settings, templates\)/.test(server) && /resolveBirthdayMessage\(settings, templates\)/.test(server), "queue picks messages with the shared resolver");
assert.ok(/birthdayBody/.test(server) && /body: config\.birthdayBody/.test(readFileSync("src/app/api/reminders/queue/route.ts", "utf8")), "queue sends the attached birthday message");
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
assert.ok(/planAutoTextMigration/.test(panel) && !/<MessagesLibraryPanel/.test(panel) && /<AutoTextRows/.test(panel) && /Edit messages in SMS \/ Text Templates/.test(panel));
const lib = readFileSync("src/components/messages-library-panel.tsx", "utf8");
assert.ok(/message-delete-blocked/.test(lib) && /appConfirm/.test(lib), "delete asks first and is blocked while in use");
const hook = readFileSync("src/hooks/use-sms-templates.ts", "utf8");
assert.ok(/applyLiveEdit/.test(hook) && /markLocalWrite\(SMS_TEMPLATES_STORAGE_KEY\)/.test(hook));
for (const f of ["src/components/auto-texts-panel.tsx", "src/components/messages-library-panel.tsx"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/localStorage\.setItem/.test(src) && !/text-\[\d+px\]|toLocale/.test(src), `${f}: no local-only saves, no tiny text, no locale dates`);
}
assert.ok(/Auto Texts/.test(readFileSync("src/lib/handbook-content.ts", "utf8")) && /Auto Texts/.test(readFileSync("src/lib/handbook-goat.ts", "utf8")), "both handbooks explain Auto Texts");

console.log("messages-auto-texts: all checks passed");

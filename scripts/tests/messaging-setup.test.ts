/**
 * Guided Reminders and Messaging setup.
 * Run: npx tsx scripts/tests/messaging-setup.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  automationFallbackLines,
  automationGuideLines,
  buildMessagingSteps,
  deviceCheckIn,
  messagingSetupComplete,
  orderedRuleIds,
  resumeStepId,
  shortcutFollowLines,
  shortcutRunUrl,
  shortcutsAppLines,
  startOverLines,
  testFollowLines,
  testShortcutName,
} from "../../src/lib/messaging-setup";
import { defaultSmsReminderSettings, emptyMessagingSetup, normalizeSmsReminderSettings } from "../../src/lib/sms-reminders";
import type { TextRule } from "../../src/lib/sms-reminders";
import { shortcutName } from "../../src/lib/text-rules";

const visits: TextRule = { id: "visits", templateId: "a", on: true, kind: "day-before", hour: 8, shortcutName: "NoteGoat – Day Before 8 AM" };
const birthday: TextRule = { id: "birthday", templateId: "b", on: true, kind: "birthday", hour: 9, shortcutName: shortcutName({ kind: "birthday", hour: 9 }) };
const rules = [birthday, visits];

const fresh = buildMessagingSteps({ redo: false, ruleIds: ["visits"] });
assert.deepEqual(fresh.map((step) => step.kind), ["device", "add-device", "shortcuts-app", "pick", "shortcut", "automation", "test"]);
assert.equal(fresh[0].id, "device");
assert.equal(fresh.find((step) => step.kind === "start-over"), undefined);

const again = buildMessagingSteps({ redo: true, ruleIds: orderedRuleIds(rules, ["birthday", "visits", "missing"]) });
assert.deepEqual(again.map((step) => step.id), [
  "device",
  "start-over",
  "add-device",
  "shortcuts-app",
  "pick",
  "shortcut:visits",
  "automation:visits",
  "shortcut:birthday",
  "automation:birthday",
  "test",
]);
assert.deepEqual(orderedRuleIds(rules, ["birthday", "visits"]), ["visits", "birthday"]);
assert.equal(resumeStepId(again, "automation:birthday", false, "iphone"), "automation:birthday");
assert.equal(resumeStepId(again, "gone", false, "iphone"), "device");
assert.equal(resumeStepId(again, "automation:birthday", true, "iphone"), "device");
assert.equal(resumeStepId(again, "test", false, ""), "device");

const iphoneAuto = automationGuideLines("iphone", visits.shortcutName!, "8:00 AM");
const macAuto = automationGuideLines("mac", visits.shortcutName!, "8:00 AM");
assert.ok(iphoneAuto.includes("Tap **Automation**."));
assert.ok(iphoneAuto.includes("Tap **+**."));
assert.ok(iphoneAuto.includes("Tap **Time of Day**."));
assert.ok(iphoneAuto.includes("Set **8:00 AM**."));
assert.ok(iphoneAuto.includes("Tap **Every Day**."));
assert.ok(iphoneAuto.includes("Tap **Run Immediately**."));
assert.ok(iphoneAuto.includes("Turn **Notify When Run** off."));
assert.equal(iphoneAuto.length, 11);
assert.equal(iphoneAuto.at(-1), "Tap **Done**.");
assert.equal(iphoneAuto.some((line) => /Privacy|Allow Running When Locked|do not see/i.test(line)), false);
assert.equal(iphoneAuto.filter((line) => line.includes("8:00 AM")).length, 1);
assert.ok(macAuto.includes("Click **Daily**."));
assert.ok(macAuto.includes("Click **Run Immediately**."));
assert.equal(macAuto.at(-1), "Click **Done**.");
assert.equal(macAuto.some((line) => /\bTap\b/.test(line)), false);
assert.equal(iphoneAuto.some((line) => /\bClick\b/.test(line)), false);
const iphoneFallback = automationFallbackLines("iphone", visits.shortcutName!, "8:00 AM");
const macFallback = automationFallbackLines("mac", visits.shortcutName!, "8:00 AM");
assert.equal(iphoneFallback[0], 'Tap **"NoteGoat – Day Before 8 AM"**.');
assert.ok(iphoneFallback.includes("Tap **Privacy**."));
assert.equal(iphoneFallback.at(-1), "Turn **Allow Running When Locked** on.");
assert.equal(iphoneFallback.some((line) => /do not see/i.test(line)), false);
assert.equal(macFallback.some((line) => /\bTap\b/.test(line)), false);
assert.ok(macFallback.includes("Click **Privacy**."));
assert.equal(shortcutsAppLines("mac").join(" "), "Shortcuts is already on this Mac. Open **Shortcuts**.");
assert.ok(shortcutsAppLines("iphone").includes("Tap **Get**."));
assert.equal(shortcutsAppLines("iphone").some((line) => /Mac/.test(line)), false);
assert.ok(shortcutFollowLines("iphone").includes("Tap **Add Shortcut**."));
assert.ok(shortcutFollowLines("mac").some((line) => line.includes("Download shortcut")));
assert.deepEqual(testFollowLines("iphone"), ["Tap **Run**."]);
assert.deepEqual(testFollowLines("mac"), ["Click **Run**."]);

const start = startOverLines("iphone");
assert.ok(start.includes("Tap **Delete Shortcut**."));
assert.ok(start.includes("Do not remove the Device in NoteGoat."));
assert.equal(start.some((line) => /remove the Device/i.test(line) && !/Do not remove/.test(line)), false);
assert.equal(startOverLines("mac").some((line) => /\bTap\b/.test(line)), false);
for (const line of [...iphoneAuto, ...macAuto, ...iphoneFallback, ...macFallback, ...start, ...startOverLines("mac"), ...shortcutsAppLines("iphone"), ...shortcutsAppLines("mac")]) {
  assert.equal(/\bphone\b/i.test(line), false, line);
  assert.equal(line.split("**").length <= 5, true, line);
}

assert.equal(testShortcutName(rules, ["birthday", "visits"]), "NoteGoat – Day Before 8 AM");
assert.equal(testShortcutName([], []), "NoteGoat");
assert.equal(shortcutRunUrl("NoteGoat – Day Before 8 AM"), "shortcuts://run-shortcut?name=NoteGoat%20%E2%80%93%20Day%20Before%208%20AM");
assert.equal(shortcutRunUrl("NoteGoat").startsWith("shortcuts://"), true);
assert.equal(shortcutRunUrl("NoteGoat").includes("/api/"), false);

const device = { kind: "iphone", revoked_at: null, last_seen_at: "2026-11-18T16:05:00Z", last_run_at: "2026-11-18T16:05:02Z", last_run_summary: "2026-11-18: nothing to send" };
assert.equal(deviceCheckIn({ devices: [device], platform: "iphone", since: "2026-11-18T16:00:00Z" }).ok, true);
assert.equal(deviceCheckIn({ devices: [device], platform: "iphone", since: "2026-11-18T16:00:00Z" }).summary, "2026-11-18: nothing to send");
assert.equal(deviceCheckIn({ devices: [device], platform: "iphone", since: "2026-11-18T17:00:00Z" }).ok, false);
assert.equal(deviceCheckIn({ devices: [device], platform: "mac", since: "2026-11-18T16:00:00Z" }).ok, false);
assert.equal(deviceCheckIn({ devices: [{ ...device, revoked_at: "2026-11-18T16:06:00Z" }], platform: "iphone", since: "2026-11-18T16:00:00Z" }).ok, false);

const empty = emptyMessagingSetup();
assert.equal(messagingSetupComplete(empty, []), false);
assert.equal(messagingSetupComplete({ ...empty, checkedInAt: "2026-11-18T16:05:00Z" }, []), true);
assert.equal(messagingSetupComplete(empty, [device]), true);
assert.equal(messagingSetupComplete(empty, [{ ...device, revoked_at: "2026-11-18T16:06:00Z" }]), false);
assert.equal(defaultSmsReminderSettings().messagingSetup.checkedInAt, "");
const round = normalizeSmsReminderSettings({
  messagingSetup: { platform: "mac", step: "test", ruleIds: ["visits", "bad id", ""], checkedInAt: "2026-11-18T16:05:00Z", testSince: "2026-11-18T16:04:00Z", redo: true },
});
assert.equal(round.messagingSetup.platform, "mac");
assert.equal(round.messagingSetup.step, "test");
assert.deepEqual(round.messagingSetup.ruleIds, ["visits"]);
assert.equal(round.messagingSetup.redo, true);
assert.equal(round.messagingSetup.testSince, "2026-11-18T16:04:00Z");
assert.deepEqual(normalizeSmsReminderSettings({}).messagingSetup, emptyMessagingSetup());

const flow = readFileSync("src/components/messaging-setup-flow.tsx", "utf8");
const lib = readFileSync("src/lib/messaging-setup.ts", "utf8");
const panel = readFileSync("src/components/text-reminders-settings-panel.tsx", "utf8");
const checklist = readFileSync("src/components/setup-checklist.tsx", "utf8");
const onboarding = readFileSync("src/components/onboarding-modal.tsx", "utf8");
const settings = readFileSync("src/app/(portal)/settings/page.tsx", "utf8");
const handbook = readFileSync("src/lib/handbook-content.ts", "utf8");
assert.match(flow, /Are you using an iPhone or a Mac\?/);
assert.match(flow, /Set up automatic Reminders and Messaging/);
assert.match(flow, /Redo setup/);
assert.match(flow, /Test it now/);
assert.match(flow, /This Device checked in/);
assert.match(flow, /Don't see Automation\?/);
assert.match(flow, /<details data-testid="automation-fallback">/);
assert.doesNotMatch(flow, /<details[^>]*\sopen/);
assert.doesNotMatch(flow, /automation-fallback[\s\S]{0,200}bg-|automation-fallback[\s\S]{0,200}border/);
assert.match(flow, /dualWriteKv|update\(\{[\s\S]*messagingSetup/);
assert.doesNotMatch(flow, /localStorage/);
assert.doesNotMatch(flow, /\bphone\b/i);
assert.doesNotMatch(lib, /\bphone\b/i);
assert.doesNotMatch(flow, /bg-white|bg-amber|bg-yellow|#fef9e7|bg-blue-50/);
assert.match(panel, /MessagingSetupEntry/);
assert.match(panel, /setup === "messaging"/);
assert.match(panel, /dualWriteKv\(SMS_REMINDER_SETTINGS_KEY/);
assert.match(checklist, /MessagingSetupEntry/);
assert.match(checklist, /section=textReminders/);
assert.match(settings, /<SetupChecklist/);
assert.match(onboarding, /Set up automatic Reminders and Messaging/);
assert.match(onboarding, /section=textReminders&setup=messaging/);
assert.match(handbook, /Set up automatic Reminders and Messaging/);
assert.match(handbook, /Allow Running When Locked/);
assert.match(handbook, /Do not remove the Device in NoteGoat/);
assert.match(handbook, /NoteGoat never sends a text on its own/);
assert.equal(lib.includes("Prime Spine"), false);
assert.equal(flow.includes("Prime Spine"), false);

console.log("messaging-setup: all checks passed");

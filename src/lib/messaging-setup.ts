/**
 * Guided setup for automatic Reminders and Messaging.
 * One step list per Device. The words are the words on that Device's screen.
 * Nothing here sends a text. The Device's Shortcuts app does, when someone runs it.
 */
import type { MessagingSetupState } from "@/lib/sms-reminders";
import type { TextRule } from "@/lib/sms-reminders";
import { shortcutName } from "@/lib/text-rules";

export type MessagingPlatform = "iphone" | "mac";

export type MessagingStepKind =
  | "device"
  | "start-over"
  | "add-device"
  | "shortcuts-app"
  | "pick"
  | "shortcut"
  | "automation"
  | "test";

export interface MessagingStep {
  id: string;
  kind: MessagingStepKind;
  ruleId?: string;
}

export interface CheckInDevice {
  kind: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  last_run_at: string | null;
  last_run_summary: string | null;
}

const press = (platform: MessagingPlatform) => (platform === "mac" ? "Click" : "Tap");

/** The steps, in order. Redo adds the start-over screen after the Device choice. */
export function buildMessagingSteps(input: { redo: boolean; ruleIds: string[] }): MessagingStep[] {
  const steps: MessagingStep[] = [{ id: "device", kind: "device" }];
  if (input.redo) steps.push({ id: "start-over", kind: "start-over" });
  steps.push(
    { id: "add-device", kind: "add-device" },
    { id: "shortcuts-app", kind: "shortcuts-app" },
    { id: "pick", kind: "pick" },
  );
  for (const ruleId of input.ruleIds) {
    steps.push({ id: `shortcut:${ruleId}`, kind: "shortcut", ruleId });
    steps.push({ id: `automation:${ruleId}`, kind: "automation", ruleId });
  }
  steps.push({ id: "test", kind: "test" });
  return steps;
}

/** Picked rules, earliest time first. Unknown ids are dropped. */
export function orderedRuleIds(rules: TextRule[], picked: string[]): string[] {
  const want = new Set(picked);
  return rules
    .filter((rule) => want.has(rule.id))
    .slice()
    .sort((a, b) => a.hour - b.hour || a.id.localeCompare(b.id))
    .map((rule) => rule.id);
}

/** The shortcut the test runs. The office's own name, or the shared NoteGoat shortcut. */
export function testShortcutName(rules: TextRule[], ruleIds: string[]): string {
  const id = orderedRuleIds(rules, ruleIds)[0];
  const rule = rules.find((item) => item.id === id);
  if (!rule) return "NoteGoat";
  return rule.shortcutName || shortcutName(rule);
}

/** Opens that shortcut on this Device. It does not send a text by itself. */
export function shortcutRunUrl(name: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

/**
 * Setup is done when this flow's test saw a check-in, or a Device already has.
 * A removed Device does not count.
 */
export function messagingSetupComplete(
  setup: MessagingSetupState,
  devices: { revoked_at: string | null; last_seen_at: string | null }[],
): boolean {
  if (setup.checkedInAt) return true;
  return devices.some((device) => !device.revoked_at && Boolean(device.last_seen_at));
}

/**
 * The test saw this Device after they tapped Test it now.
 * last_seen_at is the check-in. last_run_at / last_run_summary is the run.
 */
export function deviceCheckIn(input: {
  devices: CheckInDevice[];
  platform: MessagingPlatform;
  since: string;
}): { ok: boolean; at: string; summary: string } {
  const rows = input.devices.filter((device) => !device.revoked_at && device.kind === input.platform);
  let best: { at: string; summary: string } | null = null;
  for (const row of rows) {
    const seen = row.last_seen_at && row.last_seen_at >= input.since ? row.last_seen_at : "";
    const ran = row.last_run_at && row.last_run_at >= input.since ? row.last_run_at : "";
    const at = seen > ran ? seen : ran;
    if (!at) continue;
    if (!best || at > best.at) best = { at, summary: row.last_run_summary ?? "" };
    else if (at === best.at && row.last_run_summary) best = { at, summary: row.last_run_summary };
  }
  return best ? { ok: true, at: best.at, summary: best.summary } : { ok: false, at: "", summary: "" };
}

/** Delete old shortcuts in the Shortcuts app. The Device in NoteGoat stays. */
export function startOverLines(platform: MessagingPlatform): string[] {
  const word = press(platform);
  return [
    "Open **Shortcuts**.",
    platform === "mac" ? "Click a NoteGoat shortcut." : "Touch and hold a NoteGoat shortcut.",
    platform === "mac" ? "Press **Delete**." : `${word} **Delete**.`,
    `${word} **Delete Shortcut**.`,
    "Do that for each NoteGoat shortcut.",
    `${word} **Automation**.`,
    platform === "mac" ? "Click a NoteGoat automation." : "Swipe left on a NoteGoat automation.",
    `${word} **Delete**.`,
    "Do that for each NoteGoat automation.",
    "Do not remove the Device in NoteGoat.",
  ];
}

/** Shortcuts is built in on a Mac. On an iPhone it can be downloaded again. */
export function shortcutsAppLines(platform: MessagingPlatform): string[] {
  if (platform === "mac") {
    return ["Shortcuts is already on this Mac.", "Open **Shortcuts**."];
  }
  return [
    "If you see **Shortcuts**, tap **Next**.",
    "Open **App Store**.",
    "Tap **Search**.",
    "Type **Shortcuts**.",
    "Tap **Get**.",
    "If it says **Open**, tap **Open**.",
  ];
}

/** What the Device shows after Add to this Device opens the shortcut. */
export function shortcutFollowLines(platform: MessagingPlatform): string[] {
  const word = press(platform);
  const lines = [`${word} **Add Shortcut**.`];
  if (platform === "mac") lines.push("If it does not open, click **Download shortcut**.");
  return lines;
}

/**
 * One automation for one shortcut. Ends at Done.
 * On this Automation-tab path (iOS 18 through iOS 26), Run Immediately is what
 * lets Time of Day run while the Device is locked. Allow Running When Locked
 * is not a button on that screen.
 */
export function automationGuideLines(platform: MessagingPlatform, name: string, time: string): string[] {
  const word = press(platform);
  const day = platform === "mac" ? "Daily" : "Every Day";
  return [
    "Open **Shortcuts**.",
    `${word} **Automation**.`,
    `${word} **+**.`,
    `${word} **Time of Day**.`,
    `Set **${time}**.`,
    `${word} **${day}**.`,
    `${word} **Run Immediately**.`,
    "Turn **Notify When Run** off.",
    `${word} **Next**.`,
    `${word} **"${name}"**.`,
    `${word} **Done**.`,
  ];
}

/**
 * Current iOS, when Shortcuts has no Automation tab.
 * Apple's guide: Edit, Automation, Time of Day, then Privacy, Allow Running When Locked.
 * That switch is what lets the automation run while the Device is locked.
 */
export function automationFallbackLines(platform: MessagingPlatform, name: string, time: string): string[] {
  const word = press(platform);
  const quoted = `**"${name}"**`;
  return [
    `${word} ${quoted}.`,
    `${word} **Edit**.`,
    `${word} **Automation**.`,
    `${word} **Time of Day**.`,
    `Set **${time}**.`,
    `${word} **Privacy**.`,
    "Turn **Allow Running When Locked** on.",
  ];
}

/** Shortcuts may ask before the test run. */
export function testFollowLines(platform: MessagingPlatform): string[] {
  return [`${press(platform)} **Run**.`];
}

/** A saved step that is no longer in the list goes back to the Device question. */
export function resumeStepId(steps: MessagingStep[], saved: string, redo: boolean, platform: string): string {
  if (redo || (platform !== "iphone" && platform !== "mac")) return "device";
  if (saved && steps.some((step) => step.id === saved)) return saved;
  return "device";
}

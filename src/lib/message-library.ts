/**
 * The Messages library + Auto Texts attachments. Pure (no "use client", no
 * browser APIs) so the browser and the server queue pick the SAME message.
 *
 * Messages live in the existing cloud key casemate.sms-templates.v1 (no DB
 * migration). Which message each Auto Text uses lives in the reminder
 * settings (templateId for Reminders, birthdayTemplateId for Birthday).
 */
import { DEFAULT_REMINDER_BODY, type SmsTemplate } from "@/lib/sms-template-core";
import { DEFAULT_BIRTHDAY_MESSAGE, type SmsReminderSettings } from "@/lib/sms-reminders";

/** Fixed ids so two computers that both create the starter message end up with ONE copy. */
export const AUTO_REMINDER_MESSAGE_ID = "SMS-auto-reminder";
export const AUTO_BIRTHDAY_MESSAGE_ID = "SMS-auto-birthday";
export const AUTO_REMINDER_MESSAGE_NAME = "⏰ Appointment Reminder";
export const AUTO_BIRTHDAY_MESSAGE_NAME = "🎂 Birthday";

/** Words staff can drop into a message. Plain names; they are written {first name} etc. */
export const MESSAGE_WORDS: { token: string; label: string; plain: string; appointment?: boolean }[] = [
  { token: "{first name}", label: "First name", plain: "The patient's first name, like Jane" },
  { token: "{last name}", label: "Last name", plain: "The patient's last name" },
  { token: "{full name}", label: "Full name", plain: "The patient's first and last name" },
  { token: "{appt date}", label: "Appointment date", plain: "The visit date, like 11/04/26", appointment: true },
  { token: "{appt time}", label: "Appointment time", plain: "The visit time, like 10:30 AM", appointment: true },
  { token: "{today}", label: "Today's date", plain: "The day the text goes out, like 11/03/26" },
  { token: "{office name}", label: "Office name", plain: "Your office name from Settings" },
  { token: "{doctor name}", label: "Doctor name", plain: "The doctor's name from Settings" },
  { token: "{office phone}", label: "Office phone", plain: "Your office phone number" },
];

/** Does this message use the visit date/time? (A birthday text has no visit.) */
export function usesAppointmentWords(body: string): boolean {
  return /\{\{?\s*(appt[ _-]?(date|time)|appointment[ _-]?(date|time)|date|time)\s*\}\}?/i.test(body);
}

export function liveMessages(all: SmsTemplate[]): SmsTemplate[] {
  return all.filter((t) => !t.deleted);
}

/**
 * Turn the edited list of visible messages back into the full saved list:
 * anything that disappeared becomes a delete marker (so it syncs), anything
 * new is added, and a message with a delete marker that comes back is revived.
 */
export function applyLiveEdit(full: SmsTemplate[], nextLive: SmsTemplate[], nowIso: string): SmsTemplate[] {
  const nextById = new Map(nextLive.map((t) => [t.id, t]));
  const out: SmsTemplate[] = [];
  const seen = new Set<string>();
  for (const old of full) {
    seen.add(old.id);
    const kept = nextById.get(old.id);
    if (kept) {
      const { deleted: _deleted, ...rest } = kept as SmsTemplate;
      void _deleted;
      out.push(rest);
    } else if (old.deleted) out.push(old);
    else out.push({ ...old, deleted: true, updatedAt: nowIso });
  }
  for (const t of nextLive) {
    if (seen.has(t.id)) continue;
    const { deleted: _deleted, ...rest } = t as SmsTemplate;
    void _deleted;
    out.push(rest);
  }
  return out;
}

type Attach = Pick<SmsReminderSettings, "templateId" | "birthdayTemplateId" | "birthdayMessage">;

const nonEmpty = (t: SmsTemplate | undefined): t is SmsTemplate => !!t && t.body.trim().length > 0;

/** The message Auto Texts → Reminders sends: the attached one, else one named "remind…", else the first. */
export function resolveReminderMessage(settings: Pick<SmsReminderSettings, "templateId">, all: SmsTemplate[]): SmsTemplate | undefined {
  const live = liveMessages(all);
  const attached = live.find((t) => t.id === settings.templateId);
  if (nonEmpty(attached)) return attached;
  return live.find((t) => /remind/i.test(t.name) && nonEmpty(t)) ?? live.find(nonEmpty);
}

/**
 * The message Auto Texts → Birthday sends. `id` is null when it is not a
 * library message (an old custom wording or the built-in text).
 */
export function resolveBirthdayMessage(settings: Attach, all: SmsTemplate[]): { id: string | null; body: string } {
  const live = liveMessages(all);
  const attached = live.find((t) => t.id === settings.birthdayTemplateId);
  if (nonEmpty(attached)) return { id: attached.id, body: attached.body };
  const custom = (settings.birthdayMessage ?? "").trim();
  if (custom && custom !== DEFAULT_BIRTHDAY_MESSAGE.trim()) return { id: null, body: custom };
  const named = live.find((t) => /birthday/i.test(t.name) && nonEmpty(t));
  if (named) return { id: named.id, body: named.body };
  return { id: null, body: DEFAULT_BIRTHDAY_MESSAGE };
}

export type AutoTextPlan = { settingsPatch: Partial<Pick<SmsReminderSettings, "templateId" | "birthdayTemplateId">>; addMessages: SmsTemplate[] };

/**
 * One-time tidy-up for offices that had text settings before Messages existed:
 * attach the wording they already use (saving it as a message if needed).
 * Returns null when everything is already attached. Never turns a switch on or off.
 */
export function planAutoTextMigration(settings: Attach, all: SmsTemplate[], nowIso: string): AutoTextPlan | null {
  const live = liveMessages(all);
  const hasAttached = (id: string) => !!id && live.some((t) => t.id === id);
  const patch: AutoTextPlan["settingsPatch"] = {};
  const add: SmsTemplate[] = [];
  const mk = (id: string, name: string, body: string): SmsTemplate => ({ id, name, body, createdAt: nowIso, updatedAt: nowIso });

  if (!hasAttached(settings.templateId)) {
    const found = resolveReminderMessage(settings, all);
    if (found) patch.templateId = found.id;
    else {
      add.push(mk(AUTO_REMINDER_MESSAGE_ID, AUTO_REMINDER_MESSAGE_NAME, DEFAULT_REMINDER_BODY));
      patch.templateId = AUTO_REMINDER_MESSAGE_ID;
    }
  }
  if (!hasAttached(settings.birthdayTemplateId)) {
    const found = resolveBirthdayMessage(settings, all);
    if (found.id) patch.birthdayTemplateId = found.id;
    else {
      add.push(mk(AUTO_BIRTHDAY_MESSAGE_ID, AUTO_BIRTHDAY_MESSAGE_NAME, found.body));
      patch.birthdayTemplateId = AUTO_BIRTHDAY_MESSAGE_ID;
    }
  }
  return Object.keys(patch).length ? { settingsPatch: patch, addMessages: add } : null;
}

/** Which Auto Texts use this message. */
export function autoTextsUsing(messageId: string, settings: Pick<SmsReminderSettings, "templateId" | "birthdayTemplateId">): string[] {
  const out: string[] = [];
  if (settings.templateId === messageId) out.push("Reminders");
  if (settings.birthdayTemplateId === messageId) out.push("Birthday");
  return out;
}

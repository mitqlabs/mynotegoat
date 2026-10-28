/**
 * Appointment text reminders — deciding WHO gets a reminder and WHAT it says.
 *
 * Deliberately has no idea how a text is sent. Everything here is pure:
 * give it a day's appointments and it returns the queue, each entry either
 * ready to send or carrying the reason it was held back. That means the
 * same code drives the on-screen list the front desk works by hand today
 * and the automatic send once a provider is connected — and it can be
 * tested without an account, a phone number, or sending anything.
 *
 * What it will NOT do, on purpose:
 *   * no diagnosis, no case detail — a reminder says who, when and where;
 *   * nothing to a patient who asked not to be texted;
 *   * nothing for a visit that is canceled, no-showed or already seen;
 *   * one text per patient per day, however many visits they have.
 */

import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";

export const SMS_REMINDER_SETTINGS_KEY = "casemate.sms-reminders.v1";

export interface SmsReminderSettings {
  /** Master switch for AUTOMATIC sending. The preview list works either way. */
  enabled: boolean;
  /** How many days before the visit the reminder goes out. 1 = the day before. */
  daysAhead: number;
  /** Hour of day (0-23) the batch is sent. */
  sendHour: number;
  /** Nothing sends outside these hours, whatever else is configured. */
  quietStartHour: number;
  quietEndHour: number;
  /** Which saved SMS template to use. Empty = the first one. */
  templateId: string;
  /** Appointment types that never get a reminder (exam types, say). */
  skipTypes: string[];
  /** Weekdays (0 = Sun) the batch runs. null = automatic: the day before
   *  every open office day (from Schedule Settings office hours). */
  runDays: number[] | null;
  /** Sending device logs what it WOULD send and sends nothing. */
  dryRun: boolean;
  /** IANA time zone the office runs in (decides "today" and "tomorrow"). */
  timeZone: string;
  /** Append an opt-out line ("Reply STOP to opt out.") to every text. */
  optOutLine: boolean;
  /** Wording of that line. */
  optOutText: string;
  /** Staff ticked "I created the 8 AM automation" (the iPhone's Shortcuts
   *  automation iOS won't let a shortcut ship with). Saved to cloud settings. */
  automationConfirmed: boolean;
  /** ISO time the box was ticked ("" when not). */
  automationConfirmedAt: string;
  /** Which Text Reminders sections staff opened / closed. Saved to cloud settings so every
   *  computer shows the same layout. A section that is not listed uses its default. */
  sections: Partial<Record<"setup" | "texts" | "messages" | "sends", boolean>>;
}

export const DEFAULT_OPT_OUT_TEXT = "Reply STOP to opt out.";

export function defaultSmsReminderSettings(): SmsReminderSettings {
  return {
    // Off until a provider is connected AND the office has watched a few
    // days of the preview. Turning this on is a deliberate act.
    enabled: false,
    daysAhead: 1,
    sendHour: 8,
    quietStartHour: 21,
    quietEndHour: 8,
    templateId: "",
    skipTypes: [],
    runDays: null,
    // New setups start in dry run: the Mac logs, sends nothing, until the
    // office turns this off on purpose.
    dryRun: true,
    timeZone: "America/Los_Angeles",
    optOutLine: true,
    optOutText: DEFAULT_OPT_OUT_TEXT,
    automationConfirmed: false,
    automationConfirmedAt: "",
    sections: {},
  };
}

export function normalizeSmsReminderSettings(value: unknown): SmsReminderSettings {
  const base = defaultSmsReminderSettings();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;
  const num = (key: keyof SmsReminderSettings, min: number, max: number) => {
    const candidate = Number(raw[key]);
    return Number.isFinite(candidate) ? Math.min(max, Math.max(min, Math.round(candidate))) : null;
  };
  if (raw.enabled === true) base.enabled = true;
  base.daysAhead = num("daysAhead", 0, 14) ?? base.daysAhead;
  base.sendHour = num("sendHour", 0, 23) ?? base.sendHour;
  base.quietStartHour = num("quietStartHour", 0, 23) ?? base.quietStartHour;
  base.quietEndHour = num("quietEndHour", 0, 23) ?? base.quietEndHour;
  if (typeof raw.templateId === "string") base.templateId = raw.templateId;
  if (Array.isArray(raw.skipTypes)) {
    base.skipTypes = raw.skipTypes.filter((entry): entry is string => typeof entry === "string");
  }
  if (Array.isArray(raw.runDays)) {
    const days = Array.from(
      new Set(
        raw.runDays
          .map((entry) => Number(entry))
          .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6),
      ),
    ).sort((a, b) => a - b);
    base.runDays = days;
  }
  if (raw.dryRun === false) base.dryRun = false;
  if (typeof raw.timeZone === "string" && raw.timeZone.trim()) base.timeZone = raw.timeZone.trim();
  if (raw.optOutLine === false) base.optOutLine = false;
  if (typeof raw.optOutText === "string" && raw.optOutText.trim()) base.optOutText = raw.optOutText.trim().slice(0, 120);
  if (raw.automationConfirmed === true) {
    base.automationConfirmed = true;
    if (typeof raw.automationConfirmedAt === "string") base.automationConfirmedAt = raw.automationConfirmedAt;
  }
  if (raw.sections && typeof raw.sections === "object") {
    const sec = raw.sections as Record<string, unknown>;
    for (const key of ["setup", "texts", "messages", "sends"] as const) {
      if (typeof sec[key] === "boolean") base.sections[key] = sec[key] as boolean;
    }
  }
  return base;
}

/** Why a visit on the list is not getting a text. */
export type ReminderHold =
  | "opted-out"
  | "no-mobile"
  | "not-scheduled"
  | "skipped-type"
  | "duplicate-day";

export interface ReminderQueueEntry {
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** Digits only, as stored on the patient. Empty when there's no number. */
  phone: string;
  date: string;
  time: string;
  appointmentType: string;
  /** Absent when the entry is ready to send. */
  hold?: ReminderHold;
}

const HOLD_LABELS: Record<ReminderHold, string> = {
  "opted-out": "Asked not to be texted",
  "no-mobile": "No phone number on file",
  "not-scheduled": "Not a scheduled visit",
  "skipped-type": "This visit type is excluded",
  "duplicate-day": "Already texted about an earlier visit that day",
};

export function reminderHoldLabel(hold: ReminderHold): string {
  return HOLD_LABELS[hold];
}

/** Digits only — what a texting provider actually wants. */
export function reminderPhoneDigits(phone: string | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * The reminder queue for one visit date, in time order.
 *
 * Every appointment that day comes back, including the ones being held, so
 * the screen can explain itself rather than silently dropping people —
 * "why didn't Mrs Garcia get a text?" should be answerable from the list.
 */
export function buildReminderQueue(
  appointments: ScheduleAppointmentRecord[],
  patientsById: Map<string, PatientRecord>,
  settings: SmsReminderSettings,
  visitDateIso: string,
): ReminderQueueEntry[] {
  const skipTypes = new Set(settings.skipTypes.map((type) => type.trim().toLowerCase()));
  const textedPatients = new Set<string>();

  return appointments
    .filter((appointment) => appointment.date === visitDateIso)
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((appointment) => {
      const patient = patientsById.get(appointment.patientId);
      const phone = reminderPhoneDigits(patient?.phone);
      const entry: ReminderQueueEntry = {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        patientName: appointment.patientName || patient?.fullName || "",
        phone,
        date: appointment.date,
        time: appointment.startTime,
        appointmentType: appointment.appointmentType,
      };

      // A visit that isn't going to happen as booked gets no reminder.
      if (appointment.status !== "Scheduled" && appointment.status !== "Reschedule") {
        return { ...entry, hold: "not-scheduled" as const };
      }
      if (skipTypes.has(appointment.appointmentType.trim().toLowerCase())) {
        return { ...entry, hold: "skipped-type" as const };
      }
      if (patient?.textRemindersOff) {
        return { ...entry, hold: "opted-out" as const };
      }
      if (!phone) {
        return { ...entry, hold: "no-mobile" as const };
      }
      // Two visits in a day is one text, about the first.
      if (textedPatients.has(appointment.patientId)) {
        return { ...entry, hold: "duplicate-day" as const };
      }
      textedPatients.add(appointment.patientId);
      return entry;
    });
}

/** Just the ones that would actually be sent. */
export function sendableReminders(queue: ReminderQueueEntry[]): ReminderQueueEntry[] {
  return queue.filter((entry) => !entry.hold);
}

/**
 * Is `hour` inside the quiet window? Windows that cross midnight (21 → 8)
 * are the normal case, so this handles the wrap rather than assuming
 * start < end.
 */
export function isQuietHour(hour: number, settings: SmsReminderSettings): boolean {
  const { quietStartHour: start, quietEndHour: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** "2026-09-28" minus `daysAhead` — the day the batch for that visit goes out. */
export function reminderSendDate(visitDateIso: string, daysAhead: number): string {
  const [year, month, day] = visitDateIso.split("-").map(Number);
  if (!year || !month || !day) return visitDateIso;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - Math.max(0, Math.round(daysAhead)));
  return date.toISOString().slice(0, 10);
}

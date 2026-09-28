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
}

export function defaultSmsReminderSettings(): SmsReminderSettings {
  return {
    // Off until a provider is connected AND the office has watched a few
    // days of the preview. Turning this on is a deliberate act.
    enabled: false,
    daysAhead: 1,
    sendHour: 16,
    quietStartHour: 21,
    quietEndHour: 8,
    templateId: "",
    skipTypes: [],
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

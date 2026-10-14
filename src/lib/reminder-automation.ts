/**
 * Automatic day-before text reminders — the pure planning half.
 *
 * Shared by the Settings screen (what WILL happen) and the device API
 * (what to send right now), so the two can never disagree. Nothing here
 * talks to a network, a database or a phone.
 */
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { expandTokens } from "@/lib/sms-render";
import {
  buildReminderQueue,
  sendableReminders,
  type ReminderQueueEntry,
  type SmsReminderSettings,
} from "@/lib/sms-reminders";

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface OfficeHoursDay {
  dayOfWeek: number;
  enabled: boolean;
}

/** Run the day before every open office day. Mon/Wed/Thu open → Sun/Tue/Wed. */
export function autoRunDays(officeHours: OfficeHoursDay[]): number[] {
  const open = new Set(officeHours.filter((d) => d.enabled).map((d) => d.dayOfWeek));
  return [0, 1, 2, 3, 4, 5, 6].filter((dow) => open.has((dow + 1) % 7));
}

export function effectiveRunDays(settings: SmsReminderSettings, officeHours: OfficeHoursDay[]): number[] {
  return settings.runDays ?? autoRunDays(officeHours);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's date, weekday and hour in the office's time zone. */
export function localNow(now: Date, timeZone: string): { iso: string; dow: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return { iso, dow, hour: Number(get("hour")) % 24 };
}

export type RunPlan =
  | { run: true; todayIso: string; visitDate: string }
  | { run: false; todayIso: string; visitDate: string; reason: string };

/**
 * Should the device send right now, and for which visit date?
 * Always the NEXT day's visits (Sunday's run covers Monday).
 */
export function planReminderRun(input: {
  now: Date;
  settings: SmsReminderSettings;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
  /** "Send Now": skip the run-day, send-hour and once-a-day checks. */
  force?: boolean;
  /** When this device last finished a run (to run once per day). */
  lastRunAt?: Date | null;
}): RunPlan {
  const { now, settings, officeHours, closedIsoDates } = input;
  const force = input.force === true;
  const today = localNow(now, settings.timeZone);
  const visitDate = addDaysIso(today.iso, 1);
  const base = { todayIso: today.iso, visitDate };
  if (!settings.enabled) return { ...base, run: false, reason: "Text reminders are turned off." };
  const days = effectiveRunDays(settings, officeHours);
  if (!force && !days.includes(today.dow)) {
    return { ...base, run: false, reason: `${WEEKDAY_SHORT[today.dow]} is not a run day.` };
  }
  if (closedIsoDates.has(visitDate)) {
    return { ...base, run: false, reason: "The office is closed tomorrow (Key Dates)." };
  }
  const { quietStartHour: qs, quietEndHour: qe } = settings;
  const quiet = qs !== qe && (qs < qe ? today.hour >= qs && today.hour < qe : today.hour >= qs || today.hour < qe);
  if (quiet) return { ...base, run: false, reason: "Quiet hours — nothing sends now." };
  if (!force && today.hour < settings.sendHour) {
    return { ...base, run: false, reason: `Too early — sends at ${settings.sendHour}:00.` };
  }
  if (!force && input.lastRunAt && localNow(input.lastRunAt, settings.timeZone).iso === today.iso) {
    return { ...base, run: false, reason: "Already ran today." };
  }
  return { ...base, run: true };
}

/** "Doe, Jane" → Jane; "Jane Doe" → Jane. */
export function splitPatientName(fullName: string): { firstName: string; lastName: string } {
  const name = (fullName || "").trim();
  if (name.includes(",")) {
    const [last, rest] = name.split(",", 2);
    return { firstName: (rest ?? "").trim().split(/\s+/)[0] ?? "", lastName: last.trim() };
  }
  const words = name.split(/\s+/).filter(Boolean);
  return { firstName: words[0] ?? "", lastName: words.slice(1).join(" ") };
}

export function to12h(hhmm: string): string {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${suffix}`;
}

function usDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${m}/${d}/${y}` : iso;
}

export interface ReminderOffice {
  officeName: string;
  doctorName: string;
  phone: string;
  locations?: { id: string; phone?: string; name?: string }[];
}

export function renderReminderText(
  templateBody: string,
  entry: ReminderQueueEntry,
  patient: PatientRecord | undefined,
  office: ReminderOffice,
): string {
  const { firstName, lastName } = splitPatientName(patient?.fullName || entry.patientName);
  const location = patient?.locationId
    ? office.locations?.find((loc) => loc.id === patient.locationId)
    : undefined;
  return expandTokens(templateBody, {
    patient: { firstName, lastName, fullName: patient?.fullName || entry.patientName },
    appointment: { time: to12h(entry.time), date: usDate(entry.date), type: entry.appointmentType },
    office: {
      officeName: office.officeName,
      doctorName: office.doctorName,
      phone: (location?.phone || "").trim() || office.phone,
    },
  }).trim();
}

export interface DeviceQueueItem {
  /** The appointment id; echo it back on ack. */
  id: string;
  /** Digits only, US 10-digit numbers get +1. */
  phone: string;
  text: string;
}

export function toE164(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

/**
 * What the device should send for one visit date: sendable entries only,
 * minus anything already sent (duplicate prevention), with the text
 * rendered. Returns only phone + text — no names, types or ids beyond the
 * appointment id the device needs for its ack.
 */
export function buildDeviceQueue(input: {
  appointments: ScheduleAppointmentRecord[];
  patientsById: Map<string, PatientRecord>;
  settings: SmsReminderSettings;
  visitDate: string;
  templateBody: string;
  office: ReminderOffice;
  alreadySentIds: Set<string>;
}): DeviceQueueItem[] {
  const queue = buildReminderQueue(input.appointments, input.patientsById, input.settings, input.visitDate);
  return sendableReminders(queue)
    .filter((entry) => !input.alreadySentIds.has(entry.appointmentId))
    .map((entry) => ({
      id: entry.appointmentId,
      phone: toE164(entry.phone),
      text: renderReminderText(input.templateBody, entry, input.patientsById.get(entry.patientId), input.office),
    }))
    .filter((item) => item.phone && item.text);
}

/** SHA-256 hex of a device token (Web Crypto: browser and Node 20). */
export async function hashDeviceToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token.trim());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new random device token, shown once. */
export function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `ngr_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Minutes after the send time before a backup device may send. */
export const BACKUP_DELAY_MIN = 30;
/** How long a device holds the reminders it was handed. */
export const CLAIM_MINUTES = 15;

/**
 * May a BACKUP device send now? Only after the primary has had its chance:
 * BACKUP_DELAY_MIN past the send hour on a normal run, or that long after
 * a Settings "Send Now" request. A device forced by hand (?force=1 on that
 * device) may send at once. Returns a reason when it must wait.
 */
export function backupWaitReason(input: {
  now: Date;
  settings: SmsReminderSettings;
  requestedAt: Date | null;
  selfForced: boolean;
}): string | null {
  if (input.selfForced) return null;
  if (input.requestedAt) {
    const ready = input.requestedAt.getTime() + BACKUP_DELAY_MIN * 60_000;
    return input.now.getTime() >= ready ? null : "Backup device: giving the primary time to send first.";
  }
  const local = localNow(input.now, input.settings.timeZone);
  const minutes = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: input.settings.timeZone, minute: "2-digit" }).format(input.now),
  );
  const nowMin = local.hour * 60 + (Number.isFinite(minutes) ? minutes : 0);
  const readyMin = input.settings.sendHour * 60 + BACKUP_DELAY_MIN;
  if (nowMin >= readyMin) return null;
  const h = Math.floor(readyMin / 60);
  const m = readyMin % 60;
  return `Backup device: waits until ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}.`;
}

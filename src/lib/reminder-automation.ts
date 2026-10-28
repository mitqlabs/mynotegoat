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
import { isTimeWithinHours, type KeyDateHours } from "@/lib/key-dates";

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
  /** Same-day catch-up: only visits starting after this "HH:MM". */
  onlyAfter?: string;
  /** Same-day catch-up: say "today" instead of "tomorrow". */
  sameDay?: boolean;
  /** Key Date special hours: visits outside them get no reminder. */
  hours?: KeyDateHours | null;
}): DeviceQueueItem[] {
  const queue = buildReminderQueue(input.appointments, input.patientsById, input.settings, input.visitDate);
  const after = input.onlyAfter ? normalizeHHMM(input.onlyAfter) : "";
  return sendableReminders(queue)
    .filter((entry) => !input.alreadySentIds.has(entry.appointmentId))
    .filter((entry) => !after || normalizeHHMM(entry.time) > after)
    .filter((entry) => isTimeWithinHours(entry.time, input.hours ?? null))
    .map((entry) => {
      const text = renderReminderText(input.templateBody, entry, input.patientsById.get(entry.patientId), input.office);
      return {
        id: entry.appointmentId,
        phone: toE164(entry.phone),
        text: withOptOutLine(input.sameDay ? todayWording(text) : text, input.settings),
      };
    })
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

/** "9:5" / "09:05:00" → "09:05" (empty when unparseable). */
export function normalizeHHMM(value: string): string {
  const [h, m] = (value || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${String(h).padStart(2, "0")}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")}`;
}

/** Same-day wording: "tomorrow" → "today" (keeps capitalisation). */
export function todayWording(text: string): string {
  return text.replace(/\btomorrow\b/gi, (w) =>
    w === w.toUpperCase() ? "TODAY" : w[0] === "T" ? "Today" : "today",
  );
}

/** Office-local "HH:MM" right now. */
export function localHHMM(now: Date, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt("America/Los_Angeles");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour").padStart(2, "0").replace(/^24$/, "00")}:${get("minute").padStart(2, "0")}`;
}

export function isQuietNow(now: Date, settings: SmsReminderSettings): boolean {
  const { quietStartHour: qs, quietEndHour: qe } = settings;
  const hour = localNow(now, settings.timeZone).hour;
  return qs !== qe && (qs < qe ? hour >= qs && hour < qe : hour >= qs || hour < qe);
}

export interface CatchUpDate {
  visitDate: string;
  /** "today": same-day catch-up (future visits only, "today" wording). */
  mode: "today" | "tomorrow";
  /** For "today": only visits starting after this office-local HH:MM. */
  onlyAfter?: string;
  /** Key Date special hours for that date (partial closure / custom hours). */
  hours?: KeyDateHours;
}

export interface CatchUpPlan {
  todayIso: string;
  /** Tomorrow's date; the reply's top-level visitDate. */
  visitDate: string;
  dates: CatchUpDate[];
  /** Why nothing (or only part) can be sent. */
  reason: string;
}

/**
 * "Send Reminders Now" = catch-up backup (e.g. the phone was dead at 8 AM).
 * Sends TODAY's reminders that never went out (only visits still ahead),
 * plus TOMORROW's when they are due (a run day, at/after the send hour).
 * Quiet hours and Key Dates closures still apply; duplicates are removed
 * later by the sent log and claims.
 */
export function planCatchUp(input: {
  now: Date;
  settings: SmsReminderSettings;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
  /** Key Date special hours per date; visits outside them are skipped. */
  hoursByDate?: Map<string, KeyDateHours>;
}): CatchUpPlan {
  const { now, settings, officeHours, closedIsoDates } = input;
  const hoursFor = (iso: string) => {
    const h = input.hoursByDate?.get(iso);
    return h ? { hours: h } : {};
  };
  const today = localNow(now, settings.timeZone);
  const visitDate = addDaysIso(today.iso, 1);
  const base = { todayIso: today.iso, visitDate };
  if (!settings.enabled) return { ...base, dates: [], reason: "Text reminders are turned off." };
  if (isQuietNow(now, settings)) return { ...base, dates: [], reason: "Quiet hours — nothing sends now." };
  const dates: CatchUpDate[] = [];
  const notes: string[] = [];
  if (closedIsoDates.has(today.iso)) notes.push("The office is closed today (Key Dates).");
  else dates.push({ visitDate: today.iso, mode: "today", onlyAfter: localHHMM(now, settings.timeZone), ...hoursFor(today.iso) });
  if (closedIsoDates.has(visitDate)) notes.push("The office is closed tomorrow (Key Dates).");
  else if (!effectiveRunDays(settings, officeHours).includes(today.dow)) notes.push("Tomorrow's reminders aren't due (not a run day).");
  else if (today.hour < settings.sendHour) notes.push(`Tomorrow's reminders go out at ${settings.sendHour}:00.`);
  else dates.push({ visitDate, mode: "tomorrow", ...hoursFor(visitDate) });
  return { ...base, dates, reason: notes.join(" ") };
}

/**
 * The automatic (scheduled, non-forced) run. Same as the catch-up — TODAY's
 * unsent reminders for visits still ahead ("today" wording) plus TOMORROW's
 * when due — but only from the send hour, and a dry run only once a day.
 * Real sends are deduped by the sent log and claims, so a second call (or a
 * later "Send Reminders Now") never texts anyone twice.
 */
export function planScheduledRun(input: {
  now: Date;
  settings: SmsReminderSettings;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
  hoursByDate?: Map<string, KeyDateHours>;
  /** Only passed for dry runs (once-a-day). */
  lastRunAt?: Date | null;
}): CatchUpPlan {
  const { now, settings } = input;
  const today = localNow(now, settings.timeZone);
  const base = { todayIso: today.iso, visitDate: addDaysIso(today.iso, 1) };
  if (!settings.enabled) return { ...base, dates: [], reason: "Text reminders are turned off." };
  if (isQuietNow(now, settings)) return { ...base, dates: [], reason: "Quiet hours — nothing sends now." };
  if (today.hour < settings.sendHour) return { ...base, dates: [], reason: `Too early — sends at ${settings.sendHour}:00.` };
  if (input.lastRunAt && localNow(input.lastRunAt, settings.timeZone).iso === today.iso) {
    return { ...base, dates: [], reason: "Already ran today." };
  }
  return planCatchUp(input);
}

/**
 * Queue item ids. Plain appointment id = the reply's visitDate (backward
 * compatible); "r:<date>:<appt>" = a reminder for another date (catch-up);
 * "b:<recipient id>" = a "Message patients" broadcast text.
 */
export type QueueItemRef =
  | { kind: "reminder"; visitDate: string; appointmentId: string }
  | { kind: "broadcast"; recipientId: string };

export function encodeReminderItemId(visitDate: string, appointmentId: string, primaryVisitDate: string): string {
  return visitDate === primaryVisitDate ? appointmentId : `r:${visitDate}:${appointmentId}`;
}

export function decodeQueueItemId(id: string, fallbackVisitDate: string): QueueItemRef | null {
  if (!id) return null;
  if (id.startsWith("b:")) return id.length > 2 ? { kind: "broadcast", recipientId: id.slice(2) } : null;
  const m = /^r:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(id);
  if (m) return { kind: "reminder", visitDate: m[1], appointmentId: m[2] };
  return fallbackVisitDate ? { kind: "reminder", visitDate: fallbackVisitDate, appointmentId: id } : null;
}

/** Should a backup device hold a broadcast? Gives the primary BACKUP_DELAY_MIN. */
export function broadcastBackupHold(createdAt: Date, now: Date, selfForced: boolean): boolean {
  return !selfForced && now.getTime() - createdAt.getTime() < BACKUP_DELAY_MIN * 60_000;
}

/** Recipients for "Message patients": one per patient with a valid phone. */
export interface BroadcastCandidate {
  appointmentId: string;
  patientId: string;
  patientName: string;
  time: string;
  status: string;
  phone: string;
  optedOut?: boolean;
}

/**
 * "Message patients" time window. `startTime` / `endTime` are "HH:MM" (end
 * exclusive, either optional). `notBefore` drops visits already past (the
 * current office time when the target date is today). Unknown visit times
 * stay in, except when a window was chosen.
 */
export interface BroadcastTimeWindow {
  startTime?: string;
  endTime?: string;
  notBefore?: string;
}

export function broadcastTimeOk(time: string, window: BroadcastTimeWindow): boolean {
  const t = normalizeHHMM(time);
  const start = window.startTime ? normalizeHHMM(window.startTime) : "";
  const end = window.endTime ? normalizeHHMM(window.endTime) : "";
  const notBefore = window.notBefore ? normalizeHHMM(window.notBefore) : "";
  if (!t) return !start && !end;
  if (start && t < start) return false;
  if (end && t >= end) return false;
  if (notBefore && t < notBefore) return false;
  return true;
}

/** A US phone: 10 digits, or 11 starting with 1. */
function hasValidPhone(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

export function pickBroadcastRecipients(
  rows: BroadcastCandidate[],
  options: { excludeCanceled: boolean } & BroadcastTimeWindow,
): BroadcastCandidate[] {
  const seen = new Set<string>();
  const seenPhones = new Set<string>();
  return rows
    .slice()
    .sort((a, b) => normalizeHHMM(a.time).localeCompare(normalizeHHMM(b.time)))
    .filter((row) => {
      if (!row.patientId || seen.has(row.patientId)) return false;
      if (options.excludeCanceled && /^cancel/i.test(row.status)) return false;
      if (!broadcastTimeOk(row.time, options)) return false;
      if (row.optedOut) return false;
      if (!hasValidPhone(row.phone)) return false;
      // Family members who share one phone get one text.
      const key = phoneMatchKey(row.phone);
      if (seenPhones.has(key)) return false;
      seen.add(row.patientId);
      seenPhones.add(key);
      return true;
    });
}

// ---- "Message patients": who the text goes to (the audience) ----

/**
 * Audiences for "Message patients". To add one later ("All patients",
 * "Patients seen in a time period"): add an id here, a case in
 * `pickAudienceRecipients` (and, if it needs extra inputs, the loader in
 * message-patients-composer.tsx). "booked" is the visit-based one and keeps
 * its own date + time-window picker; every other audience is a patient list.
 */
export type BroadcastAudience = "active" | "booked";

export interface BroadcastAudienceOption {
  id: BroadcastAudience;
  label: string;
  /** One line shown under the selector. */
  summary: string;
}

export const BROADCAST_AUDIENCES: BroadcastAudienceOption[] = [
  { id: "active", label: "All active patients", summary: "Every patient whose case status is Active." },
  { id: "booked", label: "Booked on a day", summary: "Only patients with a visit on the day you pick." },
];

export const DEFAULT_BROADCAST_AUDIENCE: BroadcastAudience = "active";

/**
 * "Active" for broadcasts = the Patients list status named Active (any
 * capitalisation) or no status at all (new patients default to Active). Every
 * other status (Discharged, Ready to Submit, Submitted, Dropped, Paid and any
 * status the office adds) is NOT active.
 */
export function isActiveCaseStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s === "" || s === "active";
}

/** A patient row as read for a patient-list audience. */
export interface BroadcastPatient {
  patientId: string;
  patientName: string;
  phone: string;
  caseStatus: string;
  optedOut?: boolean;
}

/**
 * Recipients for a patient-list audience (anything but "booked"): one text
 * per patient with a valid phone, once per phone number, never anyone who
 * opted out. Sorted by name. No appointment, so appointmentId/time are "".
 */
export function pickAudienceRecipients(
  audience: Exclude<BroadcastAudience, "booked">,
  patients: BroadcastPatient[],
): BroadcastCandidate[] {
  const inAudience = (p: BroadcastPatient) => {
    switch (audience) {
      case "active":
        return isActiveCaseStatus(p.caseStatus);
    }
  };
  const seen = new Set<string>();
  const seenPhones = new Set<string>();
  return patients
    .slice()
    .sort((a, b) => a.patientName.localeCompare(b.patientName, undefined, { sensitivity: "base" }))
    .filter((p) => {
      if (!p.patientId || seen.has(p.patientId) || !inAudience(p) || p.optedOut) return false;
      if (!hasValidPhone(p.phone)) return false;
      const key = phoneMatchKey(p.phone);
      if (seenPhones.has(key)) return false;
      seen.add(p.patientId);
      seenPhones.add(key);
      return true;
    })
    .map((p) => ({
      appointmentId: "",
      patientId: p.patientId,
      patientName: p.patientName,
      time: "",
      status: p.caseStatus,
      phone: p.phone,
    }));
}

/**
 * The day a list-audience broadcast is queued for ("send day"). The device
 * queue only reads broadcasts whose target date is today or later, so this is
 * today, unless it's the evening part of quiet hours: then the first
 * non-quiet moment is tomorrow, and today's date would expire before it.
 */
export function broadcastSendDay(
  now: Date,
  settings: Pick<SmsReminderSettings, "timeZone" | "quietStartHour" | "quietEndHour">,
): { iso: string; deferred: boolean } {
  const today = localNow(now, settings.timeZone);
  const { quietStartHour: qs, quietEndHour: qe } = settings;
  const quiet = qs !== qe && (qs < qe ? today.hour >= qs && today.hour < qe : today.hour >= qs || today.hour < qe);
  const eveningOfWrap = quiet && qs > qe && today.hour >= qs;
  return eveningOfWrap ? { iso: addDaysIso(today.iso, 1), deferred: true } : { iso: today.iso, deferred: quiet };
}

// ---- Opt-out by reply ("STOP") ----

/** Replies that opt a patient out (carrier-standard keywords). */
export const OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "END", "QUIT"] as const;
/** Replies that opt a patient back in. */
export const OPT_IN_KEYWORDS = ["START", "UNSTOP"] as const;

/**
 * Is this incoming text an opt-out / opt-in keyword? The whole message must
 * be the keyword (case-insensitive, trimmed, trailing punctuation ignored),
 * so "Can I cancel my 3pm?" is NOT an opt-out.
 */
export function parseOptOutReply(text: unknown): "stop" | "start" | null {
  if (typeof text !== "string") return null;
  const word = text.trim().replace(/[\s.!]+$/, "").replace(/^["'“]+|["'”]+$/g, "").toUpperCase();
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(word)) return "stop";
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(word)) return "start";
  return null;
}

/** Comparable phone key: the last 10 digits ("" if fewer than 10). */
export function phoneMatchKey(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** Append the opt-out line (when on) unless the text already mentions STOP. */
export function withOptOutLine(text: string, settings: { optOutLine?: boolean; optOutText?: string }): string {
  const line = (settings.optOutText ?? "").trim();
  if (!text || settings.optOutLine === false || !line || /\bSTOP\b/i.test(text)) return text;
  return `${text.trimEnd()} ${line}`;
}

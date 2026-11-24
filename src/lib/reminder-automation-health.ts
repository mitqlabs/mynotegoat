/**
 * Is the iPhone's 8 AM automation actually running? (pure, no I/O)
 *
 * iOS can't ship a schedule inside a shortcut, so an office that installed
 * "Send-Reminders" but never made the Shortcuts automation gets no automatic
 * texts. The server can't see the phone's Automation list, but it can see
 * whether texts went out near the send hour. A run day counts as "missed"
 * when reminders were due for the next day yet nothing was logged between
 * the send hour and two hours after it. The warning shows when the two most
 * recent judged run days were both missed.
 */
import { isBirthdayToday, birthdayFirstName, birthdayPhone } from "@/lib/birthday-texts";
import type { PatientRecord } from "@/lib/mock-data";
import { addDaysIso, CLAIM_MINUTES, effectiveRunDays, localHHMM, localNow, normalizeHHMM, type OfficeHoursDay } from "@/lib/reminder-automation";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { buildReminderQueue, sendableReminders, type SmsReminderSettings } from "@/lib/sms-reminders";

/** Hours after the send hour that still count as the automatic run. */
export const AUTO_RUN_WINDOW_HOURS = 2;
/** How many past days are looked at. */
export const AUTO_RUN_LOOKBACK_DAYS = 14;
/** Missed run days in a row before the warning shows. */
export const AUTO_RUN_MISSES_TO_WARN = 2;

export interface AutomationHealthInput {
  now: Date;
  timeZone: string;
  sendHour: number;
  /** Weekdays (0 = Sun) the office runs. */
  runDays: number[];
  /** created_at of recent reminder_log rows (any status). */
  logTimes: string[];
  /** When the first active sending device was added (ISO). Days before it aren't judged. */
  deviceAddedAt: string | null;
  /** True when some reminder was due (sendable) for this visit date. */
  hasDueReminders: (visitDate: string) => boolean;
  lookbackDays?: number;
}

export interface AutomationHealth {
  /** Run days judged, newest first. */
  judged: Array<{ date: string; ran: boolean }>;
  /** Run days with due reminders but no send near the send hour, newest first. */
  missed: string[];
  warn: boolean;
}

export function automationHealth(input: AutomationHealthInput): AutomationHealth {
  const { now, timeZone, sendHour } = input;
  const today = localNow(now, timeZone);
  const deviceDay = input.deviceAddedAt ? localNow(new Date(input.deviceAddedAt), timeZone).iso : "";
  const ranOn = new Set<string>();
  for (const at of input.logTimes) {
    const t = new Date(at);
    if (Number.isNaN(t.getTime())) continue;
    const l = localNow(t, timeZone);
    if (l.hour >= sendHour && l.hour < sendHour + AUTO_RUN_WINDOW_HOURS) ranOn.add(l.iso);
  }
  const judged: AutomationHealth["judged"] = [];
  for (let back = 0; back <= (input.lookbackDays ?? AUTO_RUN_LOOKBACK_DAYS); back += 1) {
    const date = addDaysIso(today.iso, -back);
    // Today only counts once the send window has passed.
    if (back === 0 && today.hour < sendHour + AUTO_RUN_WINDOW_HOURS) continue;
    if (deviceDay && date <= deviceDay) break;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!input.runDays.includes(dow)) continue;
    if (!input.hasDueReminders(addDaysIso(date, 1))) continue;
    judged.push({ date, ran: ranOn.has(date) });
  }
  const missed = judged.filter((j) => !j.ran).map((j) => j.date);
  const recent = judged.slice(0, AUTO_RUN_MISSES_TO_WARN);
  const warn = recent.length >= AUTO_RUN_MISSES_TO_WARN && recent.every((j) => !j.ran);
  return { judged, missed, warn };
}

/** Minutes after the send time before a silent morning counts as "didn't run". */
export const MORNING_GRACE_MINUTES = 20;

export interface MorningPhone {
  lastSeenAt: string | null;
  lastRunAt: string | null;
}

export interface MorningRunInput {
  now: Date;
  timeZone: string;
  sendHour: number;
  /** Reminders or birthday texts are on, and test mode is off. */
  active: boolean;
  hasIphone: boolean;
  /** Something should have gone out this morning. */
  dueToday: boolean;
  /** created_at of reminder_log rows. */
  logTimes: string[];
  iphones: MorningPhone[];
  /** birthday_text_log rows still status=claimed. */
  birthdayClaims: { claimedAt: string }[];
  /** Broadcast recipients still queued, with a lease. */
  broadcastClaims: { claimedUntil: string | null }[];
}

export interface MorningRunStatus {
  /** pending = a run is inside the claim window; the banner stays quiet. */
  kind: "hidden" | "pending" | "unfinished" | "missed";
  /** Empty unless the office should see a banner. */
  lead: string;
  action: string;
}

const UNFINISHED = {
  kind: "unfinished" as const,
  lead: "This morning's texts were fetched but not sent.",
  action: "On the office iPhone, tap Send Reminders Now.",
};
const MISSED = {
  kind: "missed" as const,
  lead: "This morning's texts have not gone out.",
  action: "On the office iPhone, tap Send Reminders Now.",
};
const QUIET: MorningRunStatus = { kind: "hidden", lead: "", action: "" };

/**
 * Was there anything for this morning's run to send? Tomorrow's reminders on
 * a run day, today's visits that were still ahead at the send time, or a
 * birthday. Used only to decide the "didn't run" warning.
 */
export function morningWorkDue(input: {
  now: Date;
  settings: SmsReminderSettings;
  officeHours: OfficeHoursDay[];
  appointments: ScheduleAppointmentRecord[];
  patients: PatientRecord[];
}): boolean {
  const { settings } = input;
  const today = localNow(input.now, settings.timeZone);
  const byId = new Map(input.patients.map((p) => [p.id, p]));
  const sendable = (iso: string) => sendableReminders(buildReminderQueue(input.appointments, byId, settings, iso));
  const cutoff = `${String(settings.sendHour).padStart(2, "0")}:00`;
  const todayDue = settings.enabled && sendable(today.iso).some((e) => normalizeHHMM(e.time) > cutoff);
  const tomorrowDue =
    settings.enabled &&
    effectiveRunDays(settings, input.officeHours).includes(today.dow) &&
    sendable(addDaysIso(today.iso, 1)).length > 0;
  const birthdayDue =
    settings.birthdayTexts &&
    input.patients.some(
      (p) =>
        !p.deleted &&
        !p.textRemindersOff &&
        isBirthdayToday(p.dob, today.iso) &&
        Boolean(birthdayPhone(p.phone)) &&
        Boolean(birthdayFirstName(p.fullName)),
    );
  return todayDue || tomorrowDue || birthdayDue;
}

function minutesNow(now: Date, timeZone: string): number {
  const [h, m] = localHHMM(now, timeZone).split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Same-day check for the 8 AM iPhone run. A fetch that never acks (or a
 * birthday/broadcast lease that expired with no ack) warns as soon as the
 * claim window has passed. A morning with nothing fetched warns after a
 * short grace, and only when something was actually due. A run still inside
 * its claim window stays quiet so a slow send is not flagged.
 */
export function morningRunStatus(input: MorningRunInput): MorningRunStatus {
  if (!input.active || !input.hasIphone) return QUIET;
  const { now, timeZone, sendHour } = input;
  const today = localNow(now, timeZone);
  if (today.hour < sendHour) return QUIET;
  const claimMs = CLAIM_MINUTES * 60_000;
  const onSendDay = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return false;
    const l = localNow(t, timeZone);
    return l.iso === today.iso && l.hour >= sendHour;
  };

  const birthdayStuck = input.birthdayClaims.some((c) => {
    if (!onSendDay(c.claimedAt)) return false;
    return now.getTime() - new Date(c.claimedAt).getTime() >= claimMs;
  });
  const birthdayFresh = input.birthdayClaims.some((c) => {
    if (!onSendDay(c.claimedAt)) return false;
    return now.getTime() - new Date(c.claimedAt).getTime() < claimMs;
  });
  const broadcastStuck = input.broadcastClaims.some((c) => {
    if (!c.claimedUntil) return false;
    const until = new Date(c.claimedUntil);
    if (Number.isNaN(until.getTime()) || until.getTime() > now.getTime()) return false;
    const started = new Date(until.getTime() - claimMs);
    return onSendDay(started.toISOString());
  });
  const broadcastFresh = input.broadcastClaims.some((c) => {
    if (!c.claimedUntil) return false;
    const until = new Date(c.claimedUntil).getTime();
    return Number.isFinite(until) && until > now.getTime();
  });

  const fetches = input.iphones
    .map((d) => d.lastSeenAt)
    .filter((iso): iso is string => {
      if (!iso) return false;
      return onSendDay(iso);
    })
    .map((iso) => new Date(iso).getTime())
    .filter((t) => Number.isFinite(t));
  const latestFetch = fetches.length ? Math.max(...fetches) : 0;
  const ackedAfterFetch =
    latestFetch > 0 &&
    (input.logTimes.some((iso) => new Date(iso).getTime() >= latestFetch - 5_000) ||
      input.iphones.some((d) => d.lastRunAt != null && new Date(d.lastRunAt).getTime() >= latestFetch));
  const fetchAge = latestFetch > 0 ? now.getTime() - latestFetch : 0;
  const fetchStuck = latestFetch > 0 && !ackedAfterFetch && fetchAge >= claimMs;
  const fetchFresh = latestFetch > 0 && !ackedAfterFetch && fetchAge < claimMs;

  if (birthdayStuck || broadcastStuck || fetchStuck) return UNFINISHED;
  if (birthdayFresh || broadcastFresh || fetchFresh) return { kind: "pending", lead: "", action: "" };

  const logsToday = input.logTimes.some((iso) => onSendDay(iso));
  if (input.dueToday && !logsToday && !latestFetch && minutesNow(now, timeZone) >= sendHour * 60 + MORNING_GRACE_MINUTES) {
    return MISSED;
  }
  return QUIET;
}

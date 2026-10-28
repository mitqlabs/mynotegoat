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
import { addDaysIso, localNow } from "@/lib/reminder-automation";

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

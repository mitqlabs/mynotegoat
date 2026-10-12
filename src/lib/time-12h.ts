/**
 * 12-hour time helpers. Storage stays canonical 24h "HH:MM" everywhere;
 * these only convert for display/input. Smart AM/PM picks the half of the
 * day that falls inside the office's business hours.
 */
import type { DailyOfficeHours } from "./schedule-settings";

export type Meridiem = "AM" | "PM";

const hhmm = /^(\d{1,2}):(\d{2})$/;

function mins(t: string | undefined): number | null {
  const m = hhmm.exec((t ?? "").trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** "13:05" -> "1:05 PM". Unparseable input is returned unchanged. */
export function to12hLabel(value: string): string {
  const m = hhmm.exec((value ?? "").trim());
  if (!m || +m[1] > 23) return value;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "13:05" -> { display: "1:05", meridiem: "PM" }. */
export function split24h(value: string): { display: string; meridiem: Meridiem } {
  const m = hhmm.exec((value ?? "").trim());
  if (!m || +m[1] > 23) return { display: "", meridiem: "AM" };
  const h = +m[1];
  return { display: `${h % 12 || 12}:${m[2]}`, meridiem: h < 12 ? "AM" : "PM" };
}

/** ("1:05", "PM") -> "13:05"; null when the 12h text isn't a valid time. */
export function compose24h(display: string, meridiem: Meridiem): string | null {
  const m = hhmm.exec((display ?? "").trim());
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  if (h < 1 || h > 12 || mi > 59) return null;
  if (meridiem === "AM" && h === 12) h = 0;
  else if (meridiem === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export interface ParsedTyping {
  display: string;
  /** Set when the user typed an explicit a/p/am/pm. */
  meridiem?: Meridiem;
}

/**
 * Formats what the user types: "930" -> "9:30", "1230" -> "12:30",
 * "3:30p" -> "3:30" + PM. Hours 13-23 typed in 24h are converted ("1530" -> "3:30" PM).
 */
export function parseTyped(raw: string): ParsedTyping {
  const lower = (raw ?? "").toLowerCase();
  const letter = /([ap])\s*m?\s*$/.exec(lower.replace(/[^0-9:apm\s]/g, ""));
  let meridiem: Meridiem | undefined = letter ? (letter[1] === "a" ? "AM" : "PM") : undefined;
  const digits = lower.replace(/\D/g, "").slice(0, 4);
  if (!digits) return { display: "", meridiem };
  if (digits.length <= 2) return { display: digits, meridiem };
  const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
  let hour = +hourDigits;
  const minute = digits.slice(-2);
  if (digits.length === 4 && hour >= 13 && hour <= 23) {
    hour -= 12;
    meridiem = "PM";
  } else if (digits.length === 4 && hour === 0) {
    hour = 12;
    meridiem = "AM";
  }
  return { display: `${hour}:${minute}`, meridiem };
}

function inBlocks(t: number, day: DailyOfficeHours): boolean {
  const blocks: Array<[string | undefined, string | undefined]> = [
    [day.start, day.end],
    [day.start2, day.end2],
  ];
  return blocks.some(([s, e]) => {
    const a = mins(s);
    const b = mins(e);
    return a !== null && b !== null && t >= a && t < b;
  });
}

/**
 * Which half of the day does a 12h time belong to, given office hours?
 * Uses the appointment's weekday when a date is given, otherwise any open day.
 * Returns null when both or neither fit (caller keeps the user's choice).
 */
export function inferMeridiem(
  display: string,
  officeHours: DailyOfficeHours[] | undefined,
  dateIso?: string,
): Meridiem | null {
  if (!officeHours?.length) return null;
  const am = compose24h(display, "AM");
  const pm = compose24h(display, "PM");
  if (!am || !pm) return null;
  let days = officeHours.filter((d) => d.enabled);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso ?? "");
  if (dm) {
    const dow = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3])).getUTCDay();
    const today = days.filter((d) => d.dayOfWeek === dow);
    if (today.length) days = today;
  }
  const amFits = days.some((d) => inBlocks(mins(am)!, d));
  const pmFits = days.some((d) => inBlocks(mins(pm)!, d));
  if (amFits === pmFits) return null;
  return amFits ? "AM" : "PM";
}

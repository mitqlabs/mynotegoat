/**
 * Plain-language closed days for G.O.A.T.
 *
 * "we will be closed Thursday the 19th" → one Key Dates day, status Closed.
 * "…send all active patients a message…" → that day, plus a broadcast draft.
 *
 * This file only reads words. It never saves a date and never queues a text.
 */
import { findDate } from "@/lib/goat-understand";

export interface ClosedDayRequest {
  /** YYYY-MM-DD. */
  iso: string;
  /** Also prepare a text to all active patients. Nothing is queued here. */
  broadcast: boolean;
}

const QUESTION_LEAD = /^(?:how|what|whats|what's|where|who|why|when|which|does|do|is|are|should|did|was|can|could)\b/i;
/** A statement that the office will be shut, not "we're closed" inside a text. */
const STRONG_CLOSE =
  /\b(?:will be closed|(?:we|i)'ll be closed|going to close|gonna close|clos(?:e|ing) the (?:office|clinic|practice)|office will be closed|office is closed|(?:we(?:'re| are)|office|clinic|practice) closed on)\b/i;
const LEADING_COMMAND = /^(?:please\s+)?(?:text|txt|sms|send|message|msg|notify|tell|let)\b/i;
const TELL_ACTIVE =
  /\b(?:send|text|message|notify|let|tell)\b/i;
const ACTIVE_AUDIENCE =
  /\b(?:all\s+active(?:\s+patients)?|active\s+patients|every\s+active\s+patients?|everyone|everybody|all\s+(?:of\s+)?(?:our|the|my)\s+patients|all\s+patients)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const fromIso = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function realDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return toIso(d);
}

function weekdayIndex(text: string): number | null {
  const m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/i.exec(text);
  if (!m) return null;
  const key = m[1].toLowerCase().slice(0, 3);
  const i = WEEK.indexOf(key);
  return i >= 0 ? i : null;
}

function nextWhere(today: string, pred: (d: Date) => boolean): string | null {
  const start = fromIso(today);
  for (let i = 0; i < 400; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (pred(d)) return toIso(d);
  }
  return null;
}

/** The day the sentence names, or null when it doesn't name one. */
export function resolveClosedDate(text: string, today: string): string | null {
  const monthFirst = new RegExp(String.raw`\b(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?`, "i").exec(text);
  const dayFirst = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH})\b(?:,?\s*(\d{4}))?`, "i").exec(text);
  const named = monthFirst
    ? { month: MONTHS[monthFirst[1].toLowerCase().replace(/\./g, "")], day: Number(monthFirst[2]), year: monthFirst[3] ? Number(monthFirst[3]) : null }
    : dayFirst
      ? { month: MONTHS[dayFirst[2].toLowerCase()], day: Number(dayFirst[1]), year: dayFirst[3] ? Number(dayFirst[3]) : null }
      : null;
  if (named?.month) {
    const year = named.year ?? Number(today.slice(0, 4));
    let iso = realDate(year, named.month, named.day);
    if (!named.year && iso && iso < today) iso = realDate(year + 1, named.month, named.day);
    return iso;
  }

  const numeric = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.exec(text);
  if (numeric) return findDate(numeric[0], today)?.iso ?? null;

  const ordinal = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  const week = weekdayIndex(text);
  if (ordinal) {
    const day = Number(ordinal[1]);
    if (day < 1 || day > 31) return null;
    if (week !== null) return nextWhere(today, (d) => d.getDate() === day && d.getDay() === week);
    return nextWhere(today, (d) => d.getDate() === day);
  }
  return findDate(text, today)?.iso ?? null;
}

/**
 * A request to mark a day Closed, optionally telling active patients.
 * Null for questions, Key Dates help, and a plain "text everyone we're closed …"
 * (that one stays the existing text card, and does not change Key Dates).
 */
export function closedDayRequest(raw: string, today: string): ClosedDayRequest | null {
  const text = raw.trim().replace(/[’‘]/g, "'");
  if (!text || text.startsWith("/") || text.startsWith("@")) return null;
  if (QUESTION_LEAD.test(text) || /\?\s*$/.test(text)) return null;
  const strong = STRONG_CLOSE.test(text);
  if (!strong) return null;
  // "text all active patients that we're closed Friday" is a text, not a Key Date.
  // A real close ("will be closed", "going to close") still counts beside a send.
  if (LEADING_COMMAND.test(text) && !/\b(?:will be closed|(?:we|i)'ll be closed|going to close|gonna close|clos(?:e|ing) the (?:office|clinic))\b/i.test(text)) return null;
  const iso = resolveClosedDate(text, today);
  if (!iso) return null;
  const broadcast = TELL_ACTIVE.test(text) && ACTIVE_AUDIENCE.test(text);
  return { iso, broadcast };
}

/** "Thursday, Nov 19" — the same shape the closed-day text uses. */
export function closedDayLabel(iso: string): string {
  const d = fromIso(iso);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] ?? "";
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] ?? "";
  return `${weekday}, ${mon} ${d.getDate()}`;
}

/** Draft the office can edit. `{first name}` is filled in for each patient when the text goes out. */
export function closedDayMessage(officeName: string, iso: string): string {
  const name = officeName.trim() || "Our office";
  return `Hi {first name}, ${name} will be closed ${closedDayLabel(iso)}. We'll be back on our regular schedule after that. Reply STOP to opt out.`;
}

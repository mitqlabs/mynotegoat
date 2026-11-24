/**
 * G.O.A.T. bulk cancel — understand "cancel all appointments for tomorrow", "cancel everything on Friday",
 * "cancel Dr. Lee's 3pm–5pm today", then pick the matching visits for a checklist.
 * Pure: no UI, no storage. Nothing here cancels anything — the card's red button does, after a click.
 */
import { findDate } from "@/lib/goat-understand";

export interface BulkCancelQuery {
  /** ISO day, "2026-10-30". */
  date: string;
  /** Minutes after midnight; start is inclusive, end is exclusive (a visit that STARTS at 5:00pm is not in "3–5pm"). */
  startMin?: number;
  endMin?: number;
  /** "3pm–5pm" for the card heading. */
  windowLabel?: string;
  /** As typed after "Dr." — matched against each visit's provider. */
  provider?: string;
}

export interface BulkCancelParse {
  /** Everything but the day; `date` is empty until the day is known. */
  query: Omit<BulkCancelQuery, "date"> & { date?: string };
  /** The day wasn't said (or was in the past / a whole week) — ask for it with Today / Tomorrow buttons. */
  needsDay: boolean;
  /** Why we're asking, when it isn't just "missing". */
  dayNote?: string;
}

/** The slice of a visit this module needs. */
export interface CancelableAppt {
  id: string;
  patientId: string;
  patientName: string;
  provider: string;
  appointmentType: string;
  date: string;
  startTime: string;
  status: string;
}

const POLITE = String.raw`(?:(?:hey\s+)?(?:goat|g\.o\.a\.t\.?)[,:]?\s+)?(?:(?:please|pls|can you|could you|would you|will you|i need you to|i want you to|i need to|i want to|i'd like to|let'?s|go ahead and)\s+)*`;
const VERB = String.raw`(?:cancel|cancle|cxl|clear(?:\s+out)?|wipe(?:\s+out)?|call off|scratch)`;
const START = new RegExp(`^${POLITE}${VERB}\\b\\s*(.*)$`, "i");
/** Words that make a "cancel …" a whole-group request rather than one patient's visit. */
const GROUP = /\b(?:all|everything|every ?one|every ?body|every|entire|whole|appointments|appts|visits|patients|schedule|calendar|book|day)\b/i;
const DOC = /\b(?:dr\.?|doctor)\s+([a-z][a-z'’-]*)(?:['’]s)?/i;

const pad = (n: number): string => String(n).padStart(2, "0");
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export function clock12(min: number): string {
  const h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)}${ap}` : `${h12}${ap}`;
}

type Ap = "am" | "pm" | undefined;
function toMin(h: number, m: number, ap: Ap): number | null {
  if (h > 24 || m > 59) return null;
  if (h === 24) return null;
  if (ap === "pm" && h < 12) h += 12;
  else if (ap === "am" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12; // a bare "3-5" in a clinic means afternoon
  return h * 60 + m;
}

/** "3pm-5pm", "3–5pm", "3 to 5", "from 9am to noon", "after 3pm", "before noon", "morning", "at 3pm". */
export function parseTimeWindow(text: string): { startMin: number; endMin: number; label: string } | null {
  const t = text.toLowerCase().replace(/[–—]/g, "-").replace(/\bnoon\b/g, "12pm").replace(/\bmidday\b/g, "12pm");
  const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
  const norm = (a?: string): Ap => (a ? ((a[0] === "a" ? "am" : "pm") as Ap) : undefined);
  const range = new RegExp(String.raw`(?:\bfrom\s+|\bbetween\s+)?\b${T}\s*(?:-|to|until|till|and|through)\s*${T}\b`).exec(t);
  if (range && (range[3] || range[6] || /[:]/.test(range[0]) || /from|between/.test(range[0]) || range[2] || range[5])) {
    const ap2 = norm(range[6]);
    const ap1 = norm(range[3]) ?? (ap2 && Number(range[1]) <= Number(range[4]) + (ap2 === "pm" && Number(range[4]) === 12 ? 12 : 0) ? ap2 : undefined);
    let a = toMin(Number(range[1]), Number(range[2] || 0), ap1);
    const b = toMin(Number(range[4]), Number(range[5] || 0), ap2);
    // "9-12pm" → 9am–12pm (the first reading would put 9pm after noon)
    if (a !== null && b !== null && a >= b && !norm(range[3])) a = toMin(Number(range[1]), Number(range[2] || 0), "am");
    if (a !== null && b !== null && a < b) return { startMin: a, endMin: b, label: `${clock12(a)}–${clock12(b)}` };
  }
  const after = new RegExp(String.raw`\b(?:after|from|starting at|starting)\s+${T}\b`).exec(t);
  if (after && (after[3] || after[2])) {
    const a = toMin(Number(after[1]), Number(after[2] || 0), norm(after[3]));
    if (a !== null) return { startMin: a, endMin: 24 * 60, label: `${clock12(a)} onward` };
  }
  const before = new RegExp(String.raw`\b(?:before|until|till|up to|through)\s+${T}\b`).exec(t);
  if (before && (before[3] || before[2])) {
    const b = toMin(Number(before[1]), Number(before[2] || 0), norm(before[3]));
    if (b !== null) return { startMin: 0, endMin: b, label: `before ${clock12(b)}` };
  }
  if (/\b(?:this |in the )?morning\b/.test(t)) return { startMin: 0, endMin: 12 * 60, label: "morning" };
  if (/\b(?:this |in the )?afternoon\b/.test(t)) return { startMin: 12 * 60, endMin: 17 * 60, label: "afternoon" };
  const at = new RegExp(String.raw`\b(?:at\s+|the\s+|all\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?!\w)`).exec(t);
  if (at) {
    const a = toMin(Number(at[1]), Number(at[2] || 0), norm(at[3]));
    if (a !== null) return { startMin: a, endMin: a + 1, label: clock12(a) };
  }
  return null;
}

/**
 * Is this a bulk cancel? "cancel John Smith's appointment tomorrow" is NOT (one patient — the normal cancel flow
 * handles it). A day, a doctor or a time window alone isn't enough; it needs a group word or a doctor + window.
 */
export function parseBulkCancel(raw: string, today: string): BulkCancelParse | null {
  const line = raw.trim();
  if (!line || line.startsWith("/") || line.startsWith("@")) return null;
  const m = START.exec(line);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest) return null;
  // "how do I cancel all …" never reaches here (it doesn't START with the verb); a trailing "?" is a question too.
  if (/\?\s*$/.test(line)) return null;

  const doc = DOC.exec(rest);
  const win = parseTimeWindow(rest.replace(DOC, " "));
  const hasGroup = GROUP.test(rest) && !/\b(?:all|every)\s+(?:of\s+)?(?:his|her|their|my own)\b/i.test(rest);
  const singular = /\b(?:appointment|appt|visit)\b/i.test(rest) && !/\b(?:appointments|appts|visits)\b/i.test(rest) && !/\b(?:all|every|everything|everyone)\b/i.test(rest);
  if (singular && !doc) return null;
  if (!hasGroup && !(doc && (win || /\b(?:day|schedule|appointments|appts)\b/i.test(rest)))) return null;
  // A possessive that isn't a doctor ("cancel John's appointments") is one patient, not a group.
  if (!doc && !/\b(?:all|everything|every ?one|every ?body|every|entire|whole|schedule|calendar|book|day)\b/i.test(rest) && /[A-Za-z]['’]s\b/.test(rest) && !/\b(?:today|tomorrow|tmrw)['’]s\b/i.test(rest)) return null;

  const query: BulkCancelParse["query"] = {};
  if (doc) query.provider = doc[1].replace(/['’]s$/i, "");
  if (win) { query.startMin = win.startMin; query.endMin = win.endMin; query.windowLabel = win.label; }

  if (/\b(?:this|next|the|whole|entire|all)\s+week\b|\bweek\b|\bmonth\b/i.test(rest)) {
    return { query, needsDay: true, dayNote: "I cancel one day at a time, so nothing gets wiped by accident." };
  }
  const dayText = rest.replace(/\btmrw\b|\btmw\b|\btomorow\b/gi, "tomorrow");
  const hit = findDate(dayText, today, true);
  if (hit) {
    if (hit.iso < today) return { query, needsDay: true, dayNote: "That day has already passed." };
    query.date = hit.iso;
    return { query, needsDay: false };
  }
  return { query, needsDay: true };
}

/** The visits that match, in time order. Only Scheduled / Reschedule can be cancelled in bulk. */
export function selectBulkCancel<T extends CancelableAppt>(appts: readonly T[], q: BulkCancelQuery): T[] {
  const prov = q.provider?.toLowerCase().replace(/^dr\.?\s*/, "").trim();
  return appts
    .filter((a) => {
      if (a.date !== q.date) return false;
      if (a.status !== "Scheduled" && a.status !== "Reschedule") return false;
      const min = minutesOf(a.startTime);
      if (q.startMin !== undefined && min < q.startMin) return false;
      if (q.endMin !== undefined && min >= q.endMin) return false;
      if (prov && !a.provider.toLowerCase().includes(prov)) return false;
      return true;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.patientName.localeCompare(b.patientName));
}

/** "everything tomorrow", "Dr. Lee's 3pm–5pm today" — for the card heading. */
export function describeBulkCancel(q: BulkCancelQuery, dayWord: string): string {
  const who = q.provider ? `Dr. ${q.provider.replace(/^./, (c) => c.toUpperCase())}'s` : "All";
  return `${who} appointments ${dayWord}${q.windowLabel ? `, ${q.windowLabel}` : ""}`;
}

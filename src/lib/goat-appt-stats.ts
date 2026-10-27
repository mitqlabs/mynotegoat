/**
 * Office-wide appointment counts by status ("how many canceled appts do we have",
 * "no shows this week", "list canceled last month"), plus the intent check that
 * keeps those questions out of patient lookup.
 *
 * Intent comes first: a count/list question about appointment STATUS with no
 * patient in it is an office question. It is never "cancel <patient>" and never a
 * guess at which patient the question names. Local data only, no model.
 */
import type { AppointmentStatus, ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { PracticeData, ToolLink } from "@/lib/goat-practice";
import type { OfficeAnswer } from "@/lib/goat-office";
import { isEverydayWord, isNeverName } from "@/lib/goat-name-guard";

const COUNT_OR_LIST = /\b(how\s+many|how\s+much|count|number\s+of|total|tally|list|show|which|who|any|what|are\s+there|do\s+(?:we|i)\s+have|did\s+we\s+have|have\s+we\s+had)\b/i;
/** Wording that is about one patient's own chart, not the office. */
const ONE_PATIENT = /\b(his|her|hers|she|he|this\s+patient|that\s+patient|the\s+patient|patient['’]s|for\s+(?:him|her))\b/i;
const CASES_WORD = /\b(cases?|files?|charts?|balance|bills?|owe[sd]?|paid|payments?|checks?)\b/i;

interface StatusRule {
  re: RegExp;
  statuses: AppointmentStatus[];
  label: string;
  /** Without a timeframe: this month so far, or upcoming. */
  defaultRange: "month";
}

const STATUS_RULES: StatusRule[] = [
  { re: /\b(cancel(?:l)?ed|cancel(?:l)?ations?|cancels|cxl(?:d|'?d)?)\b/i, statuses: ["Canceled"], label: "canceled", defaultRange: "month" },
  { re: /\b(no[\s-]?shows?|noshows?|no\s+showed|missed|didn'?t\s+show(?:\s+up)?|did\s+not\s+show(?:\s+up)?)\b/i, statuses: ["No Show"], label: "no-show", defaultRange: "month" },
  { re: /\b(re-?scheduled|reschedules?|re-?scheduling)\b/i, statuses: ["Reschedule"], label: "rescheduled", defaultRange: "month" },
  { re: /\b(checked[\s-]?in|check[\s-]?ins?)\b/i, statuses: ["Check In"], label: "checked-in", defaultRange: "month" },
  { re: /\b(checked[\s-]?out|check[\s-]?outs?|completed|seen|came\s+in|showed\s+up)\b/i, statuses: ["Check Out"], label: "completed", defaultRange: "month" },
];

const APPT_WORD = /\b(appointments?|appts?|apts?|appnts?|visits?|patients?|people|pts?|sessions?|bookings?)\b/i;

export interface ApptStatsQuery {
  statuses: AppointmentStatus[];
  statusLabel: string;
  from: string;
  to: string;
  /** "this month", "last week", … as the user will read it. */
  rangeLabel: string;
  /** True when the question had no timeframe and a default was used (stated in the answer). */
  /** No timeframe in the question: G.O.A.T. asks "For which time frame?" instead of guessing one. */
  needsRange: boolean;
  wantList: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const addDays = (s: string, n: number) => {
  const d = fromIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const us = (s: string) => `${s.slice(5, 7)}/${s.slice(8, 10)}`;
const usY = (s: string) => `${us(s)}/${s.slice(0, 4)}`;

function monthRange(today: string, offset: number): { from: string; to: string } {
  const t = fromIso(today);
  const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last) };
}

function weekRange(today: string, offset: number): { from: string; to: string } {
  // Sunday–Saturday, the way the schedule shows a week.
  const start = addDays(today, -fromIso(today).getDay() + offset * 7);
  return { from: start, to: addDays(start, 6) };
}

/** The timeframe named in the question, or null. */
export function parseStatsRange(q: string, today: string): { from: string; to: string; label: string } | null {
  const l = q.toLowerCase();
  if (/\b(all[\s-]?time|ever|overall|in total|to date|since (?:the )?(?:start|beginning))\b/.test(l)) return { from: "0000-01-01", to: "9999-12-31", label: "all time" };
  if (/\btoday\b/.test(l)) return { from: today, to: today, label: "today" };
  if (/\byesterday\b/.test(l)) return { from: addDays(today, -1), to: addDays(today, -1), label: "yesterday" };
  if (/\b(tomorrow|tmrw|tomorow)\b/.test(l)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  const lastN = /\b(?:last|past|previous)\s+(\d{1,3})\s+(days?|weeks?|months?)\b/.exec(l);
  if (lastN) {
    const n = Number(lastN[1]);
    const days = lastN[2].startsWith("week") ? n * 7 : lastN[2].startsWith("month") ? n * 30 : n;
    return { from: addDays(today, -(days - 1)), to: today, label: `the last ${n} ${lastN[2].replace(/s$/, "")}${n === 1 ? "" : "s"}` };
  }
  if (/\b(last|past|previous)\s+week\b/.test(l)) return { ...weekRange(today, -1), label: "last week" };
  if (/\bnext\s+week\b/.test(l)) return { ...weekRange(today, 1), label: "next week" };
  if (/\b(this|current)\s+week\b|\bthe\s+week\b/.test(l)) return { ...weekRange(today, 0), label: "this week" };
  if (/\b(last|past|previous)\s+month\b/.test(l)) return { ...monthRange(today, -1), label: "last month" };
  if (/\bnext\s+month\b/.test(l)) return { ...monthRange(today, 1), label: "next month" };
  if (/\b(this|current)\s+month\b|\bthe\s+month\b/.test(l)) return { ...monthRange(today, 0), label: "this month" };
  if (/\b(last|past|previous)\s+year\b/.test(l)) {
    const y = Number(today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `last year (${y})` };
  }
  if (/\b(this|current)\s+year\b|\byear[\s-]to[\s-]date\b|\bytd\b/.test(l)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "this year so far" };
  const md = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(l);
  if (md) {
    const y = md[3] ? (md[3].length === 2 ? `20${md[3]}` : md[3]) : today.slice(0, 4);
    const d = `${y}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
    return { from: d, to: d, label: `on ${usY(d)}` };
  }
  return null;
}

/**
 * Is this an office-wide appointment count/list question? Returns the parsed query, or null.
 * `patientNames` (optional) lets a question that names a patient fall through to the patient flow:
 * only an exact, whole-word first or last name counts as naming one (never a fuzzy guess).
 */
export function parseApptStats(question: string, today: string, patientNames: string[] = []): ApptStatsQuery | null {
  const q = question.trim();
  if (!q || q.startsWith("/") || q.startsWith("@")) return null;
  if (!COUNT_OR_LIST.test(q)) return null;
  if (ONE_PATIENT.test(q) || CASES_WORD.test(q)) return null;
  // Commands are not questions: "cancel smith tomorrow", "mark kara no show".
  if (/^\s*(please\s+)?(cancel|reschedule|move|book|schedule|mark|set|change|add|put|log|make|send|text|remind)\b/i.test(q)) return null;
  const rule = STATUS_RULES.find((r) => r.re.test(q));
  if (!rule) return null;
  if (!APPT_WORD.test(q) && !/\b(cancel|no[\s-]?show|checked[\s-]?(?:in|out))/i.test(q)) return null;
  if (namesAPatient(q, patientNames) || asksAboutSomeone(q)) return null;
  const range = parseStatsRange(q, today);
  const wantList = /\b(list|show|which|who|names?|details?)\b/i.test(q);
  if (range) return { statuses: rule.statuses, statusLabel: rule.label, from: range.from, to: range.to, rangeLabel: range.label, needsRange: false, wantList };
  return { statuses: rule.statuses, statusLabel: rule.label, from: today, to: today, rangeLabel: "", needsRange: true, wantList };
}

/** Exact whole-word first or last name of a patient in the text (everyday words don't count). */
function namesAPatient(q: string, patientNames: string[]): boolean {
  if (!patientNames.length) return false;
  const words = new Set((q.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map((w) => w.replace(/'s$/, "")));
  for (const full of patientNames) {
    const parts = full.toLowerCase().replace(/,/g, " ").split(/\s+/).filter((p) => p.length >= 3);
    if (parts.some((p) => words.has(p) && !isNeverName(p))) return true;
    // A name that is also an everyday word (May, Will) counts only as "first last" together.
    const hits = parts.filter((p) => words.has(p));
    if (hits.length >= 2) return true;
  }
  return false;
}

/** "…does Smth have", "…for Tylr": a non-everyday word right after does/did/for/with is probably a patient (maybe misspelled). */
function asksAboutSomeone(q: string): boolean {
  const re = /\b(?:does|did|has|had|for|with|of)\s+(?!dr\b|doctor\b)([a-z][a-z'-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const w = m[1].toLowerCase().replace(/'s$/, "");
    if (!isEverydayWord(w) && !/^(us|we|me|you|them|everyone|everybody|anyone|each|all)$/.test(w)) return true;
  }
  return false;
}

/** Cheap intent check for callers that only need yes/no. */
export function isOfficeStatsQuestion(question: string, today: string, patientNames: string[] = []): boolean {
  return parseApptStats(question, today, patientNames) !== null;
}

const t12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
};

const ASK_OPTS = [
  ["Today", "today"],
  ["This week", "this week"],
  ["This month", "this month"],
  ["Last month", "last month"],
  ["All time", "all time"],
] as const;

/** A typed (or tapped) timeframe on its own ("this week", "today", "month") answering "For which time frame?". */
export function parseTimeframeReply(question: string, today: string): ReturnType<typeof parseStatsRange> {
  const q = question.trim().toLowerCase().replace(/[?.!]+$/, "").replace(/^(for|in|during|just|the|and|ok|okay)\s+/g, "").replace(/^(for|in|during|just|the)\s+/g, "");
  if (q.split(/\s+/).length > 5) return null;
  if (/^(week|month|year)$/.test(q)) return parseStatsRange(`this ${q}`, today);
  if (/^(all|ever|all time|all-time|overall|total)$/.test(q)) return parseStatsRange("all time", today);
  return parseStatsRange(q, today);
}

export function answerApptStats(query: ApptStatsQuery, data: PracticeData, question: string): OfficeAnswer {
  if (query.needsRange) {
    const verb = query.wantList ? "list" : "how many";
    const choices = ASK_OPTS.map(([label, w]) => ({ label, question: `${verb} ${query.statusLabel} appointments ${w}` }));
    return {
      text: `For which time frame? (${query.statusLabel} appointments)\nTap one, or type your own, like "last 30 days".`,
      choices,
      memory: { kind: "apptStatsAsk", statuses: query.statuses, statusLabel: query.statusLabel, list: query.wantList },
    };
  }
  const rows = data.appointments
    .filter((a: ScheduleAppointmentRecord) => query.statuses.includes(a.status) && a.date >= query.from && a.date <= query.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const n = rows.length;
  const span = query.from === "0000-01-01" ? "" : query.from === query.to ? ` (${usY(query.from)})` : query.to === "9999-12-31" ? ` (${us(query.from)} on)` : ` (${us(query.from)}–${us(query.to)})`;
  const noun = `${query.statusLabel} appointment${n === 1 ? "" : "s"}`;
  const head = n === 0 ? `No ${query.statusLabel} appointments ${query.rangeLabel}${span}.` : `${n} ${noun} ${query.rangeLabel}${span}.`;
  const lines: string[] = [];
  const links: ToolLink[] = [];
  const show = query.wantList || n <= 8 ? rows.slice(0, 25) : [];
  for (const a of show) {
    lines.push(`• ${us(a.date)} ${t12(a.startTime)} — ${a.patientName}${a.appointmentType ? `, ${a.appointmentType}` : ""}`);
    if (a.patientId && !links.some((l) => l.href === `/patients/${a.patientId}`)) links.push({ label: a.patientName, href: `/patients/${a.patientId}` });
  }
  const more = n > show.length && show.length ? `\n…and ${n - show.length} more. Ask "list ${query.statusLabel} appointments ${query.rangeLabel}" for all.` : "";
  const text = `${head}${lines.length ? `\n${lines.join("\n")}` : ""}${more}`;
  const base = `how many ${query.statusLabel} appointments`;
  const choices = ASK_OPTS.filter(([, w]) => w !== query.rangeLabel).map(([label, w]) => ({ label, question: `${base} ${w}` }));
  void question;
  return { text, links: links.length ? links.slice(0, 12) : undefined, choices, memory: { kind: "schedule", day: query.from === "0000-01-01" ? data.today : query.from } };
}

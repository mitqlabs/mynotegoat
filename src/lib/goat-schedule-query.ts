/**
 * Plain-wording schedule questions for G.O.A.T. (rules only, read-only):
 * "any upcoming new patients>", "new patients this week", "who's coming in tomorrow",
 * "any re-exams friday", "how many appointments today", "when is the next new patient".
 * Answers with a short list: date, time, patient (linked once), type, office.
 * Uses the same appointments the chat already loads, so office / role scoping is unchanged.
 */
import { dayLabel, resolveRequestedDay } from "@/lib/goat-howto";
import type { PracticeData, ToolLink } from "@/lib/goat-practice";
import type { OfficeAnswer } from "@/lib/goat-office";

type Appt = PracticeData["appointments"][number];

interface TypeFamily { label: string; ask: RegExp; type: RegExp }
const FAMILIES: TypeFamily[] = [
  { label: "new patient", ask: /\bnew\s*(?:pt|pts|patients?|patiens?|patints?|pateints?|paitents?|ones|intakes?|evals?)\b|\bnp(?:s)?\b|\bintakes?\b/, type: /\bnew\b|\bintake\b|\bnp\b|initial/i },
  { label: "re-exam", ask: /\bre[\s-]?exam\w*|\breexam\w*|\bre[\s-]?eval\w*/, type: /re[\s-]?exam|re[\s-]?eval/i },
  { label: "follow-up", ask: /\bfollow[\s-]?ups?\b|\bf\/u\b/, type: /follow/i },
  { label: "discharge", ask: /\bdischarg\w*/, type: /discharg/i },
  { label: "massage", ask: /\bmassages?\b/, type: /massage/i },
];

const SCHEDULEY = /\b(appointments?|appts?|apts?|schedul\w*|booked|coming(?:\s+in)?|on the books|visits?|upcoming|next|any|how many|who'?s|who is|who are|seeing|see)\b/;
const DONE = new Set(["Canceled", "No Show"]);

function norm(q: string): string {
  return q.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9'/\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function t12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

interface Range { from: string; to: string; label: string; open?: boolean }

function rangeFor(q: string, today: string): Range | null {
  const dow = new Date(`${today}T12:00:00`).getDay();
  if (/\bnext week\b/.test(q)) { const s = addDays(today, 7 - dow + 1); return { from: s, to: addDays(s, 6), label: "next week" }; }
  if (/\b(this|the) week\b|\bthis wk\b/.test(q)) return { from: today, to: addDays(today, 6 - dow), label: "this week" };
  if (/\bthis month\b/.test(q)) { const d = new Date(`${today}T12:00:00`); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); return { from: today, to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`, label: "this month" }; }
  if (/\b(next|coming) (\d+|few|couple of) days\b/.test(q)) { const n = Number(/(\d+)/.exec(q)?.[1] ?? 3); return { from: today, to: addDays(today, n), label: `in the next ${n} days` }; }
  const day = resolveRequestedDay(q, today);
  if (day) return { from: day.iso, to: day.iso, label: dayLabel(day.iso) };
  return null;
}

export interface ScheduleQuery { family: TypeFamily | null; range: Range; count: boolean; nextOnly: boolean }

/** Null when the question isn't a schedule lookup (bookings, to-dos, a named patient's file…). */
export function parseScheduleQuery(raw: string, today: string): ScheduleQuery | null {
  const q = norm(raw);
  if (!q || /\b(book|reschedule|cancel|move|add|create|make|set up|remind|note|tell|message|text)\b/.test(q)) return null;
  // Case questions ("how many discharged cases") are not schedule lookups.
  if (/\b(cases?|files?|checks?|status)\b/.test(q) && !/\b(appointments?|appts?|visits?|schedul\w*|booked|coming)\b/.test(q)) return null;
  const family = FAMILIES.find((f) => f.ask.test(q)) ?? null;
  const upcoming = /\b(upcoming|coming up|future|ahead|scheduled|next)\b/.test(q);
  const nextOnly = /\b(when'?s|when is|when are|what'?s|first)\b.*\bnext\b|\bnext\b.*\b(when|what day|date)\b|^next\b/.test(q) && !/\bnext (week|month|\d+ days)\b/.test(q);
  const count = /\bhow many\b|\bcount\b|\bnumber of\b/.test(q);
  let range = rangeFor(q, today);
  if (!family) {
    // Without a type, need clear schedule wording plus a time range ("who's coming in tomorrow").
    if (!range || !/\b(appointments?|appts?|apts?|schedul\w*|booked|coming|on the books|visits?|who'?s|who is|who are|seeing|patients?|pts)\b/.test(q)) return null;
    if (/\b(cases?|files?|active|submitted|checks?)\b/.test(q)) return null;
  } else if (!range && !upcoming && !SCHEDULEY.test(q) && !count) return null;
  // A plain single-day schedule ("who's coming tomorrow") keeps the existing day answer.
  if (!family && range && range.from === range.to) return null;
  if (!range) range = { from: today, to: addDays(today, 365), label: "coming up", open: true };
  return { family, range, count, nextOnly };
}

export function answerScheduleQuery(raw: string, data: PracticeData): OfficeAnswer | null {
  const sq = parseScheduleQuery(raw, data.today);
  if (!sq) return null;
  const { family, range } = sq;
  const hits = data.appointments
    .filter((a) => a.date >= range.from && a.date <= range.to && !DONE.has(a.status))
    .filter((a) => !family || family.type.test(a.appointmentType ?? ""))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const what = family ? `${family.label} appointment` : "appointment";
  const when = range.open ? "coming up" : range.from !== range.to ? range.label : range.from === data.today ? "today" : range.from === addDays(data.today, 1) ? "tomorrow" : `on ${range.label}`;
  if (!hits.length) {
    return { text: `No ${what}s ${when}.`, links: [{ label: "Open Schedule", href: `/appointments?date=${range.from}` }], memory: { kind: "schedule", day: range.from } };
  }
  const list = sq.nextOnly ? hits.slice(0, 1) : hits.slice(0, 15);
  const multiOffice = new Set(hits.map((a) => a.location?.trim()).filter(Boolean)).size > 1;
  const line = (a: Appt) => `• ${dayLabel(a.date)} ${t12(a.startTime)} — ${a.patientName}${a.appointmentType ? `, ${a.appointmentType}` : ""}${a.location?.trim() ? ` (${a.location.trim()})` : multiOffice ? " (no office set)" : ""}`;
  const head = sq.nextOnly
    ? `Next ${what}:`
    : `${hits.length} ${what}${hits.length === 1 ? "" : "s"} ${when}${sq.count ? "." : ":"}`;
  const body = list.map(line).join("\n") + (!sq.nextOnly && hits.length > list.length ? `\n…and ${hits.length - list.length} more on the Schedule.` : "");
  // Each patient linked once, in list order.
  const seen = new Set<string>();
  const links: ToolLink[] = [];
  for (const a of list) {
    if (!a.patientId || seen.has(a.patientId)) continue;
    seen.add(a.patientId);
    links.push({ label: a.patientName, href: `/patients/${a.patientId}` });
  }
  links.push({ label: `Open Schedule (${dayLabel(list[0].date)})`, href: `/appointments?date=${list[0].date}` });
  return { text: `${head}\n${body}`, links, memory: { kind: "schedule", day: list[0].date } };
}

/**
 * Last resort before giving up: a short clarifying question that guesses the area
 * (schedule / to-do / case / contact) instead of listing everything G.O.A.T. can do.
 */
export function clarifyIntent(raw: string, ctx?: { name?: string | null }): { text: string; choices: Array<{ label: string; question: string }> } {
  const q = norm(raw);
  const who = ctx?.name?.trim() || "";
  // One short, natural question. No menu of buttons.
  if (/\b(appt|appointment|schedul|coming|visit|book|calendar|new p|re-?exam|today|tomorrow|week|monday|tuesday|wednesday|thursday|friday|saturday)/.test(q)) {
    return { text: who ? `Do you mean ${who}'s visits, or the whole schedule?` : "Which day are you thinking — today, or later this week?", choices: [] };
  }
  if (/\b(to-?dos?|tasks?|remind|follow ?up|call back)\b/.test(q)) {
    return { text: "Want to see your to-dos, or add one? If adding, just tell me what and when.", choices: [] };
  }
  if (/\b(cases?|files?|mri|x-?ray|bill|balance|paid|submitted|attorney|atty|lawyer|settle)\b/.test(q)) {
    return { text: who ? `Is this about ${who}, or all your cases?` : "Which patient is this about — or do you mean all your cases?", choices: [] };
  }
  if (/\b(contact|fax|phone|number|email|address|imaging|law firm)\b/.test(q)) {
    return { text: "Which contact are you looking for?", choices: [] };
  }
  return { text: who ? `Sorry, I didn't catch that — is this about ${who}?` : "Sorry, I didn't catch that — what do you need?", choices: [] };
}

/**
 * Office questions in regular (rule-based) G.O.A.T.: to-do list, schedule (any day),
 * active / submitted case counts, contacts, Settings and how-to help, with short
 * follow-up memory ("and tomorrow?", "list them", "their fax?"). Read-only.
 */
import { dayLabel, resolveRequestedDay } from "@/lib/goat-howto";
import { detectPlainTodo } from "@/lib/goat-intents";
import { SETTING_QUESTION, answerPractice, listScope, detectPracticeIntent, findSettings, runPracticeTool, type PracticeChoice, type PracticeData, type PracticeIntent, type ToolLink } from "@/lib/goat-practice";

export interface OfficeMemory {
  kind: "todo" | "schedule" | "caseCount" | "caseSummary" | "contact";
  day?: string; // YYYY-MM-DD
  status?: string;
  contact?: string;
}

export interface OfficeAnswer {
  text: string;
  links?: ToolLink[];
  choices?: PracticeChoice[];
  memory?: OfficeMemory;
}

const SCHEDULE_WORDS = /\b(schedul\w*|appointments?|appts?|booked|coming in|who'?s coming|on the books|calendar)\b/i;
const CASE_SUMMARY = /\b(how many|count|number of)\b.*\b(cases?|patients?|files?)\b|\bcase (counts?|summary)\b|\bchecks? (waiting|pending|owed)\b/i;
const FOLLOW_LIST = /^(and |ok |so )?(list|show|name|which|who)( (them|those|those cases|ones|are they|the cases))?\??$/i;

function scheduleFor(iso: string, data: PracticeData): string {
  const appts = data.appointments.filter((a) => a.date === iso && a.status !== "Canceled").sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (iso === data.today || iso === addDays(data.today, 1)) {
    return answerPractice({ kind: "schedule", day: iso === data.today ? "today" : "tomorrow" }, data).text;
  }
  if (!appts.length) return `Nothing is scheduled ${dayLabel(iso)}.`;
  const lines = appts.slice(0, 30).map((a) => `• ${t12(a.startTime)} ${a.patientName}${a.appointmentType ? `, ${a.appointmentType}` : ""}${a.status && a.status !== "Scheduled" ? ` (${a.status})` : ""}`);
  return `${appts.length} appointment${appts.length === 1 ? "" : "s"} ${dayLabel(iso)}:\n${lines.join("\n")}${appts.length > 30 ? `\n…and ${appts.length - 30} more.` : ""}`;
}

function t12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function caseSummary(data: PracticeData): OfficeAnswer {
  const sc = listScope(data);
  const n = (s: string) => data.patients.filter((p) => p.caseStatus === s && (!sc || (p.listYear === sc && !p.cash))).length;
  return {
    text: `${sc ? `In ${sc} (same as the Patients list):\n` : ""}Active cases: ${n("Active")}.\nSubmitted (checks waiting): ${n("Submitted")}.${n("Ready To Submit") ? `\nReady to submit: ${n("Ready To Submit")}.` : ""}`,
    choices: [
      { label: "List active", question: "list active cases" },
      { label: "List submitted", question: "list submitted cases" },
    ],
    memory: { kind: "caseSummary" },
  };
}

function fromIntent(intent: PracticeIntent, data: PracticeData): OfficeAnswer {
  const a = answerPractice(intent, data);
  const memory: OfficeMemory =
    intent.kind === "caseCount" ? { kind: "caseCount", status: intent.status } : intent.kind === "contact" ? { kind: "contact", contact: intent.query } : intent.kind === "schedule" ? { kind: "schedule", day: intent.day === "today" ? data.today : addDays(data.today, 1) } : { kind: "todo" };
  return { text: a.text, choices: a.choices, memory };
}

/** A follow-up to the last office answer, if this is one. */
function followUp(question: string, data: PracticeData, last: OfficeMemory | null): OfficeAnswer | null {
  if (!last) return null;
  const q = question.trim().toLowerCase();
  const short = q.split(/\s+/).length <= 6;
  if (!short) return null;
  if (last.kind === "schedule" || (last.kind === "todo" && /\b(and|what about|how about)\b/.test(q))) {
    const day = resolveRequestedDay(question, data.today);
    if (day && last.kind === "schedule") return { text: scheduleFor(day.iso, data), memory: { kind: "schedule", day: day.iso } };
  }
  if ((last.kind === "caseCount" || last.kind === "caseSummary") && FOLLOW_LIST.test(q)) {
    const status = last.status ?? "Active";
    return { text: runPracticeTool({ name: "listCases", args: { status } }, data).text, memory: { kind: "caseCount", status } };
  }
  if (last.kind === "caseCount" || last.kind === "caseSummary") {
    const st = /submitted|checks?/.test(q) ? "Submitted" : /ready/.test(q) ? "Ready To Submit" : /active|open/.test(q) ? "Active" : /discharg/.test(q) ? "Discharged" : /dropped/.test(q) ? "Dropped" : /paid/.test(q) ? "Paid" : null;
    if (st && /^(and|what about|how about|ok|and the)?\b/.test(q)) return fromIntent({ kind: "caseCount", status: st as never, list: /\b(list|which|who|show)\b/.test(q) }, data);
  }
  if (last.kind === "contact" && last.contact && /\b(their|its|his|her|the)\b.*\b(fax|e-?mail|phone|number|address)\b|^(and )?(fax|e-?mail|phone)\??$/.test(q)) {
    const want = /fax/.test(q) ? "fax" : /mail/.test(q) ? "email" : /address/.test(q) ? "all" : "phone";
    return fromIntent({ kind: "contact", query: last.contact, want }, data);
  }
  return null;
}

/**
 * Answer an office question with rules only. Null when it isn't one.
 * `last` is the memory of the previous office answer (for follow-ups).
 */
export function answerOffice(question: string, data: PracticeData, last: OfficeMemory | null = null): OfficeAnswer | null {
  // A new to-do ("remind me to call YMPK …") is never an office lookup, even if it names a contact.
  if (detectPlainTodo(question)) return null;
  const f = followUp(question, data, last);
  if (f) return f;
  if (SETTING_QUESTION.test(question)) {
    const links = findSettings(question);
    return { text: links.length ? "You can change that here:" : "I couldn't find a Settings page for that. Settings has every option, grouped by page.", links: links.length ? links : [{ label: "Settings", href: "/settings" }] };
  }
  const intent = detectPracticeIntent(question);
  // "how many cases do I have" (no status) → active + submitted together.
  if ((!intent || intent.kind !== "caseCount") && CASE_SUMMARY.test(question) && !/\b(active|submitted|ready|discharged|dropped|paid)\b/i.test(question)) return caseSummary(data);
  // Schedule for any day ("schedule friday", "who's coming 10/20").
  if (SCHEDULE_WORDS.test(question) && (!intent || intent.kind === "schedule") && !/\b(book|make|set up|add|create)\b/i.test(question)) {
    const day = resolveRequestedDay(question, data.today);
    if (day) return { text: scheduleFor(day.iso, data), memory: { kind: "schedule", day: day.iso } };
    if (/\b(my|the|today'?s?)\s+schedule\b|\bwho'?s coming\b/i.test(question)) return { text: scheduleFor(data.today, data), memory: { kind: "schedule", day: data.today } };
  }
  if (intent) return fromIntent(intent, data);
  // "how many visits / patients did we have today" → the schedule count for that day.
  if (/\bhow many\b/i.test(question) && /\b(visits?|appointments?|appts?|patients?|people)\b/i.test(question) && !/\b(his|her|she|he|this patient)\b/i.test(question)) {
    const day = resolveRequestedDay(question, data.today) ?? { iso: data.today };
    const n = data.appointments.filter((a) => a.date === day.iso && a.status !== "Canceled").length;
    return { text: `${n} appointment${n === 1 ? "" : "s"} ${dayLabel(day.iso)} (canceled ones not counted).\n${scheduleFor(day.iso, data)}`, memory: { kind: "schedule", day: day.iso } };
  }
  return null;
}

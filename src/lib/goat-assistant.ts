/**
 * G.O.A.T. as a front-desk assistant (rules only, pure, mock-testable):
 *  - dailyBrief: one warm sentence on open ("Morning! You've got 3 visits today…")
 *  - nudges: a few things worth a look, from real data (dismissible in the UI)
 *  - normalizeCasual: typos / texting shorthand → words the other parsers know
 *  - splitSteps: "book John Wed 2pm and remind me to call his lawyer" → two steps
 */
import type { BriefData } from "@/lib/goat-briefs";

export interface AssistantPatient {
  id: string;
  fullName: string;
  caseStatus: string;
  attorney?: string;
  cash?: boolean;
  /** YYYY-MM-DD (or MM/DD/YYYY) initial exam, if known. */
  firstVisit?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ACTIVE = /^(active|open|treating|in treatment|new)$/i;
const isActive = (s: string) => ACTIVE.test((s ?? "").trim());
const live = (status: string) => !/cancel|no show|reschedul/i.test(status);

export function hello(hour: number): string {
  return hour < 12 ? "Morning!" : hour < 17 ? "Hi there!" : "Evening!";
}

/** The first given name from "Last, First" or "First Last". */
export function firstName(full: string): string {
  const [a, b] = full.split(",").map((x) => x.trim());
  return (b ? b : a).split(/\s+/)[0] ?? full;
}

/**
 * One short, human brief. Office money/case numbers only for admins.
 * "Morning! You've got 3 visits today (1 new patient), 2 to-dos overdue, and 4 cases waiting on checks."
 */
export function dailyBrief(data: BriefData, hour: number, isAdmin: boolean): string {
  const todays = data.appointments.filter((a) => a.date === data.today && live(a.status));
  const newPts = todays.filter((a) => /new patient|initial|eval/i.test(a.appointmentType ?? "")).length;
  const overdue = data.tasks.filter((t) => !t.done && t.dueDate && t.dueDate < data.today).length;
  const dueToday = data.tasks.filter((t) => !t.done && t.dueDate === data.today).length;
  const checks = isAdmin ? data.patients.filter((p) => /^submitted$/i.test(p.caseStatus)).length : 0;
  const parts: string[] = [];
  parts.push(todays.length ? `${plural(todays.length, "visit")} today${newPts ? ` (${plural(newPts, "new patient")})` : ""}` : "a clear schedule today");
  if (overdue) parts.push(`${plural(overdue, "to-do")} overdue`);
  if (dueToday) parts.push(`${plural(dueToday, "to-do")} due today`);
  if (checks) parts.push(`${plural(checks, "case")} waiting on checks`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0];
  return `${hello(hour)} You've got ${list}.`;
}

export interface Nudge {
  id: string;
  text: string;
  href?: string;
  /** A question G.O.A.T. can answer when tapped. */
  question?: string;
}

/** Up to `max` things worth a look, most useful first. Nothing is changed. */
export function nudges(data: BriefData, people: AssistantPatient[], max = 3): Nudge[] {
  const out: Nudge[] = [];
  const active = people.filter((p) => isActive(p.caseStatus));
  const overdue = data.tasks.filter((t) => !t.done && t.dueDate && t.dueDate < data.today);
  if (overdue.length) {
    const t = overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    out.push({ id: `todo-overdue-${overdue.length}`, text: overdue.length === 1 ? `"${t.title}" is overdue.` : `${overdue.length} to-dos are overdue — the oldest is "${t.title}".`, href: "/patients?view=toDo" });
  }
  const noIe = active.filter((p) => !(p.firstVisit ?? "").trim());
  if (noIe.length) {
    out.push({ id: `no-ie-${noIe.length}`, text: noIe.length === 1 ? `${firstName(noIe[0].fullName)} doesn't have an Initial Exam date yet.` : `${noIe.length} active cases don't have an Initial Exam date yet (like ${firstName(noIe[0].fullName)}).`, href: `/patients/${noIe[0].id}` });
  }
  const noAtty = active.filter((p) => !p.cash && !/\S/.test((p.attorney ?? "").replace(/^self$/i, "")));
  if (noAtty.length) {
    out.push({ id: `no-atty-${noAtty.length}`, text: noAtty.length === 1 ? `${firstName(noAtty[0].fullName)}'s case has no attorney on file.` : `${noAtty.length} PI cases have no attorney on file (like ${firstName(noAtty[0].fullName)}).`, href: `/patients/${noAtty[0].id}` });
  }
  const booked = new Set(data.appointments.filter((a) => a.date >= data.today && live(a.status)).map((a) => a.patientId));
  const unbooked = active.filter((p) => !booked.has(p.id) && (p.firstVisit ?? "").trim());
  if (unbooked.length) {
    out.push({ id: `unbooked-${unbooked.length}`, text: unbooked.length === 1 ? `${firstName(unbooked[0].fullName)} is active but has nothing booked.` : `${unbooked.length} active patients have nothing booked (like ${firstName(unbooked[0].fullName)}).`, href: `/patients/${unbooked[0].id}` });
  }
  return out.slice(0, max);
}

// Typos and texting shorthand → plain words. Whole words only; case kept loosely.
const CASUAL: Array<[RegExp, string]> = [
  [/\b(?:tmrw|tmr|tmrow|2moro|2morrow|tomorow|tommorow|tommorrow|tomorrw|tomorro)\b/gi, "tomorrow"],
  [/\b(?:2day|tday)\b/gi, "today"],
  [/\b(?:pls|plz|plez)\b/gi, "please"],
  [/\bu\b/gi, "you"],
  [/\bur\b/gi, "your"],
  [/\bw\/(?=\s)/gi, "with"],
  [/\b(?:remind me 2|remind me too|remind me t)\b/gi, "remind me to"],
  [/\b(?:lawer|layer|lawyr|laywer)\b/gi, "lawyer"],
  [/\b(?:atorney|attorny|attourney|attoney)\b/gi, "attorney"],
  [/\b(?:schedual|scedule|shedule|schedul)\b/gi, "schedule"],
  [/\b(?:apointment|appoinment|appointmnet|appoitment|apptment)\b/gi, "appointment"],
  [/\b(?:wendsday|wensday|wedensday|wedsday)\b/gi, "wednesday"],
  [/\b(?:thrusday|thurdsay|thursdy)\b/gi, "thursday"],
  [/\b(?:tuesdy|teusday)\b/gi, "tuesday"],
  [/\b(?:fri day|firday)\b/gi, "friday"],
  [/\b(?:mon day|monady)\b/gi, "monday"],
  [/\b(?:satruday|saterday)\b/gi, "saturday"],
  [/\b(?:remindr|remmind|reimnd)\b/gi, "remind"],
  [/\b(?:boook|bok)\b/gi, "book"],
  [/\b(?:pt)\b(?=\s+(?:named|called|[A-Z]))/g, "patient"],
];
export function normalizeCasual(text: string): string {
  let t = text;
  for (const [re, to] of CASUAL) t = t.replace(re, to);
  return t.replace(/\s{2,}/g, " ").trim();
}

const STEP_START = /\b(?:and|also|then|plus|&)\s+(?:then\s+|also\s+)?(?=(?:please\s+)?(?:remind me|add (?:a )?(?:note|to-?do)|book|schedule|tell|message|text|let \w+ know|make (?:a )?(?:note|to-?do)|note that|put (?:a )?note)\b)/i;
/**
 * Split a message holding two requests. Only splits when BOTH halves start with
 * a known action, so "book John and Jane" or "add a note: X and Y" stay whole.
 */
export function splitSteps(text: string): string[] {
  const q = text.trim();
  if (/\n/.test(q) || q.startsWith("/") || q.startsWith("@")) return [q];
  const lead = /^(?:please\s+|can you\s+|could you\s+|pls\s+)?(?:remind me|add (?:a )?(?:note|to-?do)|book|schedule|tell|message|text|make (?:a )?(?:note|to-?do)|put (?:a )?note)\b/i;
  if (!lead.test(q)) return [q];
  // "add a note …: … and …" keeps its text whole.
  if (/^(?:please\s+)?(?:add|make|put) (?:a )?note\b[^:]*:/i.test(q)) return [q];
  const m = STEP_START.exec(q);
  if (!m || m.index < 4) return [q];
  const a = q.slice(0, m.index).replace(/[,;\s]+$/, "").trim();
  const b = q.slice(m.index + m[0].length).trim();
  if (!a || !b) return [q];
  return [a, ...splitSteps(b)];
}

/** "remind me to call his lawyer" after "book John Smith…" → "remind me to call John Smith's lawyer". */
export function carryPatient(step: string, fullName: string): string {
  const name = fullName.includes(",") ? `${firstName(fullName)} ${fullName.split(",")[0].trim()}` : fullName;
  if (step.toLowerCase().includes(name.toLowerCase())) return step;
  if (/\b(his|her|their)\b/i.test(step)) return step.replace(/\b(his|her|their)\b/i, `${name}'s`);
  if (/\b(him|them)\b/i.test(step)) return step.replace(/\b(him|them)\b/i, name);
  return step;
}

/** "Wed, 10/22/2026" — weekday plus the full date, for confirm cards. */
export function cardDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}, ${m[2]}/${m[3]}/${m[1]}`;
}

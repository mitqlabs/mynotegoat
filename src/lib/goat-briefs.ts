/**
 * G.O.A.T. office briefs (rules only, read-only): greeting + chips, Morning
 * Rundown, Appointment Check, Quick Biz, and the "/" command menu.
 * Pure: everything comes in as plain data.
 */

export interface BriefPatient {
  id: string;
  fullName: string;
  caseStatus: string;
  locationId?: string;
  /** YYYY-MM-DD of the initial exam / first visit, if known. */
  firstVisit?: string;
  billed?: number;
  paid?: number;
  /** MM/DD/YYYY */
  paidDate?: string;
  cash?: boolean;
}
export interface BriefAppt {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  startTime: string;
  status: string;
  appointmentType?: string;
  location?: string;
}
export interface BriefTask {
  id: string;
  title: string;
  done: boolean;
  dueDate: string;
  patientName?: string;
  assignee?: string;
}
export interface BriefLocation {
  id: string;
  name: string;
  nickname?: string;
}
export interface BriefData {
  today: string; // YYYY-MM-DD
  patients: BriefPatient[];
  appointments: BriefAppt[];
  tasks: BriefTask[];
  locations: BriefLocation[];
  unreadMessages?: number;
}
export interface BriefLink {
  label: string;
  href: string;
}
export interface BriefAnswer {
  text: string;
  links?: BriefLink[];
}

export const CHIPS = ["Morning Rundown", "Appointment Check", "Quick Biz"] as const;
/** Appointment Check and Quick Biz are for admins (workspace owner/admin). */
export const ADMIN_BRIEFS = new Set<BriefKind>(["apptCheck", "business"]);
export type BriefKind = "rundown" | "apptCheck" | "business";
/** The greeting chips this person sees. */
export function chipsFor(isAdmin: boolean): string[] {
  return isAdmin ? [...CHIPS] : ["Morning Rundown"];
}
export function briefAllowed(kind: BriefKind, isAdmin: boolean): boolean {
  return isAdmin || !ADMIN_BRIEFS.has(kind);
}
export const ADMIN_ONLY_REPLY = "Sorry — that's for admins. Ask the office owner or an admin if you need those numbers. I can still give you the Morning Rundown.";

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning!";
  if (hour < 17) return "Good afternoon!";
  return "Good evening!";
}

const pad = (n: number) => String(n).padStart(2, "0");
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dow(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Sunday ending this week (Mon–Sun week). */
export function endOfWeek(today: string): string {
  return addDays(today, (7 - dow(today)) % 7);
}
export function startOfWeek(today: string): string {
  return addDays(today, -((dow(today) + 6) % 7));
}
const us = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : iso);
const usToIso = (s?: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? "").trim());
  return m ? `${m[3]}-${pad(+m[1])}-${pad(+m[2])}` : /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? s! : "";
};
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const isActive = (p: BriefPatient) => p.caseStatus === "Active";
const live = (a: BriefAppt) => !/cancel|no show|reschedul/i.test(a.status);
function time12(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
const patientLink = (p: { id: string; fullName: string }): BriefLink => ({ label: p.fullName, href: `/patients/${encodeURIComponent(p.id)}` });
const byName = (a: { fullName: string }, b: { fullName: string }) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
const locName = (data: BriefData, id?: string) => {
  const l = data.locations.find((x) => x.id === id);
  return l ? l.nickname || l.name : "No office";
};

/** Which brief a message asks for (chips and casual wording), or null. */
export function detectBrief(raw: string): BriefKind | null {
  const q = raw.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(morning )?rundown$|\bmorning (rundown|brief|briefing|report|summary)\b|\b(daily|day's|today's) (rundown|brief|briefing|summary)\b|^(give me|what's|whats) (the )?(rundown|run down)\b|\bhow does (today|my day) look\b|\bwhat's my day( look like)?\b/.test(q)) return "rundown";
  if (/^appointment check$|^appt check$|\bwho (needs|need) (to be )?(scheduled|rebooked|booked)\b|\b(not|isn't|aren't|nothing) (scheduled|booked) (for |past |after )?next week\b|\bno (future|next week) (appts?|appointments)\b|\bneed(s)? (to be )?scheduled\b|\bwho (isn't|is not|aren't|are not) (scheduled|booked)\b/.test(q)) return "apptCheck";
  if (/^quick ?biz$|\bquick (biz|business)( stats| numbers)?\b|^know (your|my|the) business$|\bhow('s| is) (the )?business\b|\bbusiness (stats|numbers|overview|summary)\b|\b(practice|office|clinic) (stats|numbers|overview)\b|\bkpis?\b|\bhow are we doing\b|\bour numbers\b/.test(q)) return "business";
  return null;
}

/** Active patients seen this week (today..Sunday) with nothing booked after this week. */
export function appointmentCheck(data: BriefData): BriefAnswer {
  const end = endOfWeek(data.today);
  const act = data.patients.filter(isActive);
  const need = act.filter((p) => {
    const mine = data.appointments.filter((a) => a.patientId === p.id && live(a));
    return mine.some((a) => a.date >= data.today && a.date <= end) && !mine.some((a) => a.date > end);
  }).sort(byName);
  if (!need.length) return { text: `Everyone active with a visit this week (through ${us(end)}) already has something booked for next week or later.` };
  const lastVisit = (id: string) => data.appointments.filter((a) => a.patientId === id && live(a) && a.date <= end).map((a) => a.date).sort().at(-1) ?? "";
  return {
    text: `${need.length} active patient${need.length === 1 ? "" : "s"} need${need.length === 1 ? "s" : ""} to be scheduled — visit this week, nothing booked after ${us(end)}:\n${need.map((p) => `- ${p.fullName} (last this week: ${us(lastVisit(p.id))})`).join("\n")}`,
    links: need.map(patientLink),
  };
}

export function morningRundown(data: BriefData): BriefAnswer {
  const todays = data.appointments.filter((a) => a.date === data.today && live(a)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const multi = data.locations.length > 1;
  const sched = todays.length
    ? todays.map((a) => `- ${time12(a.startTime)} ${a.patientName}${a.appointmentType ? ` · ${a.appointmentType}` : ""}${multi && a.location ? ` · ${a.location}` : ""}`).join("\n")
    : "- Nothing on the schedule.";
  const due = data.tasks.filter((t) => !t.done && t.dueDate && t.dueDate <= data.today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const todo = due.length ? due.slice(0, 10).map((t) => `- ${t.title}${t.dueDate < data.today ? ` (overdue, ${us(t.dueDate)})` : ""}${t.assignee ? ` · ${t.assignee}` : ""}`).join("\n") + (due.length > 10 ? `\n- …and ${due.length - 10} more` : "") : "- Nothing due.";
  const unread = data.unreadMessages ?? 0;
  return {
    text: [
      `Today (${us(data.today)}): ${todays.length} visit${todays.length === 1 ? "" : "s"}`,
      sched,
      `\nTo-dos due: ${due.length}`,
      todo,
      `\nTeam messages: ${unread ? `${unread} unread` : "all caught up"}`,
    ].join("\n"),
    links: [{ label: "Open Schedule", href: `/appointments?date=${data.today}` }, ...(due.length ? [{ label: "Open To-Do", href: "/tasks" }] : []), ...(unread ? [{ label: "Open Messages", href: "/messages" }] : [])],
  };
}

/** Quick Biz (admins): case counts, new patients, visits, collections — by office. */
export function quickBiz(data: BriefData): BriefAnswer {
  const month = data.today.slice(0, 7);
  const ws = startOfWeek(data.today);
  const visits = (from: string, pred: (a: BriefAppt) => boolean = () => true) => data.appointments.filter((a) => live(a) && a.date >= from && a.date <= data.today && pred(a)).length;
  const paidMonth = (ps: BriefPatient[]) => ps.filter((p) => (p.paid ?? 0) > 0 && usToIso(p.paidDate).startsWith(month)).reduce((s, p) => s + (p.paid ?? 0), 0);
  const officeOf = new Map(data.patients.map((p) => [p.id, p.locationId]));
  /** Office of a visit: the patient's office, else the visit's own location text. */
  const visitOffice = (a: BriefAppt) => {
    const id = officeOf.get(a.patientId);
    if (id && data.locations.some((l) => l.id === id)) return id;
    const t = (a.location ?? "").trim().toLowerCase();
    return data.locations.find((l) => t && (l.name.toLowerCase() === t || (l.nickname ?? "").toLowerCase() === t))?.id ?? "";
  };
  const block = (ps: BriefPatient[], inMine: (a: BriefAppt) => boolean) => {
    return [
      `${ps.filter(isActive).length} active · ${ps.filter((p) => p.caseStatus === "Submitted").length} submitted · ${ps.filter((p) => p.caseStatus === "Ready To Submit").length} ready to submit`,
      `${ps.filter((p) => (p.firstVisit ?? "").startsWith(month)).length} new patients this month`,
      `${visits(ws, inMine)} visits this week · ${visits(`${month}-01`, inMine)} this month`,
      `${money(paidMonth(ps))} collected this month`,
    ];
  };
  const lines = [`Quick Biz (${us(data.today)})`, ...block(data.patients, () => true).map((l) => `- ${l}`)];
  if (data.locations.length > 1) {
    for (const l of data.locations) {
      const ps = data.patients.filter((p) => p.locationId === l.id);
      lines.push(`\n${locName(data, l.id)}`, ...block(ps, (a) => visitOffice(a) === l.id).map((x) => `- ${x}`));
    }
    const none = data.patients.filter((p) => !data.locations.some((l) => l.id === p.locationId));
    if (none.length) lines.push(`\nNo office set: ${none.length} patient${none.length === 1 ? "" : "s"}`);
  }
  return { text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// "/" commands
// ---------------------------------------------------------------------------

export interface SlashCommand {
  cmd: string;
  hint: string;
  example: string;
}
/** Add a command here and handle it in trySlash (global-goat); the menu picks it up. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "note", hint: "Add a signed note to a case", example: "/note John Smith: spoke to atty" },
  { cmd: "todo", hint: "Add a to-do, on its own or for a case", example: "/todo call Mock Law for John Smith friday" },
  { cmd: "contact", hint: "Add contacts (one or a pasted list) or edit one", example: "/contact" },
];

/** The "/" being typed at the start of the input ("/no" → "no"), or null. */
export function slashQuery(input: string): string | null {
  const m = /^\/([a-z]*)$/i.exec(input);
  return m ? m[1].toLowerCase() : null;
}
export function slashMatches(query: string): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(query.toLowerCase()));
}
export function parseSlash(input: string): { cmd: string; rest: string } | null {
  const m = /^\/([a-z]+)\b\s*([\s\S]*)$/i.exec(input.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  return SLASH_COMMANDS.some((c) => c.cmd === cmd) ? { cmd, rest: m[2].trim() } : null;
}

/** "/note john smith: text" → the add-note wording the note dialog already understands. */
export function noteWording(rest: string): string {
  if (!rest) return "add a note";
  const c = /^([^:]+?)\s*[:\-–—]\s*([\s\S]+)$/.exec(rest);
  return c ? `add a note for ${c[1].trim()}: ${c[2].trim()}` : `add a note for ${rest}`;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Due date words in a to-do ("today", "tomorrow", "friday", "10/20", "in 3 days"), as ISO, plus the text without them. */
export function takeDueDate(text: string, today: string): { due: string; rest: string } {
  const re = /\b(?:due\s+|by\s+|on\s+)?(today|tomorrow|tmrw|(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|in\s+(\d+)\s+days?|next week)\b/i;
  const m = re.exec(text);
  if (!m) return { due: "", rest: text.trim() };
  const w = m[1].toLowerCase();
  let due = "";
  if (w === "today") due = today;
  else if (w === "tomorrow" || w === "tmrw") due = addDays(today, 1);
  else if (w === "next week") due = addDays(startOfWeek(today), 7);
  else if (m[2]) due = addDays(today, +m[2]);
  else if (/^\d/.test(w)) {
    const [mo, d, y] = w.split("/");
    const year = y ? (y.length === 2 ? 2000 + +y : +y) : +today.slice(0, 4);
    due = `${year}-${pad(+mo)}-${pad(+d)}`;
    if (!y && due < today) due = `${year + 1}-${pad(+mo)}-${pad(+d)}`;
  } else {
    const t = DAYS.indexOf(w.replace(/^next\s+/, ""));
    let ahead = (t - dow(today) + 7) % 7;
    if (ahead === 0 || /^next/.test(w)) ahead += ahead === 0 ? 7 : 0;
    due = addDays(today, ahead);
  }
  return { due, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
}

/** "/todo …" pieces: optional "Name: title", the title, and a due date. */
export function parseTodo(rest: string, today: string): { name: string | null; title: string; due: string } {
  const c = /^([^:]{2,40}?)\s*:\s*([\s\S]+)$/.exec(rest);
  const name = c ? c[1].trim() : null;
  const body = c ? c[2] : rest;
  const { due, rest: title } = takeDueDate(body, today);
  return { name, title: title.replace(/^[,\-–—\s]+|[,\-–—\s]+$/g, ""), due };
}

/** Old name, kept for callers. */
export const knowYourBusiness = quickBiz;

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
  patientId?: string;
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
export const ACCESS_LOADING_REPLY = "One moment — I'm still checking your access. Try again in a few seconds.";
/**
 * Fail-closed admin check for office stats. Null = allowed; otherwise the
 * reply to show (role still loading → "checking", known non-admin → "admins").
 */
export function adminStatsGate(roleKnown: boolean, isAdmin: boolean): string | null {
  if (!roleKnown) return ACCESS_LOADING_REPLY;
  return isAdmin ? null : ADMIN_ONLY_REPLY;
}
/** Office-answer kinds that are stats (Quick Biz territory). */
export function isStatsOfficeKind(kind: string | undefined): boolean {
  return kind === "caseCount" || kind === "caseSummary";
}
export const ADMIN_ONLY_REPLY = "Sorry — office numbers (case counts, money, Appointment Check, Quick Biz) are for admins. Ask the office owner or an admin if you need them. I can still give you the Morning Rundown.";

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

function daysBetween(a: string, b: string): number {
  const t = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export interface ApptCheckGroups {
  /** Active, nothing booked today or later. Never-seen first, then longest since last visit. */
  noneBooked: Array<{ patient: BriefPatient; lastVisit: string; daysAgo: number | null }>;
  /** Active, a visit between today and Sunday, nothing after this week. */
  runningOut: Array<{ patient: BriefPatient; lastThisWeek: string }>;
}

/** Appointment Check groups (canceled / no-show / rescheduled visits don't count). */
export function appointmentCheckGroups(data: BriefData): ApptCheckGroups {
  const end = endOfWeek(data.today);
  const noneBooked: ApptCheckGroups["noneBooked"] = [];
  const runningOut: ApptCheckGroups["runningOut"] = [];
  for (const p of data.patients.filter(isActive)) {
    const dates = data.appointments.filter((a) => a.patientId === p.id && live(a)).map((a) => a.date).sort();
    const thisWeek = dates.filter((d) => d >= data.today && d <= end);
    if (thisWeek.length) {
      if (!dates.some((d) => d > end)) runningOut.push({ patient: p, lastThisWeek: thisWeek.at(-1)! });
      continue;
    }
    if (dates.some((d) => d >= data.today)) continue; // booked after this week
    const last = dates.filter((d) => d < data.today).at(-1) ?? "";
    noneBooked.push({ patient: p, lastVisit: last, daysAgo: last ? daysBetween(last, data.today) : null });
  }
  noneBooked.sort((a, b) => (a.daysAgo === null ? -1 : 0) - (b.daysAgo === null ? -1 : 0) || (b.daysAgo ?? 0) - (a.daysAgo ?? 0) || byName(a.patient, b.patient));
  runningOut.sort((a, b) => byName(a.patient, b.patient));
  return { noneBooked, runningOut };
}

/** Admins: who needs to be scheduled, most urgent first. */
export function appointmentCheck(data: BriefData): BriefAnswer {
  const end = endOfWeek(data.today);
  const { noneBooked, runningOut } = appointmentCheckGroups(data);
  if (!noneBooked.length && !runningOut.length) return { text: `Every active patient has a visit booked after this week (through ${us(end)}).` };
  const lines = [`Appointment Check — ${noneBooked.length + runningOut.length} active patient${noneBooked.length + runningOut.length === 1 ? "" : "s"} need to be scheduled`];
  lines.push(`\nNo appointments booked (${noneBooked.length})`);
  lines.push(...(noneBooked.length ? noneBooked.map((r) => `- ${r.patient.fullName} — ${r.lastVisit ? `last visit ${us(r.lastVisit)} (${r.daysAgo} day${r.daysAgo === 1 ? "" : "s"} ago)` : "⚠ no visits ever"}`) : ["- None"]));
  lines.push(`\nRunning out this week (${runningOut.length})`);
  lines.push(...(runningOut.length ? runningOut.map((r) => `- ${r.patient.fullName} — last this week ${us(r.lastThisWeek)}, nothing after ${us(end)}`) : ["- None"]));
  return { text: lines.join("\n"), links: [...noneBooked.map((r) => patientLink(r.patient)), ...runningOut.map((r) => patientLink(r.patient))] };
}

export function morningRundown(data: BriefData): BriefAnswer {
  const todays = data.appointments.filter((a) => a.date === data.today && live(a)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const multi = data.locations.length > 1;
  const sched = todays.length
    ? todays.map((a) => `- ${time12(a.startTime)} ${a.patientName}${a.appointmentType ? ` · ${a.appointmentType}` : ""}${multi && a.location ? ` · ${a.location}` : ""}`).join("\n")
    : "- Nothing on the schedule.";
  const open = openTodos(data);
  const due = open;
  const todo = open.length ? open.slice(0, 15).map((t) => `- ${todoLine(t, data.today)}`).join("\n") + (open.length > 15 ? `\n- …and ${open.length - 15} more (/view todo)` : "") : "- Nothing open.";
  const unread = data.unreadMessages ?? 0;
  return {
    text: [
      `Today (${us(data.today)}): ${todays.length} visit${todays.length === 1 ? "" : "s"}`,
      sched,
      `\nOpen to-dos: ${due.length}`,
      todo,
      `\nTeam messages: ${unread ? `${unread} unread` : "all caught up"}`,
    ].join("\n"),
    links: [{ label: "Open Schedule", href: `/appointments?date=${data.today}` }, ...(due.length ? [{ label: "Open To-Do", href: "/tasks" }] : []), ...(unread ? [{ label: "Open Messages", href: "/messages" }] : [])],
  };
}

/** All open to-dos: overdue first, then by due date, then undated. */
export function openTodos(data: Pick<BriefData, "tasks" | "today">): BriefTask[] {
  const rank = (t: BriefTask) => (!t.dueDate ? 2 : t.dueDate < data.today ? 0 : 1);
  return data.tasks.filter((t) => !t.done).sort((a, b) => rank(a) - rank(b) || (a.dueDate || "").localeCompare(b.dueDate || "") || a.title.localeCompare(b.title));
}
function todoLine(t: BriefTask, today: string): string {
  const due = !t.dueDate ? "no due date" : t.dueDate < today ? `overdue, ${us(t.dueDate)}` : t.dueDate === today ? "due today" : `due ${us(t.dueDate)}`;
  return `${t.title} (${due})${t.patientName ? ` · ${t.patientName}` : ""}${t.assignee ? ` · ${t.assignee}` : ""}`;
}

// ---- /view ----
export type ViewTarget = "todo" | "schedule" | "messages" | "apptCheck" | "business";
export const VIEW_TARGETS: Array<{ target: ViewTarget; word: string; hint: string; admin?: boolean }> = [
  { target: "todo", word: "todo", hint: "All open to-dos" },
  { target: "schedule", word: "schedule", hint: "Today's schedule" },
  { target: "messages", word: "messages", hint: "Unread team messages" },
  { target: "apptCheck", word: "appointment check", hint: "Who needs to be scheduled", admin: true },
  { target: "business", word: "quick biz", hint: "Cases, visits, collections", admin: true },
];
/** Targets this person may see. */
export function viewTargetsFor(isAdmin: boolean) {
  return VIEW_TARGETS.filter((v) => isAdmin || !v.admin);
}
/** "/view qu" → "qu" (the target being typed), else null. */
export function viewQuery(input: string): string | null {
  const m = /^\/view\s+([a-z ]*)$/i.exec(input);
  return m ? m[1].toLowerCase() : null;
}
export function viewMatches(q: string, isAdmin: boolean) {
  const t = q.trim().toLowerCase();
  return viewTargetsFor(isAdmin).filter((v) => v.word.startsWith(t) || v.word.replace(/\s/g, "").startsWith(t.replace(/\s/g, "")));
}
export function parseViewTarget(rest: string): ViewTarget | null {
  const t = rest.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
  if (!t) return null;
  if (/^(todos?|to dos?|tasks?)$/.test(t)) return "todo";
  if (/^(schedule|today|appointments|appts|calendar)( today)?$/.test(t)) return "schedule";
  if (/^(messages?|unread|msgs?|inbox)$/.test(t)) return "messages";
  if (/^(appointment check|appt check|appointments check|apptcheck)$/.test(t)) return "apptCheck";
  if (/^(quick ?biz|business|kyb|know your business)$/.test(t)) return "business";
  return null;
}
export function viewTodos(data: BriefData): BriefAnswer {
  const open = openTodos(data);
  if (!open.length) return { text: "No open to-dos. 🎉", links: [{ label: "Open To-Do", href: "/tasks" }] };
  const linked = open.filter((t) => t.patientId);
  return {
    text: `Open to-dos (${open.length}):\n${open.map((t) => `- ${todoLine(t, data.today)}`).join("\n")}`,
    links: [{ label: "Open To-Do", href: "/tasks" }, ...linked.filter((t, i) => linked.findIndex((x) => x.patientId === t.patientId) === i).map((t) => ({ label: t.patientName || "Patient", href: `/patients/${encodeURIComponent(t.patientId!)}` }))],
  };
}
export function viewSchedule(data: BriefData): BriefAnswer {
  const todays = data.appointments.filter((a) => a.date === data.today && live(a)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const multi = data.locations.length > 1;
  return {
    text: todays.length ? `Today (${us(data.today)}): ${todays.length} visit${todays.length === 1 ? "" : "s"}\n${todays.map((a) => `- ${time12(a.startTime)} ${a.patientName}${a.appointmentType ? ` · ${a.appointmentType}` : ""}${multi && a.location ? ` · ${a.location}` : ""}`).join("\n")}` : `Nothing on the schedule today (${us(data.today)}).`,
    links: [{ label: "Open Schedule", href: `/appointments?date=${data.today}` }, ...todays.filter((a, i) => a.patientId && todays.findIndex((x) => x.patientId === a.patientId) === i).map((a) => ({ label: a.patientName, href: `/patients/${encodeURIComponent(a.patientId)}` }))],
  };
}
export function viewMessages(data: BriefData): BriefAnswer {
  const n = data.unreadMessages ?? 0;
  return { text: n ? `You have ${n} unread team message${n === 1 ? "" : "s"}.` : "No unread team messages — all caught up.", links: [{ label: "Open Messages", href: "/messages" }] };
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
  { cmd: "view", hint: "See a list: todo, schedule, messages (admins: appointment check, quick biz)", example: "/view todo" },
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

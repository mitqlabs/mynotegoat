/**
 * Practice-level G.O.A.T. questions (not about one patient): to-do list,
 * today's / tomorrow's schedule, case status counts, contact numbers.
 * All local: reads the same stores the app already has in this browser.
 * + mode only: regular G.O.A.T. stays patient-only. NoteGoat computes exact
 * figures here; the local model writes the answer from practiceSnapshot().
 */
import type { CaseStatus, ContactRecord } from "@/lib/mock-data";
import type { TaskRecord } from "@/lib/tasks";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { editDistance } from "@/lib/goat-ai/global-chat";
import { settingsHref, settingsSearchCatalog, GOAT_SETTINGS_PAGE } from "@/lib/settings-catalog";

export interface PracticePatient {
  id: string;
  fullName: string;
  caseStatus: CaseStatus;
  attorney: string;
}

export interface PracticeData {
  patients: PracticePatient[];
  tasks: TaskRecord[];
  appointments: ScheduleAppointmentRecord[];
  contacts: ContactRecord[];
  /** Today, YYYY-MM-DD (local). */
  today: string;
}

export type PracticeIntent =
  | { kind: "todo" }
  | { kind: "schedule"; day: "today" | "tomorrow" }
  | { kind: "caseCount"; status: CaseStatus; list: boolean }
  | { kind: "contact"; query: string; want: "phone" | "fax" | "email" | "all" };

export interface PracticeChoice {
  label: string;
  /** Question to re-run when tapped. */
  question: string;
}

export interface PracticeAnswer {
  text: string;
  choices?: PracticeChoice[];
}

const words = (q: string) => (q.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((w) => w.replace(/'s$/, ""));

/** A word of the question is `target`, allowing one typo for longer words. */
function hasWord(ws: string[], ...targets: string[]): boolean {
  return ws.some((w) => targets.some((t) => w === t || (t.length >= 5 && w.length >= 4 && editDistance(w, t) <= 1)));
}

const CONTACT_FIELD = /\b(numbers?|phone|ph|tel|telephone|call|fax|email|e-mail|contact info|cell)\b/i;
const CONTACT_STOP = new Set(
  "what whats what's is the a an for of give me get need find number numbers phone fax email e-mail tel telephone cell contact info call please our their his her law office firm and to do you have".split(" "),
);

/** Which practice question this is, or null (patient question / unknown). */
export function detectPracticeIntent(question: string): PracticeIntent | null {
  const q = question.toLowerCase();
  const ws = words(q);
  const joined = ws.join(" ");
  if (/\bto\s*-?\s*dos?\b|\btodos?\b/.test(q) || hasWord(ws, "todo", "tasks", "task") || /\bto do list\b/.test(joined)) return { kind: "todo" };
  if (hasWord(ws, "schedule", "appointments", "appointment", "booked", "coming") && hasWord(ws, "today", "tomorrow", "tmrw", "tomorow")) {
    return { kind: "schedule", day: hasWord(ws, "tomorrow", "tmrw", "tomorow") ? "tomorrow" : "today" };
  }
  if (/\bwho('s| is)? (coming|on the schedule)\b/.test(q) && /\btoday|tomorrow\b/.test(q)) return { kind: "schedule", day: /tomorrow/.test(q) ? "tomorrow" : "today" };
  const list = /\b(list|which|who|show|names?)\b/.test(q);
  if (/\bchecks?\b/.test(q) && /\b(wait|waiting|pending|owed|expect)/.test(q)) return { kind: "caseCount", status: "Submitted", list };
  const caseWord = hasWord(ws, "cases", "case", "patients", "files");
  if (caseWord || /\bhow many\b/.test(q)) {
    if (hasWord(ws, "submitted")) return { kind: "caseCount", status: "Submitted", list };
    if (/\bready to submit\b/.test(q)) return { kind: "caseCount", status: "Ready To Submit", list };
    if (hasWord(ws, "active", "open")) return { kind: "caseCount", status: "Active", list };
    if (hasWord(ws, "discharged")) return { kind: "caseCount", status: "Discharged", list };
    if (hasWord(ws, "dropped")) return { kind: "caseCount", status: "Dropped", list };
    if (hasWord(ws, "paid")) return { kind: "caseCount", status: "Paid", list };
  }
  if (CONTACT_FIELD.test(q)) {
    const rest = ws.filter((w) => !CONTACT_STOP.has(w) && w.length >= 3);
    if (rest.length) {
      const want = /\bfax\b/.test(q) ? "fax" : /\be-?mail\b/.test(q) ? "email" : /\bcontact info\b/.test(q) ? "all" : "phone";
      return { kind: "contact", query: rest.join(" "), want };
    }
  }
  return null;
}

/** Words that mean the question is about one patient's chart. */
const PATIENT_WORDS =
  /\b(last visit|next visit|visits?|mri|x-?ray|dob|birthday|date of (birth|loss|injury)|dol|doi|injur|diagnos|dx|recommend|plan|treatment|notes?|report|balance|bill|charges?|his|her|she|he|their|this patient|the patient)\b/i;

export function isPatientSpecific(question: string): boolean {
  return PATIENT_WORDS.test(question);
}

export const PLUS_NEEDED =
  "Regular G.O.A.T. answers questions about a patient (type their name). Questions about your to-do list, cases, contacts, schedule or settings need + mode.";

export const PRACTICE_HELP =
  "I can answer about a patient (type their name), or about the office: your to-do list, today's or tomorrow's schedule, how many active or submitted cases you have (or which ones), and a contact's phone, fax or email.";

function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function time12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Contacts the query could mean, best first (typo tolerant). */
export function matchContacts(query: string, contacts: ContactRecord[]): Array<{ contact: ContactRecord; score: number }> {
  const qws = norm(query).split(" ").filter((w) => w.length >= 3 && !CONTACT_STOP.has(w));
  if (!qws.length) return [];
  const out: Array<{ contact: ContactRecord; score: number }> = [];
  for (const contact of contacts) {
    const cws = norm(contact.name).split(" ").filter((w) => w.length >= 2);
    let score = 0;
    for (const w of qws) {
      let best = 0;
      for (const c of cws) {
        if (c === w) best = Math.max(best, 1);
        else if (c.startsWith(w) && w.length >= 3) best = Math.max(best, 0.85);
        else if (w.length >= 4 && editDistance(w, c) === 1) best = Math.max(best, 0.75);
        else if (w.length >= 6 && editDistance(w, c) === 2) best = Math.max(best, 0.55);
      }
      score += best;
    }
    if (score >= 0.55) out.push({ contact, score: score / qws.length });
  }
  return out.sort((a, b) => b.score - a.score || a.contact.name.localeCompare(b.contact.name));
}

function contactLine(c: ContactRecord, want: "phone" | "fax" | "email" | "all"): string {
  const email = c.email || c.emails?.[0]?.email || "";
  const parts: string[] = [];
  if (want === "phone" || want === "all") parts.push(c.phone ? `phone ${c.phone}` : "no phone number saved");
  if (want === "fax" || want === "all") parts.push(c.fax ? `fax ${c.fax}` : "no fax saved");
  if (want === "email" || want === "all") parts.push(email ? `email ${email}` : "no email saved");
  return `${c.name}: ${parts.join(", ")}.`;
}

export function answerPractice(intent: PracticeIntent, data: PracticeData): PracticeAnswer {
  switch (intent.kind) {
    case "todo": {
      const open = data.tasks.filter((t) => !t.done).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
      if (!open.length) return { text: "Your to-do list is clear. No open items." };
      const lines = open.slice(0, 15).map((t) => {
        const due = t.dueDate ? ` (due ${usDate(t.dueDate)}${t.dueDate < data.today ? ", overdue" : ""})` : "";
        return `• ${t.title}${t.patientName ? `, ${t.patientName}` : ""}${due}`;
      });
      return { text: `You have ${open.length} open to-do item${open.length === 1 ? "" : "s"}:\n${lines.join("\n")}${open.length > 15 ? `\n…and ${open.length - 15} more.` : ""}` };
    }
    case "schedule": {
      const day = intent.day === "today" ? data.today : addDays(data.today, 1);
      const appts = data.appointments
        .filter((a) => a.date === day && a.status !== "Canceled")
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (!appts.length) return { text: `Nothing is scheduled ${intent.day} (${usDate(day)}).` };
      const lines = appts.slice(0, 30).map((a) => `• ${time12(a.startTime)} ${a.patientName}${a.appointmentType ? `, ${a.appointmentType}` : ""}${a.status && a.status !== "Scheduled" ? ` (${a.status})` : ""}`);
      return { text: `${appts.length} appointment${appts.length === 1 ? "" : "s"} ${intent.day} (${usDate(day)}):\n${lines.join("\n")}${appts.length > 30 ? `\n…and ${appts.length - 30} more.` : ""}` };
    }
    case "caseCount": {
      const hits = data.patients.filter((p) => p.caseStatus === intent.status).sort((a, b) => a.fullName.localeCompare(b.fullName));
      const label = intent.status === "Submitted" ? "Submitted cases (waiting on payment)" : `${intent.status} cases`;
      const head = `${label}: ${hits.length}.`;
      if (!intent.list || !hits.length) {
        return { text: head, choices: hits.length ? [{ label: "List them", question: `list ${intent.status.toLowerCase()} cases` }] : undefined };
      }
      const lines = hits.slice(0, 40).map((p) => `• ${p.fullName}${p.attorney ? `, ${p.attorney}` : ""}`);
      return { text: `${head}\n${lines.join("\n")}${hits.length > 40 ? `\n…and ${hits.length - 40} more.` : ""}` };
    }
    case "contact": {
      const m = matchContacts(intent.query, data.contacts);
      if (!m.length) return { text: `I couldn't find a contact matching "${intent.query}" in your contacts.` };
      const [top, second] = m;
      if (top.score >= 0.75 && (!second || top.score - second.score >= 0.2)) return { text: contactLine(top.contact, intent.want) };
      const what = intent.want === "all" ? "contact info" : intent.want === "phone" ? "number" : intent.want;
      return {
        text: "Which contact did you mean?",
        choices: m.slice(0, 5).map((x) => ({ label: x.contact.name, question: `${x.contact.name} ${what}` })),
      };
    }
  }
}

/** Compact office data for the + mode model (local only; never sent anywhere). */
export function practiceSnapshot(data: PracticeData): string {
  const counts: Record<string, number> = {};
  for (const p of data.patients) counts[p.caseStatus] = (counts[p.caseStatus] ?? 0) + 1;
  const open = data.tasks.filter((t) => !t.done).slice(0, 40);
  const tomorrow = addDays(data.today, 1);
  const sched = data.appointments
    .filter((a) => (a.date === data.today || a.date === tomorrow) && a.status !== "Canceled")
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .slice(0, 60);
  const caseRows = data.patients
    .filter((p) => p.caseStatus === "Active" || p.caseStatus === "Submitted" || p.caseStatus === "Ready To Submit")
    .slice(0, 400)
    .map((p) => `${p.fullName} | ${p.caseStatus} | ${p.attorney || "-"}`);
  const contacts = data.contacts.slice(0, 200).map((c) => `${c.name} | ${c.category} | ph ${c.phone || "-"} | fax ${c.fax || "-"} | ${c.email || "-"}`);
  return [
    `TODAY: ${usDate(data.today)}`,
    `CASE STATUS COUNTS: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} (total patients ${data.patients.length}). "Submitted" means billed and waiting for the check.`,
    `OPEN TO-DO (${data.tasks.filter((t) => !t.done).length}):`,
    ...open.map((t) => `- ${t.title}${t.patientName ? ` [${t.patientName}]` : ""}${t.dueDate ? ` due ${usDate(t.dueDate)}` : ""}`),
    `SCHEDULE TODAY AND TOMORROW:`,
    ...sched.map((a) => `- ${usDate(a.date)} ${time12(a.startTime)} ${a.patientName} ${a.appointmentType} (${a.status})`),
    `CASES (name | status | attorney):`,
    ...caseRows,
    `CONTACTS (name | category | phone | fax | email):`,
    ...contacts,
  ].join("\n");
}

export const PRACTICE_SYSTEM_PROMPT =
  "You are G.O.A.T., the in-office assistant for a chiropractic practice. Answer the user's question in one to four short, natural sentences (use a short bulleted list only when listing several items). Use ONLY the OFFICE DATA below and the conversation so far; follow-up questions refer to the previous answer. Count carefully. If the data doesn't contain the answer, say you don't know from NoteGoat's data. Never invent names, numbers or dates.";

// ---------------------------------------------------------------------------
// + mode tools (read-only). The local model picks tools, NoteGoat runs them on
// this computer's data, and the model writes the answer from the results.
// Designed so write actions (e.g. scheduling, docs/goat-plus-actions.md) can be
// added later as confirm-first tools.
// ---------------------------------------------------------------------------

export interface ToolCall {
  name: string;
  args: Record<string, string>;
}
export interface ToolLink {
  label: string;
  href: string;
}
export interface ToolResult {
  name: string;
  text: string;
  links?: ToolLink[];
  choices?: PracticeChoice[];
}

export const PRACTICE_TOOLS: Array<{ name: string; args: string; description: string }> = [
  { name: "searchPatients", args: '{"name": string}', description: "find patients by (partial / misspelled) name; returns name, case status, attorney" },
  { name: "getTodos", args: "{}", description: "open to-do items with due dates" },
  { name: "caseCounts", args: '{"status"?: "Active"|"Submitted"|"Ready To Submit"|"Discharged"|"Dropped"|"Paid", "attorney"?: string}', description: "count cases by status (Submitted = billed, waiting for the check); optional attorney filter" },
  { name: "listCases", args: '{"status": string, "attorney"?: string}', description: "list the cases with that status (optionally one attorney)" },
  { name: "findContact", args: '{"name": string}', description: "contact directory lookup (attorneys, imaging, doctors): phone, fax, email" },
  { name: "getSchedule", args: '{"day": "today"|"tomorrow"|"YYYY-MM-DD"}', description: "appointments on that day" },
  { name: "findSetting", args: '{"query": string}', description: "which Settings page changes something (office hours, reminders, templates, + mode…); returns a link" },
];

const STATUSES: CaseStatus[] = ["Active", "Discharged", "Ready To Submit", "Submitted", "Dropped", "Paid"];
function asStatus(v: string | undefined): CaseStatus | null {
  if (!v) return null;
  const n = v.toLowerCase();
  if (/check|waiting|pending/.test(n)) return "Submitted";
  return STATUSES.find((s) => s.toLowerCase() === n) ?? STATUSES.find((s) => n.includes(s.toLowerCase())) ?? null;
}
function attorneyMatch(p: PracticePatient, attorney: string | undefined): boolean {
  if (!attorney) return true;
  const a = norm(attorney).split(" ").filter((w) => w.length >= 3 && !["law", "the", "group", "firm", "office"].includes(w));
  const pa = norm(p.attorney);
  return a.length > 0 && a.every((w) => pa.split(" ").some((x) => x === w || (w.length >= 5 && editDistance(w, x) <= 1)));
}

export function findSettings(query: string): ToolLink[] {
  const ws = norm(query).split(" ").filter((w) => w.length >= 3 && !CONTACT_STOP.has(w) && !["where", "change", "setting", "settings", "how", "can", "edit", "set", "turn", "find"].includes(w));
  if (/\+ ?mode|goat|g\.o\.a\.t|abbreviation/i.test(query)) return [{ label: GOAT_SETTINGS_PAGE.title, href: GOAT_SETTINGS_PAGE.href }];
  const scored = settingsSearchCatalog
    .map((e) => {
      const hay = norm([e.title, e.description ?? "", ...(e.aliases ?? [])].join(" "));
      const phrases = (e.aliases ?? []).filter((a) => norm(query).includes(norm(a))).length * 2;
      const score = phrases + ws.filter((w) => hay.split(" ").some((h) => h === w || (w.length >= 5 && editDistance(w, h) <= 1))).length;
      return { e, score };
    })
    .filter((x) => x.score > 0 && !["officeSettings", "macros", "templates", "admin"].includes(x.e.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map(({ e }) => ({ label: `Settings → ${e.title}`, href: settingsHref(e.key) }));
}

export function runPracticeTool(call: ToolCall, data: PracticeData): ToolResult {
  const a = call.args ?? {};
  switch (call.name) {
    case "searchPatients": {
      const q = norm(a.name ?? "");
      const hits = data.patients.filter((p) => q && norm(p.fullName).split(" ").some((w) => q.split(" ").some((x) => x.length >= 2 && (w.startsWith(x) || (x.length >= 4 && editDistance(x, w) <= 1))))).slice(0, 8);
      return { name: call.name, text: hits.length ? hits.map((p) => `${p.fullName} | ${p.caseStatus} | ${p.attorney || "-"}`).join("\n") : `No patient matches "${a.name}".` };
    }
    case "getTodos":
      return { name: call.name, text: answerPractice({ kind: "todo" }, data).text };
    case "caseCounts": {
      const st = asStatus(a.status);
      const pool = data.patients.filter((p) => (!st || p.caseStatus === st) && attorneyMatch(p, a.attorney));
      if (st) return { name: call.name, text: `${st}${a.attorney ? ` with ${a.attorney}` : ""}: ${pool.length}` };
      const counts: Record<string, number> = {};
      for (const p of pool) counts[p.caseStatus] = (counts[p.caseStatus] ?? 0) + 1;
      return { name: call.name, text: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "No cases." };
    }
    case "listCases": {
      const st = asStatus(a.status) ?? "Active";
      const hits = data.patients.filter((p) => p.caseStatus === st && attorneyMatch(p, a.attorney)).sort((x, y) => x.fullName.localeCompare(y.fullName));
      return { name: call.name, text: `${st}${a.attorney ? ` with ${a.attorney}` : ""} (${hits.length}):\n${hits.slice(0, 60).map((p) => `${p.fullName} | ${p.attorney || "-"}`).join("\n")}` };
    }
    case "findContact": {
      const ans = answerPractice({ kind: "contact", query: a.name ?? "", want: "all" }, data);
      return { name: call.name, text: ans.text, choices: ans.choices };
    }
    case "getSchedule": {
      const d = (a.day ?? "today").toLowerCase();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        const appts = data.appointments.filter((x) => x.date === d && x.status !== "Canceled").sort((x, y) => x.startTime.localeCompare(y.startTime));
        return { name: call.name, text: appts.length ? appts.map((x) => `${time12(x.startTime)} ${x.patientName} ${x.appointmentType} (${x.status})`).join("\n") : `Nothing scheduled ${usDate(d)}.` };
      }
      return { name: call.name, text: answerPractice({ kind: "schedule", day: d.startsWith("tom") ? "tomorrow" : "today" }, data).text };
    }
    case "findSetting": {
      const links = findSettings(a.query ?? "");
      return { name: call.name, text: links.length ? links.map((l) => l.label).join("\n") : "No matching settings page.", links };
    }
    default:
      return { name: call.name, text: `Unknown tool ${call.name}.` };
  }
}

export const SETTING_QUESTION = /\b(settings?|where (do|can) i (change|set|edit|turn|find)|how do i (change|turn on|turn off|set up|edit))\b/i;

/** Rules' guess at the tools (used if the model's tool pick isn't valid JSON). */
export function fallbackToolCalls(question: string): ToolCall[] {
  if (SETTING_QUESTION.test(question)) return [{ name: "findSetting", args: { query: question } }];
  const i = detectPracticeIntent(question);
  if (!i) return [];
  switch (i.kind) {
    case "todo":
      return [{ name: "getTodos", args: {} }];
    case "schedule":
      return [{ name: "getSchedule", args: { day: i.day } }];
    case "caseCount":
      return [{ name: i.list ? "listCases" : "caseCounts", args: { status: i.status } }];
    case "contact":
      return [{ name: "findContact", args: { name: i.query } }];
  }
}

export function toolPickPrompt(): string {
  return [
    "You route questions for G.O.A.T., the assistant inside a chiropractic EHR. Pick the read-only tools needed to answer the LAST user message (use the conversation for follow-ups like 'those').",
    "Tools:",
    ...PRACTICE_TOOLS.map((t) => `- ${t.name} ${t.args}: ${t.description}`),
    'Reply with ONLY JSON, no other text: {"tools":[{"name":"...","args":{...}}]} (at most 3; [] if none apply).',
  ].join("\n");
}

/** Parse the model's tool pick. Null if it isn't valid. */
export function parseToolCalls(text: string): ToolCall[] | null {
  const m = /\{[\s\S]*\}/.exec(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { tools?: Array<{ name?: unknown; args?: unknown }> };
    if (!Array.isArray(v.tools)) return null;
    const names = new Set(PRACTICE_TOOLS.map((t) => t.name));
    return v.tools
      .filter((t) => typeof t.name === "string" && names.has(t.name))
      .slice(0, 3)
      .map((t) => ({ name: t.name as string, args: Object.fromEntries(Object.entries((t.args as Record<string, unknown>) ?? {}).map(([k, x]) => [k, String(x)])) }));
  } catch {
    return null;
  }
}

export const PRACTICE_ANSWER_PROMPT =
  "You are G.O.A.T., the friendly in-office assistant built into NoteGoat (a chiropractic EHR). Answer the last user message in one to four short, natural sentences, like a helpful coworker (a short bulleted list only when listing several items). Use ONLY the TOOL RESULTS below and the conversation; follow-ups refer to the previous answer. Never invent names, numbers, dates or settings. If the results don't answer it, say you don't know from NoteGoat's data. If a settings page is in the results, tell the user where to go (the link is shown under your answer). Never describe pages, buttons or steps that are not in the TOOL RESULTS; if you are not sure where something is, say \"I'm not sure\".";

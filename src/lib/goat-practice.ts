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
  "Regular G.O.A.T. answers questions about a patient (type their name). Questions about your to-do list, cases, contacts and schedule need + mode.";

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

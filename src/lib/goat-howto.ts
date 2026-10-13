/**
 * G.O.A.T. + mode "how do I…" answers and booking requests.
 *
 * How-to answers come ONLY from this catalog (real page names and button
 * labels, checked against the UI code) or the Settings catalog. When nothing
 * matches, G.O.A.T. says it isn't sure — it never guesses a button.
 * Booking ("schedule Armen next Thursday") isn't supported yet: G.O.A.T.
 * says so plainly and links the Schedule opened on the resolved date.
 */
import { editDistance } from "@/lib/goat-ai/global-chat";
import { findSettings, type ToolLink } from "@/lib/goat-practice";

export interface HowToEntry {
  id: string;
  /** Phrases that mean this task (matched loosely, a typo allowed). */
  aliases: string[];
  /** Exact steps using the app's real labels. */
  steps: string;
  link: ToolLink;
}

/** Labels verified in: patients/page.tsx ("New Patient"), appointments/page.tsx
 *  ("New Appointment", "+ New Patient"), contacts/page.tsx ("Add Contact"),
 *  patient-case-file.tsx ("+ To Do", "Open Encounters For This Patient"),
 *  plan-access.ts (sidebar names). Update this list when a label changes. */
export const APP_HOWTO: HowToEntry[] = [
  {
    id: "newPatient",
    aliases: ["add patient", "new patient", "create patient", "add a patient", "enter patient", "register patient", "add new patient"],
    steps:
      "Open Patient List in the sidebar and click New Patient (top right). You can also add one while booking: in the Schedule's New Appointment window, click + New Patient.",
    link: { label: "Open Patient List", href: "/patients" },
  },
  {
    id: "newAppointment",
    aliases: ["new appointment", "add appointment", "make appointment", "book appointment", "schedule appointment", "add appt", "book visit", "schedule visit", "schedule patient"],
    steps: "Open Schedule in the sidebar and click New Appointment.",
    link: { label: "Open Schedule", href: "/appointments" },
  },
  {
    id: "newContact",
    aliases: ["add contact", "new contact", "add attorney", "add lawyer", "add doctor contact", "add imaging center", "add law firm"],
    steps: "Open Contacts in the sidebar and click Add Contact.",
    link: { label: "Open Contacts", href: "/contacts" },
  },
  {
    id: "todo",
    aliases: ["add todo", "add to do", "add task", "new task", "new todo", "create task", "add reminder for patient"],
    steps: "Open the patient's file and click + To Do (next to Open Encounters For This Patient).",
    link: { label: "Open Patient List", href: "/patients" },
  },
  {
    id: "encounters",
    aliases: ["open encounter", "find encounter", "write note", "open note", "soap note", "encounters", "notes page"],
    steps: "Open Encounters in the sidebar. From a patient's file, click Open Encounters For This Patient.",
    link: { label: "Open Encounters", href: "/encounters" },
  },
];

/** Sidebar pages (names from plan-access.ts). */
const PAGES: Array<{ label: string; href: string; words: string[] }> = [
  { label: "Patient List", href: "/patients", words: ["patient list", "patients page"] },
  { label: "Dashboard", href: "/dashboard", words: ["dashboard"] },
  { label: "Contacts", href: "/contacts", words: ["contacts"] },
  { label: "Schedule", href: "/appointments", words: ["schedule", "calendar"] },
  { label: "Encounters", href: "/encounters", words: ["encounters"] },
  { label: "Key Dates", href: "/key-dates", words: ["key dates"] },
  { label: "My Files", href: "/my-files", words: ["my files"] },
  { label: "Billing", href: "/billing", words: ["billing"] },
  { label: "Timers", href: "/timers", words: ["timers", "timer"] },
  { label: "Marketing", href: "/marketing", words: ["marketing"] },
  { label: "Messages", href: "/messages", words: ["messages", "texts"] },
];

export const HOWTO_QUESTION =
  /\b(how (do|can|would|should) (i|we|you)|how to|where (do|can|would) (i|we)|where('s| is| are| do i find)|walk me through|steps to|show me how)\b/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const FILLER = new Set(["a", "an", "the"]);

/** Every alias word appears in the question (a typo allowed in longer words). */
function aliasHits(question: string, alias: string): boolean {
  const qw = norm(question).split(" ");
  const aw = norm(alias).split(" ").filter((w) => !FILLER.has(w) || alias.split(" ").length === 1);
  const need = aw.length ? aw : norm(alias).split(" ");
  return need.every((w) => qw.some((q) => q === w || q === `${w}s` || (w.length >= 5 && q.length >= 4 && editDistance(q, w) <= 1)));
}

export interface HowToAnswer {
  text: string;
  links: ToolLink[];
  found: boolean;
}

export const HOWTO_UNSURE =
  "I'm not sure where that is in NoteGoat, and I don't want to guess. Try the search box at the top of Settings, or the Handbook.";

/** Answer a how-to question from the catalogs only. */
export function answerHowTo(question: string): HowToAnswer {
  const scored = APP_HOWTO.map((e) => ({ e, n: Math.max(0, ...e.aliases.filter((a) => aliasHits(question, a)).map((a) => norm(a).split(" ").length)) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (scored.length) return { text: scored[0].e.steps, links: [scored[0].e.link], found: true };
  const settings = findSettings(question);
  if (settings.length) return { text: `That's in Settings: ${settings.map((l) => l.label.replace(/^Settings → /, "")).join(", or ")}.`, links: settings, found: true };
  const page = PAGES.find((p) => p.words.some((w) => aliasHits(question, w)));
  if (page) return { text: `Open ${page.label} in the sidebar.`, links: [{ label: `Open ${page.label}`, href: page.href }], found: true };
  return { text: HOWTO_UNSURE, links: [{ label: "Open the Handbook", href: "/handbook" }], found: false };
}

// ---------------------------------------------------------------------------
// Booking requests ("schedule armen next thursdau")
// ---------------------------------------------------------------------------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

function isScheduleVerb(w: string): boolean {
  return /^(schedul|sched|shedul|scedul|schedual|skedul)/.test(w) || editDistance(w, "schedule") <= 2;
}

/** "schedule/book/add/make … appointment" (typos ok) — a request to BOOK, not "what's on the schedule". */
export function isBookingRequest(question: string): boolean {
  const q = norm(question);
  const ws = q.split(" ");
  const apptWord = ws.some((w) => /^(appt|appts|appointment|appointments|apointment|appoinment|appointmnet|visit)$/.test(w) || (w.length >= 8 && editDistance(w, "appointment") <= 2));
  if (/\b(book|make|add|set up|setup|put in|create)\b/.test(q) && apptWord) return true;
  if (/\bbook\b/.test(q) && /\b(for|on|at|next|this|tomorrow)\b/.test(q)) return true;
  if (/(^|\b(you|please|pls|plz|to|lets|let s)\s)(book|rebook)\b/.test(q)) return true;
  // "schedule" used as a verb: start of the request or after "can you / please / to / let's".
  for (let i = 0; i < ws.length; i++) {
    if (!isScheduleVerb(ws[i])) continue;
    const prev = ws[i - 1] ?? "";
    const next = ws[i + 1] ?? "";
    if (["the", "my", "our", "todays", "today", "tomorrows", "on", "whats", "what", "show", "s"].includes(prev)) continue;
    if (["today", "tomorrow", "for"].includes(next) && !apptWord && i > 0) continue;
    if (i === 0 || ["you", "please", "to", "lets", "let", "and", "pls", "plz", "can", "go", "ahead"].includes(prev) || apptWord) return true;
  }
  return false;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
export function dayLabel(iso: string): string {
  const d = fromIso(iso);
  return `${WEEKDAYS[d.getDay()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export interface ResolvedDay {
  iso: string;
  /** e.g. "the coming Thursday. If you meant the week after, that's Thu 10/22/2026." */
  note: string;
}

/** The day a booking request talks about (weekday names with typos, today/tomorrow, MM/DD). */
export function resolveRequestedDay(question: string, todayIso: string): ResolvedDay | null {
  const q = norm(question);
  const ws = q.split(" ");
  if (ws.includes("today")) return { iso: todayIso, note: "today" };
  if (ws.some((w) => ["tomorrow", "tmrw", "tomorow", "tommorow", "tommorrow"].includes(w))) return { iso: addDays(todayIso, 1), note: "tomorrow" };
  const md = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(question);
  if (md) {
    const t = fromIso(todayIso);
    let y = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : t.getFullYear();
    let iso = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (!md[3] && iso < todayIso) {
      y += 1;
      iso = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    }
    return { iso, note: "" };
  }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    let day = SHORT[w] ?? -1;
    if (day < 0 && w.length >= 5) day = WEEKDAYS.findIndex((d) => w === d || editDistance(w, d) <= 1 || w === `${d}s`);
    if (day < 0) continue;
    const today = fromIso(todayIso).getDay();
    let ahead = (day - today + 7) % 7;
    if (ahead === 0) ahead = 7;
    const iso = addDays(todayIso, ahead);
    const name = WEEKDAYS[day].replace(/^./, (c) => c.toUpperCase());
    const said = ws[i - 1];
    if (said === "next") {
      return { iso, note: `I read "next ${name}" as the coming ${name}. If you meant the week after, that's ${dayLabel(addDays(iso, 7))}.` };
    }
    return { iso, note: `the coming ${name}` };
  }
  return null;
}


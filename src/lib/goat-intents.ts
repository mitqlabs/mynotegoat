import { isAddNote, isBooking, isTell } from "@/lib/goat-commands";
/**
 * Plain-language G.O.A.T. requests that used to need a "/" command:
 *  - "add to-do call vartan 555-555-8855 to schedule new appt" → a to-do card
 *  - "schedule new patient John Smith for next Wednesday at 10" → a New Patient
 *    card that opens the existing New Patient form prefilled (never creates)
 * Existing-patient booking ("schedule john smith for friday at 3") stays on the
 * normal booking path (goat-commands canonicalBooking / planBooking).
 * Pure functions, so the eval can run them with mock data.
 */

const TODO_START =
  /^(?:(?:hey\s+)?(?:goat\s*[,:]?\s*)?)?(?:(?:can|could)\s+you\s+|please\s+|pls\s+|plz\s+)?(?:add|make|create|put(?:\s+in)?|set|write|jot(?:\s+down)?|new)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:to[\s-]?dos?|todos?|task|reminder)\b(?:\s+(?:item|on (?:the|my) list))?\s*(?:[:\-–—,]\s*|\s+(?:to|that says|saying)\s+|\s+|[?.!]?\s*$)/i;
const TODO_LABEL = /^(?:to[\s-]?do|todo|task)\s*[:\-–—]\s*/i;
const REMIND = /^(?:please\s+)?remind\s+me\s+to\s+/i;

/** "none", "no patient", "general" … as the case name in "/todo none: …" = a to-do with no patient (never a name match: "none" ≠ Nune). */
export const NO_PATIENT_NAME = /^(?:none|no\s+(?:patient|case|one)|general|nobody|n\/a|na|-)$/i;
export const isNoPatientName = (name: string | null | undefined): boolean => Boolean(name && NO_PATIENT_NAME.test(name.trim()));

/** The word after these is usually a person ("call vartan" → "Call Vartan"). */
const PERSON_VERBS = /^(call|text|email|e-mail|phone|ask|tell|remind|message|msg|fax|see|meet|ping|contact|follow up with|f\/u with|followup with|check with|check on|call back|text back)$/i;
const NOT_A_NAME = /^(the|a|an|back|her|him|them|his|their|our|my|me|us|office|attorney|atty|lawyer|insurance|adjuster|pt|patient|client|doctor|dr|mri|imaging|records?|about|re|to|for|and|again|today|tomorrow|tmrw|asap|soon|later|everyone|all|number|numbers|phone|fax|email|info|address|new|case)$/i;

/** Tidy the to-do text: first letter up, and the name after "call/text/…" capitalized ("call armen barmen" → "Call Armen Barmen"). Phones, dates kept. */
export function tidyTodoText(raw: string): string {
  const words = raw.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").split(" ");
  for (let i = 0; i < words.length - 1; i++) {
    let verbLen = 0;
    for (const n of [3, 2, 1]) if (i + n < words.length && PERSON_VERBS.test(words.slice(i, i + n).join(" "))) { verbLen = n; break; }
    if (!verbLen) continue;
    // Up to 3 name words after the verb; stop at a non-name word, a number or punctuation.
    for (let j = i + verbLen; j < Math.min(words.length, i + verbLen + 3); j++) {
      const w = words[j];
      if (!/^[a-z][a-z'’-]+$/.test(w) || NOT_A_NAME.test(w) || /^(about|re|to|for|and|at|on|in|from|with|regarding|that|if|asap)$/i.test(w)) break;
      words[j] = w[0].toUpperCase() + w.slice(1);
    }
  }
  const s = words.join(" ");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "add to-do …", "add a task to …", "remind me to …", "todo: …" → the to-do text; null otherwise. */
export function detectPlainTodo(raw: string): { text: string } | null {
  const q = raw.replace(/\s+/g, " ").trim();
  if (q.startsWith("/")) return null;
  let body: string | null = null;
  const m = TODO_START.exec(q);
  if (m) body = q.slice(m[0].length);
  else if (TODO_LABEL.test(q)) body = q.replace(TODO_LABEL, "");
  else if (REMIND.test(q)) body = q.replace(REMIND, "");
  if (body === null) return null;
  body = body.replace(/^(?:to|that|saying|says|for me to)\s+/i, "").trim();
  // "add a to-do?" / "add a todo for" with nothing after → still a to-do request, text unknown.
  return { text: body ? tidyTodoText(body) : "" };
}

const NEW_PT = /\bnew\s+(?:patient|pt|client|intake)\b|\bnp\s+(?:eval|evaluation|visit|appt)\b/i;
const NEW_PT_VERB = /\b(schedule|sched|book|add|set\s*up|setup|make|create|enter|put\s+in|got|have|get|register|start)\b/i;
const HOWTO = /^(how|where|what|why|when|who|which|is|are|does|do\s+(?:we|i)|can\s+i|should)\b/i;

/** "schedule new patient John Smith next Wednesday at 10", "schedule john smith new patient", "/new …". */
export function detectNewPatientRequest(raw: string): boolean {
  const q = raw.replace(/\s+/g, " ").trim();
  if (/^\/new\b/i.test(q)) return true;
  if (q.startsWith("/") || HOWTO.test(q) || detectPlainTodo(q)) return false;
  if (!NEW_PT.test(q)) return false;
  // Schedule questions ("any new patients this week", "new patients tomorrow?") are lookups, not intake.
  if (/\b(any|upcoming|coming up|how many|next one)\b/i.test(q) || /\?\s*$/.test(q)) return false;
  if (/\bnew\s+(?:patients|pts|clients|intakes)\b/i.test(q) && !NEW_PT_VERB.test(q)) return false;
  // "new patient" + a verb, or the message starts with it ("new patient: Jane Doe …").
  return NEW_PT_VERB.test(q) || /^(?:a\s+)?new\s+(?:patient|pt)\b/i.test(q) || /\b(i|we)\s+(have|got)\b/i.test(q);
}

const DAY_START = /\b(?:(?:on|for)\s+)?(?=(?:today|tonight|tomorrow|tmrw|tmr|this\s+\w+day|next\s+\w+day|next\s+week|(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?\b|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b))/i;

/** The request reworded for parseIntakeText: verb and "new patient" dropped, the day marked as the appointment. */
export function newPatientIntakeText(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim().replace(/^\/new\b\s*/i, "");
  q = q
    .replace(/^(hi|hey|hello)\b[,!.]?\s*/i, "")
    .replace(/^(?:i|we)\s+(?:have|got)\s+(?:a\s+)?new\s+(?:patient|pt|client)(?:\s+for\s+(?:you|u))?\s*[:,.!-]?\s*/i, "")
    .replace(/^(?:(?:can|could)\s+you\s+|please\s+|pls\s+|plz\s+)/i, "")
    .replace(/^(?:schedule|sched|book|add|set\s*up|setup|make|create|enter|put\s+in|register|start)\s+(?:an?\s+)?(?:appointment|appt|eval(?:uation)?\s+)?(?:for\s+)?(?:an?\s+|the\s+)?/i, "")
    .replace(/\b(?:as\s+)?(?:an?\s+)?new\s+(?:patient|pt|client|intake)(?:\s+(?:eval(?:uation)?|visit|appt|appointment|exam))?\b\s*(?:named|called|for|:|,|-)?\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "cash Mia Sample …" → the name first, the cash flag after (the parser reads names from the start).
  const cash = /^(?:cash|self[- ]pay)\b\s*(?:patient\b\s*|pt\b\s*)?[,:-]?\s*/i.exec(q);
  if (cash) q = `${q.slice(cash[0].length)} cash`;
  // A day with no "appt" word ("John Smith for next Wednesday at 10") → "John Smith appt next Wednesday at 10".
  if (!/\b(appt|appointment|come in|coming in|book|schedule|see (?:him|her|them))\b/i.test(q)) {
    const m = DAY_START.exec(q);
    if (m && !/\b(doi|dol|accident|wreck|mva|hurt|injured|injury|rear[- ]ended|hit)\s*(?:on|was|is|:)?\s*$/i.test(q.slice(0, m.index))) {
      q = `${q.slice(0, m.index).replace(/[,\s]+$/, "")} appt ${q.slice(m.index + m[0].length)}`.trim();
    }
  }
  return q.replace(/^appt\b/i, "appt").trim();
}

const NEW_VISIT = /\bnew\s+(?:appt|appointment|visit|eval(?:uation)?|exam)\b/i;
const BOOK_START = /^(?:(?:can|could)\s+you\s+|please\s+|pls\s+|plz\s+)?(?:schedule|sched|book|set\s*up|setup|make|put\s+in|pencil\s+in|get)\b/i;

/**
 * A booking that's (maybe) for someone new: "schedule armen barmen for new appt next Thursday at 3pm",
 * "book new patient John Smith friday 10". saysNewPatient = the words "new patient" were used
 * (vs just "new appt", which an existing patient can have too).
 */
export function detectNewVisitBooking(raw: string): { text: string; saysNewPatient: boolean } | null {
  const q = raw.replace(/\s+/g, " ").trim();
  if (q.startsWith("/") || HOWTO.test(q) || detectPlainTodo(q)) return null;
  if (!BOOK_START.test(q)) return null;
  const saysNewPatient = NEW_PT.test(q);
  if (!saysNewPatient && !NEW_VISIT.test(q)) return null;
  return { text: newVisitBookingText(q), saysNewPatient };
}

/** Any booking wording reduced to intake text: "schedule armen barmen for new appt next Thursday at 3pm" → "armen barmen appt next Thursday at 3pm". */
export function newVisitBookingText(raw: string): string {
  const q = raw.replace(/\s+/g, " ").trim()
    .replace(/\s*\b(?:for|as)?\s*(?:an?\s+|the\s+)?new\s+(?:appt|appointment|visit|eval(?:uation)?|exam)\b/i, " ")
    .replace(/^(?:(?:can|could)\s+you\s+|please\s+|pls\s+|plz\s+)?(?:pencil\s+in|put\s+in)\b/i, "book");
  return newPatientIntakeText(q.replace(/\s+/g, " ").trim());
}

/** An open to-do about this person with a phone in it ("Call Armen Barmen 555-555-5588") → its id and phone. */
export function findTodoPhone(name: { firstName?: string; lastName?: string }, tasks: Array<{ id: string; title: string; done?: boolean }>): { taskId: string; phone: string } | null {
  const parts = [name.firstName, name.lastName].filter((x): x is string => Boolean(x && x.trim())).map((x) => x.trim().toLowerCase());
  if (!parts.length) return null;
  for (const t of tasks) {
    if (t.done) continue;
    const title = t.title.toLowerCase();
    if (!parts.every((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(title))) continue;
    const ph = /\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/.exec(t.title);
    if (ph) return { taskId: t.id, phone: `${ph[1]}-${ph[2]}-${ph[3]}` };
  }
  return null;
}

/** "/schedule …" rest → the booking wording the normal path understands. */
export function scheduleSlashToBooking(rest: string): string {
  const r = rest.replace(/\s+/g, " ").trim().replace(/^(?:book|schedule)\s+/i, "");
  return `book ${r}`;
}

// ── Prefilled New Appointment (Schedule page) ────────────────────────────
export const NEW_APPOINTMENT_PREFILL_KEY = "casemate.new-appointment-prefill.v1";
export interface NewAppointmentPrefill {
  patientId?: string;
  date?: string;
  time?: string;
  /** Opens New Appointment in New-patient mode with these fields. */
  newPatient?: { lastName?: string; firstName?: string; phone?: string; attorney?: string; dateOfLoss?: string; notes?: string };
  /** The open to-do this came from ("call armen barmen 555…"); offered as done after Save. */
  taskId?: string;
  at: number;
}
export function stashNewAppointmentPrefill(p: Omit<NewAppointmentPrefill, "at">) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NEW_APPOINTMENT_PREFILL_KEY, JSON.stringify({ ...p, at: Date.now() }));
}
/** Is a G.O.A.T. prefill waiting? (Doesn't consume it.) */
export function hasNewAppointmentPrefill(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(NEW_APPOINTMENT_PREFILL_KEY) !== null;
}
/** Read once (and clear). Stale (> 10 min) prefills are ignored. */
export function takeNewAppointmentPrefill(): NewAppointmentPrefill | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(NEW_APPOINTMENT_PREFILL_KEY);
  window.sessionStorage.removeItem(NEW_APPOINTMENT_PREFILL_KEY);
  try {
    const v = raw ? (JSON.parse(raw) as NewAppointmentPrefill) : null;
    return v && Date.now() - v.at < 10 * 60_000 ? v : null;
  } catch {
    return null;
  }
}

/** Words that point at "the patient whose page is open". */
export const PAGE_PATIENT_REF = /\b(him|her|them|he|she|his|hers|their|this (?:person|patient|pt|client|guy|lady|case)|the (?:patient|pt|client)|that (?:person|patient))\b/i;
const CONTACT_VERB = /^(call|text|email|e-mail|message|msg|follow up with|follow-up with|followup with|check (?:on|in with)|remind|ask|contact|reach out to|confirm with|tell)\b\s*/i;

const pageName = (fullName: string) => {
  const [last = "", first = ""] = fullName.split(",").map((x) => x.trim());
  return first ? `${first} ${last}`.trim() : last;
};

/**
 * G.O.A.T. opened on a patient's page: "remind me to call her for appointment"
 * / "call for appointment" → "Call John Smith for appointment", linked to that
 * patient. Pronouns become the name; a bare contact verb gets the name after
 * it. Returns null when the text has no implicit reference AND no contact verb
 * (then the page patient is only linked, title unchanged).
 */
export function todoTitleForPagePatient(title: string, fullName: string): string {
  const name = pageName(fullName);
  if (!name) return title;
  let t = title.trim();
  if (PAGE_PATIENT_REF.test(t)) {
    t = t.replace(new RegExp(PAGE_PATIENT_REF.source, "i"), (m) => (/^(his|hers|their)$/i.test(m) ? `${name}'s` : name));
  } else {
    const v = CONTACT_VERB.exec(t);
    if (v && !t.toLowerCase().includes(name.toLowerCase())) t = `${v[0].trim()} ${name} ${t.slice(v[0].length)}`.replace(/\s+/g, " ").trim();
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Which patient a to-do belongs to when G.O.A.T. is opened on a patient page.
 *   named another patient (one clear match) → that patient
 *   pronoun / "this patient" / nobody named → the page's patient
 *   several possible other names, no pronoun → null (ask)
 */
export function pickTodoPatient<T extends { id: string }>(opts: { text: string; page: T | null; confident: T | null; candidates: T[] }): { patient: T | null; via: "named" | "page" | "ask" | "none" } {
  const { text, page, confident, candidates } = opts;
  const pronoun = PAGE_PATIENT_REF.test(text);
  if (confident && (!page || confident.id !== page.id) && !pronoun) return { patient: confident, via: "named" };
  if (page && (pronoun || !candidates.length || confident?.id === page.id)) return { patient: page, via: "page" };
  if (confident) return { patient: confident, via: "named" };
  if (candidates.length) return { patient: null, via: "ask" };
  return { patient: null, via: "none" };
}

/**
 * The patient-page G.O.A.T. box only answers questions about that patient.
 * Action wording ("remind me to…", "add a to-do", "add note", "schedule",
 * "book", "tell …") is handed to the global G.O.A.T. chat instead, which
 * already treats "him / her / this patient" as the open page's patient and
 * shows its usual confirm card. Questions stay in the box.
 */
export function isGoatActionPhrase(raw: string): boolean {
  const q = raw.replace(/\s+/g, " ").trim();
  if (!q) return false;
  if (detectPlainTodo(q)) return true;
  if (/^(how|where|what|whats|what's|when|who|which|why|is|are|was|were|does|did|has|have|any)\b/i.test(q) || /\?\s*$/.test(q)) return false;
  return Boolean(isAddNote(q) || isBooking(q) || isTell(q) || detectNewVisitBooking(q) || detectNewPatientRequest(q));
}

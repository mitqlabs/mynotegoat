import { joinDrTitle } from "@/lib/goat-message";
/**
 * Casual-language front door for G.O.A.T. action commands.
 *
 * People type to G.O.A.T. the way they'd talk to a front-desk assistant:
 * "pls ad a note for collin that i spoke w atty abt red req", "msg hanna re
 * kara", "can u bok kara tmrw 3p", "whats kara's bal". This module turns that
 * into one of four commands (add note, team message, booking, bill lookup)
 * plus the pieces each one needs, and keeps add-note going across turns
 * ("add a note" → "for who?" → "collin elliott").
 *
 * Pure: no React, no storage. Patients come in as a plain list.
 */
import { editDistance } from "@/lib/goat-ai/global-chat";
import { isBookingRequest } from "@/lib/goat-howto";
import { isTellRequest, parseTell } from "@/lib/goat-message";

export type CommandKind = "addNote" | "tell" | "book" | "bill";

export interface CommandPatient {
  id: string;
  fullName: string;
  active?: boolean;
}

/** Typo / shorthand words → the word the parsers expect. */
const WORD_FIX: Record<string, string> = {
  ad: "add", addd: "add", adda: "add a", nte: "note", noet: "note", ntoe: "note", nota: "note", notee: "note", nots: "notes",
  mesage: "message", messsage: "message", massage: "message", mssg: "message", msge: "message", msg: "message", dm: "message",
  bok: "book", boook: "book", bkook: "book", boko: "book", shedule: "schedule", schedual: "schedule", scedule: "schedule", sched: "schedule", schdule: "schedule",
  appt: "appointment", apt: "appointment", appts: "appointments", appoitment: "appointment", apointment: "appointment",
  tmrw: "tomorrow", tmr: "tomorrow", tmw: "tomorrow", tomorow: "tomorrow", tommorow: "tomorrow", "2moro": "tomorrow",
  bal: "balance", blance: "balance", balanace: "balance", balence: "balance", ballance: "balance", bil: "bill", bll: "bill",
  owes: "owe", oweing: "owe", owing: "owe",
  u: "you", ur: "your", pls: "please", plz: "please", pleas: "please", thx: "", thanks: "", ty: "",
  w: "with", "w/": "with", abt: "about", bc: "because", re: "about",
  tel: "tell", tell: "tell", ping: "tell", txt: "text",
};

/** Lower-noise version of what was typed: polite lead-ins and typos fixed. */
export function normalizeCasual(raw: string): string {
  let q = raw.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  q = q.replace(/^(hey|hi|yo|ok|okay)\s+(goat|g\.o\.a\.t\.?)[,!:]?\s*/i, "").replace(/^(goat|g\.o\.a\.t\.?)[,!:]?\s+/i, "");
  const words = q.split(" ").map((w) => {
    const m = /^([A-Za-z0-9/]+)([,.!?:;]*)$/.exec(w);
    if (!m) return w;
    const fix = WORD_FIX[m[1].toLowerCase()];
    return fix === undefined ? w : fix ? fix + m[2] : m[2];
  });
  q = words.join(" ").replace(/\s+/g, " ").trim();
  // Polite lead-ins and trailing pleasantries.
  for (let i = 0; i < 3; i++) {
    // Follow-up lead-ins before an action ("oh also add a note…", "and also book her…").
    q = q.replace(/^(?:oh|oh and|and|also|plus|ok|okay|oh ok)[,!]?\s+(?:also\s+)?(?=(?:please\s+)?(?:add|put|write|jot|make|create|remind|book|schedule|tell|text|send|message|note)\b)/i, "");
    q = q.replace(/^(please|can you|could you|would you|will you|can i|could i|i need you to|i need to|i want to|i wanna|i'd like to|go ahead and|quick(ly)?|just)\s+/i, "");
  }
  q = q.replace(/[\s,]+(please|for me|asap|real quick|thank you|thanks)[.!?]*$/i, "").replace(/[?!]+$/, "").trim();
  return q;
}

const NOTE_VERB = String.raw`(?:add|put|write|leave|make|log|drop|jot(?:\s+down)?|enter|post|save|stick|throw|chart)`;
const NOTE_LEAD = new RegExp(String.raw`^${NOTE_VERB}\s+(?:in\s+)?(?:a|an|this|the|one|another|new|quick|little)?\s*(?:quick\s+)?(?:note|comment|memo|entry)s?\b`, "i");
const NOTE_FOR_LEAD = /^(?:new\s+)?(?:note|memo)\s+(?:for|to|on|in|re|about)\b/i;
const NOTE_IN_FILE = new RegExp(String.raw`^${NOTE_VERB}\s+(?:in|into|on|to)\s+(.+?)(?:'s|s')\s+(?:file|chart|notes?|case)\b`, "i");

export function isAddNote(raw: string): boolean {
  const q = normalizeCasual(raw);
  return NOTE_LEAD.test(q) || NOTE_FOR_LEAD.test(q) || NOTE_IN_FILE.test(q) || /^(?:note|memo)\s*[:\-–—]/i.test(q) || /^(?:in|on|to)\s+.+?(?:'s|s')\s+(?:file|chart)\b.*\b(?:add|put|write|note)\b/i.test(q);
}

/** Strip a leading "that / saying / : / - / re" so the note reads as the note. */
export function cleanNoteText(t: string): string {
  return t
    .replace(/^\s*(?:[:\-–—,]+\s*)?/, "")
    .replace(/^(?:that|saying|says|to say|which says|stating|reading|:)\s+/i, "")
    .replace(/^(?:that)\s+/i, "")
    .trim();
}

export interface AddNoteParts {
  /** Patient words as typed (may be absent: "add a note: …" uses the open patient). */
  name: string | null;
  text: string | null;
}

/**
 * Split an add-note request into patient words and note text, without
 * patients (so "for collin elliott that …" works even before matching).
 */
export function parseAddNoteParts(raw: string): AddNoteParts | null {
  const q = normalizeCasual(raw);
  let rest: string | null = null;
  const inFile = NOTE_IN_FILE.exec(q);
  if (inFile) {
    return { name: inFile[1].replace(/^(?:the|patient)\s+/i, "").trim(), text: cleanNoteText(q.slice(inFile[0].length)) || null };
  }
  const fileFirst = /^(?:in|on|to)\s+(.+?)(?:'s|s')\s+(?:file|chart)\s*,?\s*(?:add|put|write)\s+(?:a\s+)?note\s*([\s\S]*)$/i.exec(q);
  if (fileFirst) return { name: fileFirst[1].trim(), text: cleanNoteText(fileFirst[2]) || null };
  const lead = NOTE_LEAD.exec(q) ?? NOTE_FOR_LEAD.exec(q) ?? /^(?:note|memo)(?=\s*[:\-–—])/i.exec(q);
  if (!lead) return null;
  rest = q.slice(lead[0].length).trim();
  // NOTE_FOR_LEAD already ate "for/to/on"; put it back for the shared parse.
  if (NOTE_FOR_LEAD.test(q) && !NOTE_LEAD.test(q)) rest = `for ${rest}`;
  if (!rest) return { name: null, text: null };
  // "for/to/on/in/about <name>['s file|chart] (that|saying|:|-) <text>"
  const target = /^(?:for|to|on|in|into|about|re|regarding|under)\s+(?:the\s+)?(?:patient\s+)?([\s\S]+)$/i.exec(rest);
  if (!target) return { name: null, text: cleanNoteText(rest) || null };
  const body = target[1];
  const sep = /^(.+?)(?:(?:'s|s')\s+(?:file|chart|notes?|case))?\s*(?:[:\-–—]\s*|,\s*|\s+(?:that|saying|says|stating|reading|re|about|abt)\s+)([\s\S]+)$/i.exec(body);
  if (sep && sep[1].split(/\s+/).length <= 4) {
    return { name: sep[1].replace(/(?:'s|s')$/i, "").trim(), text: cleanNoteText(sep[2]) || null };
  }
  const fileOnly = /^(.+?)(?:'s|s')\s+(?:file|chart|notes?|case)\s*$/i.exec(body);
  if (fileOnly) return { name: fileOnly[1].trim(), text: null };
  // No separator: "for collin spoke to atty" — the patient list decides the split.
  return { name: body.trim(), text: null };
}

const STOP = new Set(["i", "a", "an", "the", "that", "to", "and", "for", "about", "with", "is", "was", "he", "she", "they", "we", "it", "her", "his", "on", "in", "of", "just", "told", "you", "said", "patient", "note"]);

function nameWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/'s\b/g, "").split(/\s+/).filter(Boolean);
}

/**
 * Everyday words that are one typo away from a name ("many" → Mary, "have" →
 * Dave, "cases" → Casey). They only match a name when typed exactly, so
 * "how many submitted cases do we have" never turns into Mary's file.
 */
const COMMON_WORDS = new Set(
  "hey hi hello how are you yes yeah testing test tests tested feature features new out thanks thank please good great fine morning tonight anything everything something nothing many much more most have has had having make made what when where were with will would could should does done this that them they then than there these those case cases file files call called calls today tomorrow week next last visit visits bill paid open office offices check checks list show team note notes said told back over just only also like want need sent send text total count number submitted active ready schedule patients patient".split(" "),
);

function wordMatches(w: string, target: string, loose = false): boolean {
  if (w === target) return true;
  if (COMMON_WORDS.has(w)) return false;
  if (w.length >= 4 && target.length >= 4 && editDistance(w, target) <= 1) return true;
  // Inside a full name ("collin eliliot"), a longer last name may be two typos off.
  if (loose && w.length >= 5 && target.length >= 5 && w[0] === target[0] && editDistance(w, target) <= 2) return true;
  return false;
}

/** Patients a short run of words names (first, last, or full name; one-letter typos ok). */
export function patientsNamed<T extends CommandPatient>(words: string[], patients: T[]): T[] {
  const ws = words.filter((w) => !STOP.has(w));
  if (!ws.length || ws.length !== words.length) return [];
  const full = patients.filter((p) => {
    const ns = nameWords(p.fullName);
    if (ws.length < 2) return false;
    // Every word fits a name part; at least one fits closely (exact or one typo).
    return ws.every((w) => ns.some((n) => wordMatches(w, n, true))) && ws.some((w) => ns.some((n) => wordMatches(w, n)));
  });
  if (full.length) return full;
  if (ws.length !== 1) return [];
  return patients.filter((p) => nameWords(p.fullName).some((n) => wordMatches(ws[0], n)));
}

/**
 * Find a patient name at the START of `text` ("collin elliott i spoke to atty")
 * and return who it names plus the remainder. Longest name wins.
 */
export function splitLeadingName<T extends CommandPatient>(text: string, patients: T[]): { matches: T[]; nameText: string; rest: string } | null {
  const raw = text.trim().split(/\s+/);
  for (let n = Math.min(3, raw.length); n >= 1; n--) {
    const head = raw.slice(0, n).join(" ").replace(/[,:;.\-–—]+$/, "");
    const matches = patientsNamed(nameWords(head), patients);
    if (matches.length) return { matches, nameText: head.replace(/(?:'s|s')$/i, ""), rest: cleanNoteText(raw.slice(n).join(" ")) };
  }
  return null;
}

/** Patient name mentioned ANYWHERE in the message (longest run wins). */
export function findNameAnywhere<T extends CommandPatient>(text: string, patients: T[]): { matches: T[]; nameText: string } | null {
  const raw = text.trim().split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, ""));
  let best: { matches: T[]; nameText: string; len: number } | null = null;
  for (let i = 0; i < raw.length; i++) {
    for (let n = Math.min(3, raw.length - i); n >= 1; n--) {
      const ws = nameWords(raw.slice(i, i + n).join(" "));
      if (ws.length !== n) continue;
      if (n === 1 && ws[0].length < 3) continue;
      const matches = patientsNamed(ws, patients);
      if (matches.length && (!best || n > best.len)) best = { matches, nameText: raw.slice(i, i + n).join(" "), len: n };
      if (matches.length) break;
    }
  }
  return best ? { matches: best.matches, nameText: best.nameText } : null;
}

/** Active cases first; inactive ones only when there's no active match. */
function activeFirst<T extends CommandPatient>(list: T[]): T[] {
  const active = list.filter((p) => p.active !== false);
  return active.length ? active : list;
}

export interface PendingAddNote {
  /** Note text already given (null = still need it). */
  text: string | null;
  /** Patient already settled (null = still need it). */
  patientId: string | null;
}

export type AddNoteStep<T extends CommandPatient> =
  | { kind: "confirm"; patient: T; text: string }
  | { kind: "choose"; candidates: T[]; text: string | null; name: string }
  | { kind: "askPatient"; pending: PendingAddNote; prompt: string }
  | { kind: "askText"; pending: PendingAddNote; patient: T; prompt: string }
  | { kind: "notFound"; pending: PendingAddNote; name: string; prompt: string };

const ASK_PATIENT = "Which patient is the note for? Type their name (you can add the note too).";

function stepFor<T extends CommandPatient>(patient: T | null, candidates: T[] | null, name: string | null, text: string | null, patients: T[]): AddNoteStep<T> {
  if (candidates && candidates.length > 1) return { kind: "choose", candidates, text, name: name ?? "" };
  const p = patient ?? (candidates && candidates.length === 1 ? candidates[0] : null);
  if (!p) {
    if (name) return { kind: "notFound", name, pending: { text, patientId: null }, prompt: `I couldn't find a patient named "${name}". Type their name and I'll add the note.` };
    return { kind: "askPatient", pending: { text, patientId: null }, prompt: ASK_PATIENT };
  }
  if (!text) return { kind: "askText", patient: p, pending: { text: null, patientId: p.id }, prompt: `What should the note for ${p.fullName} say?` };
  void patients;
  return { kind: "confirm", patient: p, text };
}

/** First message of an add-note. `openPatient` = the patient G.O.A.T. is on, if any. */
export function planAddNote<T extends CommandPatient>(raw: string, patients: T[], openPatient: T | null): AddNoteStep<T> | null {
  const parts = parseAddNoteParts(raw);
  if (!parts) return null;
  if (!parts.name) return stepFor(openPatient, null, null, parts.text, patients);
  // Name given: find who it names, and split off any note text the separator missed.
  const lead = splitLeadingName(parts.name, patients);
  if (lead) {
    const text = parts.text ?? (lead.rest || null);
    return stepFor(null, activeFirst(lead.matches), lead.nameText, text, patients);
  }
  // Words after "for" didn't start with a known name.
  if (parts.text) return stepFor(null, [], parts.name.split(/\s+/).slice(0, 2).join(" "), parts.text, patients);
  // "add a note for <unknown words>" — maybe "for" wasn't a name at all; use the open patient.
  if (openPatient) return stepFor(openPatient, null, null, cleanNoteText(parts.name), patients);
  return stepFor(null, [], parts.name.split(/\s+/).slice(0, 2).join(" "), null, patients);
}

/** Filler around a name reply: "i just told you Collin", "Collin Elliott is there", "it's for collin". */
export function stripNameReplyFiller(raw: string): string {
  return normalizeCasual(raw)
    .replace(/^(?:i\s+(?:just\s+)?(?:told|said)(?:\s+you)?|i\s+said|like\s+i\s+said|as\s+i\s+said|already\s+said|it'?s|its|it\s+is|for|patient\s+is|the\s+patient\s+is|name\s+is|um+|uh+|no,?|yes,?|ok,?)\s*[:,]?\s*/i, "")
    .replace(/^(?:for|to)\s+/i, "")
    .replace(/\s+(?:is\s+(?:there|right\s+there|in\s+there|on\s+(?:the\s+)?list|a\s+patient)|is\s+open|duh|lol)\.?$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

/** Next message while an add-note is waiting on a patient and/or the text. */
export function continueAddNote<T extends CommandPatient>(raw: string, pending: PendingAddNote, patients: T[]): AddNoteStep<T> | null {
  const byId = (id: string | null) => (id ? patients.find((p) => p.id === id) ?? null : null);
  const settled = byId(pending.patientId);
  if (settled) {
    const text = cleanNoteText(normalizeCasual(raw));
    if (!text || /^(cancel|never ?mind|nvm|stop|forget it)$/i.test(text)) return null;
    return { kind: "confirm", patient: settled, text };
  }
  if (/^(cancel|never ?mind|nvm|stop|forget it)\b/i.test(normalizeCasual(raw))) return null;
  // A fresh, full add-note request replaces the pending one.
  if (isAddNote(raw)) return planAddNote(raw, patients, null);
  const cleaned = stripNameReplyFiller(raw);
  const lead = splitLeadingName(cleaned, patients);
  if (!lead) {
    const anywhere = findNameAnywhere(cleaned, patients);
    if (anywhere) return stepFor(null, activeFirst(anywhere.matches), anywhere.nameText, pending.text, patients);
    return null;
  }
  const text = pending.text ?? (lead.rest || null);
  return stepFor(null, activeFirst(lead.matches), lead.nameText, text, patients);
}

// ── Team messages ────────────────────────────────────────────────────────

/** Casual "message X …" phrasings rewritten to the "tell X …" form parseTell knows. */
export function canonicalTell(raw: string): string {
  let q = joinDrTitle(normalizeCasual(raw));
  q = q.replace(/^(?:send|shoot|drop|write|give)\s+(?:a\s+)?(?:quick\s+)?(?:message|text|note|line|heads up)\s+(?:to\s+)?([A-Za-z][A-Za-z'-]*)\s*(?:[:,\-–—]\s*|\s+(?:saying|that|to say)\s+|\s+)/i, "tell $1 ");
  q = q.replace(/^(?:send|shoot|drop|give)\s+([A-Za-z][A-Za-z'-]*)\s+(?:a\s+)?(?:quick\s+)?(?:message|text|note|line|heads up)\s*(?:[:,\-–—]\s*|\s+(?:saying|that|to say)\s+|\s+)/i, "tell $1 ");
  q = q.replace(/^(?:message|text|tell|ask|remind|ping)\s+([A-Za-z][A-Za-z'-]*)\s*[:,\-–—]\s*/i, "tell $1 ");
  q = q.replace(/^ask\s+([A-Za-z][A-Za-z'-]*)\s+(to|if|whether|about|for)\s+/i, (_m, who: string, w: string) => `tell ${who} ${w === "to" ? "to " : `${w} `}`);
  q = q.replace(/^(?:let|have)\s+([A-Za-z][A-Za-z'-]*)\s+know\s+(?:that\s+)?/i, "tell $1 ");
  q = q.replace(/^(?:can you\s+)?(?:message|text)\s+([A-Za-z][A-Za-z'-]*)\s+(?:and\s+)?(?:say|tell (?:her|him|them))\s+(?:that\s+)?/i, "tell $1 ");
  return q.replace(/^(\s*\S+\s+)dr-(?=[A-Za-z])/i, "$1Dr. ");
}

export function isTell(raw: string): boolean {
  const q = canonicalTell(raw);
  return isTellRequest(q) && Boolean(parseTell(q));
}

// ── Booking ──────────────────────────────────────────────────────────────

export function canonicalBooking(raw: string): string {
  let q = normalizeCasual(raw);
  q = q.replace(/^(?:get|put|pencil|squeeze|fit|slot)\s+(.+?)\s+(?:in|on the books|on the schedule|into the schedule|down)\b/i, "book $1");
  q = q.replace(/^(?:set|line)\s+up\s+(?:an?\s+)?(?:appointment|visit)\s+(?:for|with)\s+/i, "book ");
  q = q.replace(/^(?:make|add|create|set)\s+(?:an?\s+)?(?:appointment|visit)\s+(?:for|with)\s+/i, "book ");
  q = q.replace(/^(?:schedule|rebook|reschedule)\s+/i, "book ");
  return q;
}

export function isBooking(raw: string): boolean {
  const q = canonicalBooking(raw);
  return isBookingRequest(q) || /^book\s+[A-Za-z]/i.test(q);
}

// ── Bill lookup ──────────────────────────────────────────────────────────

const BILL_WORDS = /\b(balance|bill|billed|billing|owe|owed|pay|paid|outstanding|charges?|paid|payment|payments|statement|ledger|amount due|due|account|r&b|rb|reduction|red req)\b/i;
const BILL_ASK = /\b(what|whats|what's|how much|how's|hows|show|pull up|check|look up|lookup|get|give|tell me|is|does|did|has|any|need|see)\b|^(?:balance|bill)\b|\b(balance|bill)\s*$/i;

export function isBillLookup(raw: string): boolean {
  const q = normalizeCasual(raw);
  if (isAddNote(raw) || isTell(raw)) return false;
  return BILL_WORDS.test(q) && (BILL_ASK.test(q) || q.split(/\s+/).length <= 4) && !/\b(book|schedule|add a note|note for)\b/i.test(q);
}

/** The question rewritten so the patient-file answerer picks its billing answer. */
export function canonicalBillQuestion(): string {
  return "what is the balance and billing";
}

// ── Router ───────────────────────────────────────────────────────────────

export function detectCommand(raw: string): CommandKind | null {
  if (isAddNote(raw)) return "addNote";
  if (isTell(raw)) return "tell";
  if (isBooking(raw)) return "book";
  if (isBillLookup(raw)) return "bill";
  return null;
}

/**
 * For a message nothing understood that names a known patient: a helpful
 * question offering the actions, instead of "couldn't find that in the file".
 */
export function clarifyForPatient(patientName: string, leftover: string): { text: string; options: Array<{ label: string; question: string }> } {
  const note = leftover.trim();
  const options = [
    ...(note ? [{ label: `Add as a note`, question: `add a note for ${patientName}: ${note}` }] : [{ label: "Add a note", question: `add a note for ${patientName}` }]),
    { label: "Look up the bill", question: `what is ${patientName}'s balance` },
    { label: "Book an appointment", question: `book ${patientName}` },
  ];
  return {
    text: note
      ? `I'm not sure what you'd like me to do for ${patientName}. Should I add "${note}" as a note, or something else?`
      : `What would you like me to do for ${patientName}? I can add a note, look up the bill, book a visit, or answer a question about their file.`,
    options,
  };
}

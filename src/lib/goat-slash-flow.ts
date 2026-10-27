/**
 * Step-by-step "/" command flows (rules only, pure). Each turn takes what the
 * user typed (or a tapped chip's token) plus the pending step, and returns
 * what G.O.A.T. says, chips to show, the next pending step, and — at the end —
 * an action for the chat to turn into ONE confirm card. Nothing is saved here.
 *
 *  /note gisselle call atty → the matched patient(s) as buttons (never a silent pick)
 *           → tap → confirm card; no text → "What's the note?"; no match → picker
 *  /note    → patient type-ahead (name / case # / phone) → "What's the note?" → confirm
 *  /todo    → same flow; the picker also offers "No patient / general to-do"
 *  /todo call tyler smith → matched patient as buttons, the name stays in the task
 *  /contact → Add or edit? → Add: one contact or a pasted list → review card
 *                          → Edit: pick contact → edit card → confirm
 */
import { isEverydayWord } from "@/lib/goat-name-guard";
import { matchPatientsByName } from "@/lib/goat-notes";
import { findNameAnywhere } from "@/lib/goat-commands";
import { CHIPS, detectBrief, parseTodo } from "@/lib/goat-briefs";
import { isGoatHelpQuestion } from "@/lib/handbook-goat";
import { detectPipeline, detectReview } from "@/lib/goat-pipeline";
import { looksLikeContactPaste } from "@/lib/goat-contacts-import";
import { detectPlainTodo, isNoPatientName } from "@/lib/goat-intents";

/**
 * True when typed text is clearly a NEW request, not an answer to the waiting
 * step: a chip / brief ("Appointment Check", "how's business"), help, a "/" or
 * "@" command, or a pasted contact list. These always break out of a flow.
 */
export function breaksFlow(text: string, pending?: Pending | null): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("/") && !t.startsWith(TOKEN)) return true;
  if (t.startsWith("@")) return true;
  if ((CHIPS as readonly string[]).some((c) => c.toLowerCase() === t.toLowerCase())) return true;
  if (detectPlainTodo(t)) return true; // "remind me to …" is a new request, never a name answer
  if (detectBrief(t) || detectPipeline(t) || detectReview(t) || isGoatHelpQuestion(t)) return true;
  // A pasted list IS the answer when we asked for contacts.
  return pending?.k !== "contactAdd" && looksLikeContactPaste(t) && t.includes("\n");
}
/** Name pickers give up on text that reads like a question/sentence instead of a name. */
const notAName = (t: string) => /[?]/.test(t) || t.split(/\s+/).length > 5 || /^(how|what|who|when|where|why|show|list|mark|add|tell|schedule|book)\b/i.test(t);

export interface FlowPatient {
  id: string;
  fullName: string;
  caseStatus: string;
  /** For the type-ahead picker: search by case # or phone too. */
  caseNumber?: string;
  phone?: string;
}
export interface FlowContact { id: string; name: string; category: string; phone?: string }
export interface FlowCtx { today: string; patients: FlowPatient[]; contacts: FlowContact[]; openPatientId?: string | null }

export type Pending =
  | { k: "notePick"; text?: string }
  | { k: "noteText"; patientId: string }
  | { k: "todoKind" }
  | { k: "todoPick"; text?: string }
  | { k: "todoText"; patientId?: string }
  | { k: "contactKind" }
  | { k: "contactAdd" }
  | { k: "contactPick" };

export type FlowAction =
  | { type: "noteConfirm"; patientId: string; text: string }
  | { type: "todoConfirm"; title: string; due: string; patientId?: string }
  | { type: "contactPaste"; text: string }
  | { type: "contactEdit"; contactId: string };

export interface FlowChoice { label: string; token: string }
/** Show the patient type-ahead (real patients; search by name, case # or phone). Picking one sends `/:<next>-case <id>`. */
export interface FlowPicker { next: "note" | "todo"; prefill?: string; allowNone?: boolean }
export interface FlowTurn { say: string; choices?: FlowChoice[]; pending: Pending | null; action?: FlowAction; picker?: FlowPicker }

/** Chip tokens start with this so they never collide with typed text. */
export const TOKEN = "/:";
export const isFlowToken = (t: string) => t.startsWith(TOKEN);

const ACTIVE = /^(active|new)$/i;
const label = (p: FlowPatient) => `${p.fullName} · ${p.caseStatus || "No status"}`;
const CANCEL = /^(cancel|never ?mind|nvm|stop|forget it)\b/i;

const digits = (v: string) => v.replace(/\D/g, "");
const NONE_CHOICE: FlowChoice = { label: "No patient / general to-do", token: `${TOKEN}todo-plain` };

/**
 * Type-ahead search over patients: every typed word must hit the name (start of a name part), the
 * case # (contains) or the phone (digits contain, 3+ digits). Active cases first, then name order.
 * Falls back to the guarded close-spelling match only when nothing matches literally.
 */
export function searchPatients(query: string, patients: FlowPatient[], limit = 8): FlowPatient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (p: FlowPatient) => {
    const parts = nameParts(p.fullName);
    const cn = (p.caseNumber ?? "").toLowerCase();
    const ph = digits(p.phone ?? "");
    return words.every((w) => parts.some((x) => x.startsWith(w)) || (cn && cn.includes(w)) || (digits(w).length >= 3 && ph.includes(digits(w))));
  };
  let found = patients.filter(hit);
  if (!found.length) found = matchPatientsByName(query, patients);
  const first = (p: FlowPatient) => (words[0] && nameParts(p.fullName).some((x) => x === words[0]) ? 0 : 1);
  return [...found].sort((a, b) => Number(ACTIVE.test(b.caseStatus)) - Number(ACTIVE.test(a.caseStatus)) || first(a) - first(b) || a.fullName.localeCompare(b.fullName)).slice(0, limit);
}

/** Matching cases for a typed name: always shown as buttons to confirm (never a silent pick). Max 8. */
export function casePicker(name: string, ctx: FlowCtx, next: "note" | "todo", text?: string, found?: FlowPatient[]): FlowTurn {
  const all = found ?? matchPatientsByName(name, ctx.patients);
  const pend: Pending = next === "note" ? { k: "notePick", ...(text ? { text } : {}) } : { k: "todoPick", ...(text ? { text } : {}) };
  if (!all.length) {
    return {
      say: `I couldn't find a patient for "${name}". Search below, or type the name again.`,
      pending: pend,
      picker: { next, prefill: name, allowNone: next === "todo" },
      choices: next === "todo" ? [NONE_CHOICE] : undefined,
    };
  }
  const sorted = [...all].sort((a, b) => Number(ACTIVE.test(b.caseStatus)) - Number(ACTIVE.test(a.caseStatus)) || a.fullName.localeCompare(b.fullName));
  const choices = sorted.slice(0, 8).map((p) => ({ label: label(p), token: `${TOKEN}${next}-case ${p.id}` }));
  return {
    say: all.length === 1 ? "Is this the patient?" : `Which patient? (${all.length} match)`,
    choices: next === "todo" ? [...choices, NONE_CHOICE] : choices,
    pending: pend,
  };
}

/** Bare "/note" or "/todo": the patient type-ahead (and for to-dos a "No patient" option). */
function whichCase(ctx: FlowCtx, next: "note" | "todo", prefill?: string, text?: string): FlowTurn {
  const open = ctx.patients.find((p) => p.id === ctx.openPatientId);
  const choices: FlowChoice[] = [];
  if (open) choices.push({ label: label(open), token: `${TOKEN}${next}-case ${open.id}` });
  if (next === "todo") choices.push(NONE_CHOICE);
  return {
    say: "Which patient? Start typing a name, case # or phone.",
    choices: choices.length ? choices : undefined,
    pending: next === "note" ? { k: "notePick", ...(text ? { text } : {}) } : { k: "todoPick", ...(text ? { text } : {}) },
    picker: { next, prefill, allowNone: next === "todo" },
  };
}

function dist(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const nameParts = (n: string) => n.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
/**
 * Everyday task words that are never a typo of a name. Without this, "/todo call tyler smith"
 * read "call" as a misspelling of "Hall" and filed the to-do under Hall, dropping the verb.
 * An exact match still wins (a patient really named "Call").
 */
const TASK_WORDS = new Set(
  ("call text email fax send ask tell remind follow check confirm contact reach meet see visit review " +
    "schedule book order request get pick drop print sign file update bill mail scan copy pull find lookup look " +
    "pay refund cancel reschedule renew return verify follow-up followup draft write prepare submit upload download " +
    "chase notify message msg dial phone page ping wait need needs want with about regarding").split(/\s+/),
);
/** One typed word vs one name part: exact, or a close spelling (4+ letters, 1 edit; 6+ letters, 2). */
function wordHits(w: string, part: string): boolean {
  if (w === part) return true;
  if (TASK_WORDS.has(w) || isEverydayWord(w)) return false;
  if (w.length < 4 || part.length < 4) return false;
  return dist(w, part) <= (Math.min(w.length, part.length) >= 6 ? 2 : 1);
}

/**
 * "/note gisselle call atty" → the patient(s) named by the LONGEST leading run
 * of words (first, last or full name, close spellings OK) and the rest as text.
 * Every word of the run must hit the same patient, so "call" is never a name
 * unless a patient is really called that.
 */
export function splitNameAndText(rest: string, patients: FlowPatient[]): { matches: FlowPatient[]; text: string } {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const ws = words.slice(0, n).map((w) => w.toLowerCase().replace(/[^a-z'-]/g, "")).filter(Boolean);
    if (ws.length !== n) continue;
    const exact = patients.filter((p) => ws.every((w) => nameParts(p.fullName).includes(w)));
    const hits = exact.length ? exact : patients.filter((p) => ws.every((w) => nameParts(p.fullName).some((x) => wordHits(w, x))));
    if (hits.length) return { matches: hits, text: words.slice(n).join(" ").replace(/^[:\-–—,]\s*/, "").trim() };
  }
  return { matches: [], text: rest.trim() };
}

/** Name matched → the matched patient(s) as confirm buttons (never a silent pick). */
function namedFlow(next: "note" | "todo", m: FlowPatient[], text: string, ctx: FlowCtx): FlowTurn {
  return casePicker("", ctx, next, text, m);
}
function withCase(next: "note" | "todo", p: FlowPatient, text: string | undefined, ctx: FlowCtx): FlowTurn {
  if (next === "note") {
    return text ? { say: "", pending: null, action: { type: "noteConfirm", patientId: p.id, text } } : { say: `What's the note for ${p.fullName}?`, pending: { k: "noteText", patientId: p.id } };
  }
  const td = text ? parseTodo(text, ctx.today) : null;
  return td?.title ? { say: "", pending: null, action: { type: "todoConfirm", title: td.title, due: td.due, patientId: p.id } } : { say: `What's the task for ${p.fullName}?`, pending: { k: "todoText", patientId: p.id } };
}

/** A patient named anywhere in a to-do ("call tyler smith"): the whole text stays the task. */
function nameAnywhere(rest: string, patients: FlowPatient[]): FlowPatient[] {
  const hit = findNameAnywhere(rest, patients);
  return hit?.matches ?? [];
}

/** Name part of "/note <name>: text" when no patient matched (used to prefill the picker). */
function queryOf(rest: string): { query: string; text?: string } {
  const sep = /^([^:\-–—]{1,40})\s*[:\-–—]\s*(.*)$/.exec(rest);
  if (sep) return { query: sep[1].trim(), text: sep[2].trim() || undefined };
  const words = rest.trim().split(/\s+/);
  if (words.length <= 3) return { query: rest.trim() };
  return { query: "", text: rest.trim() };
}

/** Start a flow from "/note …", "/todo …" or "/contact …". Null = not a flow start (use the one-shot path). */
export function startFlow(cmd: string, rest: string, ctx: FlowCtx): FlowTurn | null {
  if (cmd === "note") {
    if (!rest) return whichCase(ctx, "note");
    const { matches, text } = splitNameAndText(rest, ctx.patients);
    if (matches.length) return namedFlow("note", matches, text, ctx);
    // No patient matched: never guess. Show the picker, prefilled with what was typed.
    const q = queryOf(rest);
    return { ...whichCase(ctx, "note", q.query, q.text), say: `I couldn't tell which patient${q.query ? ` "${q.query}"` : ""} is. Search below.` };
  }
  if (cmd === "todo") {
    if (!rest) return whichCase(ctx, "todo");
    // "/todo none: …" (the No patient chip) → the one-shot path, never a name match ("none" ≠ Nune).
    const lead = /^([^:]{1,20}):/.exec(rest);
    if (lead && isNoPatientName(lead[1])) return null;
    // "/todo aram subpoena records friday" → name up front, the rest is the task.
    const { matches, text } = splitNameAndText(rest, ctx.patients);
    if (matches.length) return namedFlow("todo", matches, text, ctx);
    // "/todo call tyler smith" → a name anywhere; the name stays in the task text.
    const anywhere = nameAnywhere(rest, ctx.patients);
    if (anywhere.length) return namedFlow("todo", anywhere, rest.trim(), ctx);
    return null; // no patient named → a general to-do (one-shot path)
  }
  if (cmd === "contact" || cmd === "contacts") {
    if (rest && /\n/.test(rest)) return { say: "", pending: null, action: { type: "contactPaste", text: rest } };
    if (/^add\b/i.test(rest)) return addPrompt();
    if (/^edit\b/i.test(rest)) return rest.replace(/^edit\b\s*/i, "") ? contactPicker(rest.replace(/^edit\b\s*/i, ""), ctx) : { say: "Which contact? Type part of the name.", pending: { k: "contactPick" } };
    return { say: "Add or edit?", choices: [{ label: "Add", token: `${TOKEN}contact-add` }, { label: "Edit", token: `${TOKEN}contact-edit` }], pending: { k: "contactKind" } };
  }
  return null;
}

const addPrompt = (): FlowTurn => ({ say: "Type one contact (name, phone, address) or paste a list — one contact per block.", pending: { k: "contactAdd" } });

export function contactPicker(q: string, ctx: FlowCtx): FlowTurn {
  const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const hits = ctx.contacts.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  if (!hits.length) return { say: `No contact matches "${q}". Type part of the name again.`, pending: { k: "contactPick" } };
  return {
    say: hits.length === 1 ? "This one?" : `Which contact? (${hits.length} match)`,
    choices: hits.slice(0, 8).map((c) => ({ label: `${c.name} · ${c.category}`, token: `${TOKEN}contact-pick ${c.id}` })),
    pending: { k: "contactPick" },
  };
}

/** Continue a pending flow with typed text or a chip token. Null = flow doesn't apply (let normal chat handle it). */
export function continueFlow(input: string, pending: Pending | null, ctx: FlowCtx): FlowTurn | null {
  const t = input.trim();
  if (isFlowToken(t)) {
    const [tok, arg] = t.slice(TOKEN.length).split(/\s+/, 2);
    const p = ctx.patients.find((x) => x.id === arg);
    switch (tok) {
      case "note-case":
        return p ? withCase("note", p, pending?.k === "notePick" ? pending.text : undefined, ctx) : null;
      case "todo-plain": {
        // "No patient / general to-do": straight to the confirm card when the task is already known.
        const known = pending?.k === "todoPick" ? pending.text : undefined;
        const td = known ? parseTodo(known, ctx.today) : null;
        if (td?.title) return { say: "", pending: null, action: { type: "todoConfirm", title: td.title, due: td.due } };
        return { say: "What's the task? (add a day if you like: \"order supplies friday\")", pending: { k: "todoText" } };
      }
      case "todo-case-pick":
        return whichCase(ctx, "todo");
      case "todo-case":
        return p ? withCase("todo", p, pending?.k === "todoPick" ? pending.text : undefined, ctx) : null;
      case "contact-add":
        return addPrompt();
      case "contact-edit":
        return { say: "Which contact? Type part of the name.", pending: { k: "contactPick" } };
      case "contact-pick":
        return ctx.contacts.some((c) => c.id === arg) ? { say: "Change what you need, then Confirm.", pending: null, action: { type: "contactEdit", contactId: arg } } : null;
      default:
        return null;
    }
  }
  if (!pending) return null;
  if (breaksFlow(t, pending)) return null; // a new request replaces the old step
  if ((pending.k === "notePick" || pending.k === "todoPick" || pending.k === "contactPick") && notAName(t)) return null;
  if (CANCEL.test(t)) return { say: "Okay, cancelled.", pending: null };
  switch (pending.k) {
    case "notePick":
    case "todoPick": {
      const next = pending.k === "notePick" ? "note" : "todo";
      const m = searchPatients(t, ctx.patients);
      return casePicker(t, ctx, next, pending.text, m.length ? m : undefined);
    }
    case "noteText":
      return { say: "", pending: null, action: { type: "noteConfirm", patientId: pending.patientId, text: t } };
    case "todoText": {
      const td = parseTodo(t, ctx.today);
      if (!td.title) return { say: "What's the task?", pending };
      return { say: "", pending: null, action: { type: "todoConfirm", title: td.title, due: td.due, patientId: pending.patientId } };
    }
    case "contactAdd":
      return { say: "", pending: null, action: { type: "contactPaste", text: t } };
    case "contactPick":
      return contactPicker(t, ctx);
    case "todoKind":
      return /case|patient/i.test(t) ? whichCase(ctx, "todo") : /just|plain|no/i.test(t) ? { say: "What's the task?", pending: { k: "todoText" } } : null;
    case "contactKind":
      return /^add/i.test(t) ? addPrompt() : /^edit/i.test(t) ? { say: "Which contact? Type part of the name.", pending: { k: "contactPick" } } : null;
  }
}

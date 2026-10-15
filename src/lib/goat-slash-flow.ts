/**
 * Step-by-step "/" command flows (rules only, pure). Each turn takes what the
 * user typed (or a tapped chip's token) plus the pending step, and returns
 * what G.O.A.T. says, chips to show, the next pending step, and — at the end —
 * an action for the chat to turn into ONE confirm card. Nothing is saved here.
 *
 *  /note    → Which case? (picker) → the note text → confirm
 *  /todo    → Just a to-do, or add to a case? → (case picker) → text → confirm
 *  /contact → Add or edit? → Add: one contact or a pasted list → review card
 *                          → Edit: pick contact → edit card → confirm
 */
import { matchPatientsByName } from "@/lib/goat-notes";
import { parseTodo } from "@/lib/goat-briefs";

export interface FlowPatient { id: string; fullName: string; caseStatus: string }
export interface FlowContact { id: string; name: string; category: string; phone?: string }
export interface FlowCtx { today: string; patients: FlowPatient[]; contacts: FlowContact[]; openPatientId?: string | null }

export type Pending =
  | { k: "notePick" }
  | { k: "noteText"; patientId: string }
  | { k: "todoKind" }
  | { k: "todoPick" }
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
export interface FlowTurn { say: string; choices?: FlowChoice[]; pending: Pending | null; action?: FlowAction }

/** Chip tokens start with this so they never collide with typed text. */
export const TOKEN = "/:";
export const isFlowToken = (t: string) => t.startsWith(TOKEN);

const ACTIVE = /^(active|new)$/i;
const label = (p: FlowPatient) => `${p.fullName} · ${p.caseStatus || "No status"}`;
const CANCEL = /^(cancel|never ?mind|nvm|stop|forget it)\b/i;

/** Matching cases for a typed name, active first (max 8). */
export function casePicker(name: string, ctx: FlowCtx, next: "note" | "todo"): FlowTurn {
  const all = matchPatientsByName(name, ctx.patients);
  const pend: Pending = next === "note" ? { k: "notePick" } : { k: "todoPick" };
  if (!all.length) return { say: `I couldn't find a case for "${name}". Type the patient's name again.`, pending: pend };
  const sorted = [...all].sort((a, b) => Number(ACTIVE.test(b.caseStatus)) - Number(ACTIVE.test(a.caseStatus)) || a.fullName.localeCompare(b.fullName));
  return {
    say: all.length === 1 ? "Is this the case?" : `Which case? (${all.length} match)`,
    choices: sorted.slice(0, 8).map((p) => ({ label: label(p), token: `${TOKEN}${next}-case ${p.id}` })),
    pending: pend,
  };
}

function whichCase(ctx: FlowCtx, next: "note" | "todo"): FlowTurn {
  const open = ctx.patients.find((p) => p.id === ctx.openPatientId);
  return {
    say: "Which case? Type the patient's name.",
    choices: open ? [{ label: label(open), token: `${TOKEN}${next}-case ${open.id}` }] : undefined,
    pending: next === "note" ? { k: "notePick" } : { k: "todoPick" },
  };
}

/** Start a flow from "/note …", "/todo …" or "/contact …". Null = not a flow start (use the one-shot path). */
export function startFlow(cmd: string, rest: string, ctx: FlowCtx): FlowTurn | null {
  if (cmd === "note") {
    if (!rest) return whichCase(ctx, "note");
    // "/note john smith" (no text) → picker; "/note john smith: text" → one-shot path.
    if (!/[:\-–—]/.test(rest)) return casePicker(rest, ctx, "note");
    return null;
  }
  if (cmd === "todo") {
    if (!rest) return { say: "Just a to-do, or add it to a case?", choices: [{ label: "Just a to-do", token: `${TOKEN}todo-plain` }, { label: "Add to a case", token: `${TOKEN}todo-case-pick` }], pending: { k: "todoKind" } };
    return null;
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
        return p ? { say: `What should the note for ${p.fullName} say?`, pending: { k: "noteText", patientId: p.id } } : null;
      case "todo-plain":
        return { say: "What's the to-do? (add a day if you like: \"order supplies friday\")", pending: { k: "todoText" } };
      case "todo-case-pick":
        return whichCase(ctx, "todo");
      case "todo-case":
        return p ? { say: `What's the to-do for ${p.fullName}?`, pending: { k: "todoText", patientId: p.id } } : null;
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
  if (t.startsWith("/") || t.startsWith("@")) return null; // a new command replaces the old step
  if (CANCEL.test(t)) return { say: "Okay, cancelled.", pending: null };
  switch (pending.k) {
    case "notePick":
      return casePicker(t, ctx, "note");
    case "todoPick":
      return casePicker(t, ctx, "todo");
    case "noteText":
      return { say: "", pending: null, action: { type: "noteConfirm", patientId: pending.patientId, text: t } };
    case "todoText": {
      const td = parseTodo(t, ctx.today);
      if (!td.title) return { say: "What's the to-do?", pending };
      return { say: "", pending: null, action: { type: "todoConfirm", title: td.title, due: td.due, patientId: pending.patientId } };
    }
    case "contactAdd":
      return { say: "", pending: null, action: { type: "contactPaste", text: t } };
    case "contactPick":
      return contactPicker(t, ctx);
    case "todoKind":
      return /case|patient/i.test(t) ? whichCase(ctx, "todo") : /just|plain|no/i.test(t) ? { say: "What's the to-do?", pending: { k: "todoText" } } : null;
    case "contactKind":
      return /^add/i.test(t) ? addPrompt() : /^edit/i.test(t) ? { say: "Which contact? Type part of the name.", pending: { k: "contactPick" } } : null;
  }
}

/**
 * One G.O.A.T. turn for office chat, as a pure function (mock-testable).
 *
 * Holds what a human assistant would remember between messages: the patient
 * we were just talking about ("him", "her", "that one"), the last list of
 * name matches ("no, the other John"), a half-finished add-note, and the last
 * office answer for follow-ups. The chat component uses it for the parts it
 * owns (add-note across turns, corrections, clarifying questions); the
 * office-day eval drives every turn through it.
 */
import { answerOffice, type OfficeMemory } from "@/lib/goat-office";
import { isPracticeWide, type PracticeData, type PracticePatient } from "@/lib/goat-practice";
import { matchRecipient, parseTell, type TeamPerson } from "@/lib/goat-message";
import { planBooking, type BookingStep } from "@/lib/goat-booking";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";
import {
  canonicalBooking,
  canonicalTell,
  clarifyForPatient,
  continueAddNote,
  detectCommand,
  findNameAnywhere,
  normalizeCasual,
  patientsNamed,
  planAddNote,
  type AddNoteStep,
  type CommandPatient,
  type PendingAddNote,
} from "@/lib/goat-commands";

export interface DialogState {
  lastPatientId: string | null;
  /** Ids from the last "which one?" or name match, for "no, the other John". */
  lastCandidates: string[];
  /** The last message that acted on a patient, replayed on a correction. */
  lastAction: string | null;
  pendingNote: PendingAddNote | null;
  office: OfficeMemory | null;
}

export const emptyDialog = (): DialogState => ({ lastPatientId: null, lastCandidates: [], lastAction: null, pendingNote: null, office: null });

export interface DialogCtx {
  data: PracticeData;
  team: TeamPerson[];
  openPatientId: string | null;
  settings: ScheduleSettingsConfig;
}

export type DialogReply =
  | { kind: "noteConfirm"; patientId: string; text: string; say: string }
  | { kind: "ask"; say: string }
  | { kind: "choose"; say: string; patientIds: string[] }
  | { kind: "messageConfirm"; to: string; text: string; patientId: string | null; say: string }
  | { kind: "booking"; patientId: string; step: BookingStep; say: string }
  | { kind: "fileQuestion"; patientId: string; topic: "bill" | "attorney" | "other"; question: string; say: string }
  | { kind: "office"; say: string }
  | { kind: "clarify"; patientId: string; say: string }
  | { kind: "unsupported"; say: string; patientId: string | null }
  | { kind: "help"; say: string };

const PRONOUN = /\b(him|her|he|she|his|hers|them|they|their|that one|this one|that patient|this patient|same (?:one|patient)|the patient)\b/i;
const CANCEL_PENDING = /^(cancel|never ?mind|nvm|forget (?:it|that)|stop)\b/i;
const MOVE_OR_CANCEL = /\b(cancel|move|push|bump|delete|remove)\b.*\b(appt|appointment|visit|today|tomorrow|at \d)|\b(cancel|move|push back|bump)\s+(?:him|her|them|[a-z]+(?:'s)?)\b/i;
/** Words that make "kara last visit" a question about the file, not a statement. */
const FILE_TOPIC = /\b(last|next|first)\s+(visit|appt|appointment)|\b(visits?|mri|x-?rays?|xr|ct|emg|dob|birthday|date of (birth|loss|injury)|dol|doi|injur\w*|diagnos\w*|dx|icd|recommend\w*|plan|treatment|notes?|reports?|soap|meds?|medications?|rom|pain|referr\w*|specialist|ortho|pm|claim|adjuster|insurance|phone|address|email|case status|status)\b/i;
const QUESTIONY = /\?$|^(who|what|whats|what's|when|where|which|why|how|is|are|was|were|does|did|do|has|have|can|could|any)\b/i;

function cp(p: PracticePatient): CommandPatient {
  return { id: p.id, fullName: p.fullName, active: !/^(dropped|paid|discharged)$/i.test(p.caseStatus) };
}

function shortName(p: { fullName: string }): string {
  return p.fullName;
}

/** Patients a message points at: a name, else a pronoun → the last patient. */
function patientRef(msg: string, st: DialogState, pts: CommandPatient[]): { ids: string[]; via: "name" | "pronoun" | "none"; nameText?: string } {
  const named = findNameAnywhere(msg, pts);
  if (named) {
    const active = named.matches.filter((p) => p.active !== false);
    return { ids: (active.length ? active : named.matches).map((p) => p.id), via: "name", nameText: named.nameText };
  }
  if (PRONOUN.test(msg) && st.lastPatientId) return { ids: [st.lastPatientId], via: "pronoun" };
  return { ids: [], via: "none" };
}

function noteReply(step: AddNoteStep<CommandPatient> | null, st: DialogState): { reply: DialogReply; state: DialogState } | null {
  if (!step) return null;
  switch (step.kind) {
    case "confirm":
      return { reply: { kind: "noteConfirm", patientId: step.patient.id, text: step.text, say: `Add this to ${shortName(step.patient)}'s Notes? "${step.text}"` }, state: { ...st, pendingNote: null, lastPatientId: step.patient.id } };
    case "choose":
      return { reply: { kind: "choose", say: `Which ${step.name}?`, patientIds: step.candidates.map((p) => p.id) }, state: { ...st, pendingNote: { text: step.text, patientId: null }, lastCandidates: step.candidates.map((p) => p.id) } };
    case "askText":
      return { reply: { kind: "ask", say: step.prompt }, state: { ...st, pendingNote: step.pending, lastPatientId: step.patient.id } };
    case "askPatient":
    case "notFound":
      return { reply: { kind: "ask", say: step.prompt }, state: { ...st, pendingNote: step.pending } };
  }
}

/** Schedule for a day grouped by office (appointment location), for "who's coming and where". */
function scheduleByOffice(data: PracticeData, iso: string): string | null {
  const appts = data.appointments.filter((a) => a.date === iso && a.status !== "Canceled" && a.status !== "No Show").sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (!appts.length) return null;
  const by = new Map<string, string[]>();
  for (const a of appts) {
    const loc = a.location?.trim() || "No office set";
    const h = Number(a.startTime.slice(0, 2));
    const t = `${((h + 11) % 12) + 1}:${a.startTime.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
    by.set(loc, [...(by.get(loc) ?? []), `  • ${t} ${a.patientName}${a.appointmentType ? `, ${a.appointmentType}` : ""}`]);
  }
  return [...by.entries()].map(([loc, lines]) => `${loc} (${lines.length}):\n${lines.join("\n")}`).join("\n");
}

export function goatTurn(raw: string, st0: DialogState, ctx: DialogCtx): { reply: DialogReply; state: DialogState } {
  const st = { ...st0 };
  const pts = ctx.data.patients.map(cp);
  const byId = (id: string | null) => (id ? pts.find((p) => p.id === id) ?? null : null);
  const msg = normalizeCasual(raw);

  // 1. Half-finished add-note: the next message continues it.
  if (st.pendingNote) {
    if (CANCEL_PENDING.test(msg)) return { reply: { kind: "ask", say: "Okay, I won't add that note." }, state: { ...st, pendingNote: null } };
    const cmd = detectCommand(raw);
    if (!cmd || cmd === "addNote") {
      const step = continueAddNote(raw, st.pendingNote, pts);
      const r = noteReply(step, st);
      if (r) return r;
      if (!cmd) return { reply: { kind: "ask", say: "Which patient is the note for? Type their name." }, state: st };
    } else st.pendingNote = null;
  }

  // 2. Corrections: "no, the other John", "not her, Kara Jones".
  const corr = /^(?:no|nope|wrong one|not (?:him|her|that one|them))[,.!]?\s*(?:i meant\s+|i mean\s+)?(?:the\s+)?(other\s+)?(.+?)$/i.exec(msg);
  if (corr && st.lastAction && (corr[1] || /^(?:not|wrong)/i.test(msg) || patientsNamed(corr[2].toLowerCase().split(/\s+/), pts).length)) {
    const words = corr[2].toLowerCase().replace(/[^a-z\s'-]/g, "").split(/\s+/).filter(Boolean);
    let cands = words.length ? patientsNamed(words, pts) : st.lastCandidates.map((id) => byId(id)!).filter(Boolean);
    if (corr[1] || !words.length) cands = cands.filter((p) => p.id !== st.lastPatientId);
    if (!cands.length && st.lastCandidates.length) cands = st.lastCandidates.map((id) => byId(id)!).filter((p) => p && p.id !== st.lastPatientId);
    if (cands.length === 1) {
      const p = cands[0];
      const last = byId(st.lastPatientId);
      const replay = last ? replaceName(st.lastAction, last.fullName, p.fullName) : `${st.lastAction} ${p.fullName}`;
      return goatTurn(replay, { ...st, lastPatientId: p.id, lastCandidates: [] }, ctx);
    }
    if (cands.length > 1) return { reply: { kind: "choose", say: "Which one?", patientIds: cands.map((p) => p.id) }, state: { ...st, lastCandidates: cands.map((p) => p.id) } };
  }

  // A pick from the last "which one?" list ("john davis") finishes that request.
  if (st.lastAction && st.lastCandidates.length > 1 && msg.split(/\s+/).length <= 3) {
    const pick = findNameAnywhere(msg, pts);
    const chosen = pick?.matches.filter((p) => st.lastCandidates.includes(p.id)) ?? [];
    if (chosen.length === 1) {
      const prev = findNameAnywhere(st.lastAction, pts);
      const replay = prev ? st.lastAction.replace(new RegExp(`\\b${escapeRe(prev.nameText)}\\b`, "i"), chosen[0].fullName) : `${st.lastAction} ${chosen[0].fullName}`;
      return goatTurn(replay, { ...st, lastCandidates: [], lastPatientId: chosen[0].id }, ctx);
    }
  }

  // "jane no showed, add a note that we left a vm": the note request comes after a clause.
  const mid = /^(.*?)[,;.]?\s+(?:and\s+|so\s+|pls\s+|please\s+)?((?:add|put|write|leave|log|jot)\s+(?:down\s+)?(?:a\s+|an\s+)?(?:quick\s+)?note\b[\s\S]*)$/i.exec(msg);
  if (mid && mid[1] && !detectCommand(raw)) {
    const named = findNameAnywhere(mid[1], pts);
    if (named) {
      const tail = mid[2].replace(/^(?:add|put|write|leave|log|jot)\s+(?:down\s+)?(?:a\s+|an\s+)?(?:quick\s+)?note\s*/i, "");
      return goatTurn(`add a note for ${named.nameText} ${/^(that|saying|:|-)/i.test(tail) ? tail : `: ${tail}`}`, st, ctx);
    }
  }

  const cmd = detectCommand(raw);
  const ref = patientRef(msg, st, pts);
  const one = ref.ids.length === 1 ? byId(ref.ids[0]) : null;
  const remember = (id: string | null, action: string) => ({ ...st, lastPatientId: id ?? st.lastPatientId, lastAction: action, lastCandidates: ref.ids.length > 1 ? ref.ids : st.lastCandidates });

  // 3. Move / cancel an existing appointment: not done from chat yet — say where.
  if (MOVE_OR_CANCEL.test(msg) && cmd !== "addNote" && cmd !== "tell") {
    const p = one ?? byId(st.lastPatientId);
    return { reply: { kind: "unsupported", patientId: p?.id ?? null, say: `I can't move or cancel appointments from chat yet. Open ${p ? `${p.fullName}'s` : "the"} appointment on the Schedule and change it there.` }, state: remember(p?.id ?? null, raw) };
  }

  if (cmd === "addNote") {
    const open = byId(ctx.openPatientId) ?? (ref.via === "pronoun" ? one : null) ?? byId(st.lastPatientId);
    const r = noteReply(planAddNote(raw.replace(PRONOUN, (m) => (open && /^(him|her|them)$/i.test(m) ? open.fullName : m)), pts, open), st);
    if (r) return { ...r, state: { ...r.state, lastAction: raw } };
  }

  if (cmd === "tell") {
    const t = parseTell(canonicalTell(raw));
    if (t) {
      const to = matchRecipient(t.to, ctx.team);
      if (!to.length) return { reply: { kind: "ask", say: `I couldn't find a team member named "${t.to}".` }, state: st };
      const about = findNameAnywhere(t.text, pts);
      const pid = about?.matches.length === 1 ? about.matches[0].id : PRONOUN.test(t.text) ? st.lastPatientId : null;
      if (about && about.matches.length > 1) return { reply: { kind: "choose", say: "Which patient is this about?", patientIds: about.matches.map((p) => p.id) }, state: { ...st, lastCandidates: about.matches.map((p) => p.id), lastAction: raw } };
      return { reply: { kind: "messageConfirm", to: to[0].label, text: t.text, patientId: pid, say: `Send to ${to[0].label}: "${t.text}"${pid ? ` (about ${byId(pid)!.fullName})` : ""}?` }, state: remember(pid, raw) };
    }
  }

  if (cmd === "book") {
    if (ref.ids.length > 1) return { reply: { kind: "choose", say: "Book which patient?", patientIds: ref.ids }, state: remember(null, raw) };
    const p = one ?? byId(ctx.openPatientId);
    if (!p) return { reply: { kind: "ask", say: "Who should I book? Type their name, the day and the time." }, state: st };
    const step = planBooking({ question: canonicalBooking(raw), patient: { id: p.id, fullName: p.fullName }, todayIso: ctx.data.today, appointments: ctx.data.appointments, settings: ctx.settings });
    return { reply: { kind: "booking", patientId: p.id, step, say: step.kind === "draft" ? `Book ${p.fullName} ${step.draft.date} at ${step.draft.time}?` : `What ${step.kind === "needDay" ? "day" : "time"} for ${p.fullName}?` }, state: remember(p.id, raw) };
  }

  if (cmd === "bill") {
    if (ref.ids.length > 1) return { reply: { kind: "choose", say: "Whose bill?", patientIds: ref.ids }, state: remember(null, raw) };
    const p = one ?? byId(st.lastPatientId) ?? byId(ctx.openPatientId);
    if (!p) return { reply: { kind: "ask", say: "Whose balance? Type the patient's name." }, state: st };
    return { reply: { kind: "fileQuestion", patientId: p.id, topic: "bill", question: "what is the balance and billing", say: `Looking up ${p.fullName}'s bill.` }, state: remember(p.id, raw) };
  }

  // 4. Office questions (schedule, to-dos, case counts, checks, contacts), with follow-ups.
  const iso = /\btomorrow\b/i.test(msg) ? addDaysIso(ctx.data.today, 1) : ctx.data.today;
  if (/\b(which|what|each|by)\s+(office|location)s?\b|\bat which office\b|\bwhere\b.*\b(coming|seen)\b/i.test(msg) && /\b(who|coming|schedule|appointments?|today|tomorrow)\b/i.test(msg)) {
    const t = scheduleByOffice(ctx.data, iso);
    return { reply: { kind: "office", say: t ?? "Nothing is scheduled." }, state: { ...st, office: { kind: "schedule", day: iso } } };
  }
  if (ref.via !== "name" || !one) {
    const off = answerOffice(msg, ctx.data, st.office);
    if (off) return { reply: { kind: "office", say: off.text }, state: { ...st, office: off.memory ?? st.office } };
  }

  // Practice-wide wording ("how many…", "do we have", "our…") with no patient named:
  // never answered from the open / last patient's file.
  if (ref.via !== "name" && isPracticeWide(msg)) {
    return { reply: { kind: "help", say: "That sounds like a question about the whole office. I can count cases by status (active, submitted = checks waiting), show the schedule or to-dos, and look up contacts. What do you need?" }, state: st };
  }

  // 5. About a patient (named or "him/her"): attorney / LOP / anything in the file.
  const target = one ?? (ref.via === "none" ? null : byId(st.lastPatientId));
  if (ref.ids.length > 1) return { reply: { kind: "choose", say: "Which one?", patientIds: ref.ids }, state: remember(null, raw) };
  if (target) {
    if (/\b(atty|attorney|lawyer|law firm|lop|lien)\b/i.test(msg) && (QUESTIONY.test(msg) || msg.split(/\s+/).length <= 3)) {
      const pp = ctx.data.patients.find((p) => p.id === target.id)!;
      return { reply: { kind: "fileQuestion", patientId: target.id, topic: "attorney", question: msg, say: `${target.fullName}: attorney ${pp.attorney || "not on file"}; case status ${pp.caseStatus}.` }, state: remember(target.id, raw) };
    }
    if (QUESTIONY.test(msg) || FILE_TOPIC.test(msg)) return { reply: { kind: "fileQuestion", patientId: target.id, topic: "other", question: msg, say: `Checking ${target.fullName}'s file.` }, state: remember(target.id, raw) };
    // A statement naming a patient that matched nothing above: ask, don't search the file.
    const leftover = ref.nameText ? msg.replace(new RegExp(`\\b${ref.nameText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "").replace(/^[\s,:-]+|[\s,:-]+$/g, "") : msg;
    const c = clarifyForPatient(target.fullName, leftover);
    return { reply: { kind: "clarify", patientId: target.id, say: c.text }, state: { ...remember(target.id, raw), pendingNote: leftover ? null : st.pendingNote } };
  }
  return { reply: { kind: "help", say: "I can check the schedule, to-dos, cases and contacts, add notes, message the team, book visits and look up bills. What do you need?" }, state: st };
}

function escapeRe(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceName(action: string, from: string, to: string): string {
  const parts = from.split(/\s+/);
  let out = action;
  const full = new RegExp(`\\b${from}\\b`, "i");
  if (full.test(out)) return out.replace(full, to);
  for (const w of parts) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(out)) return out.replace(re, to);
  }
  out = out.replace(PRONOUN, to);
  return out;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

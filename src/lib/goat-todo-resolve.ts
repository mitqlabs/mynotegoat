import { parseTodo } from "@/lib/goat-briefs";
import { findPatientsInQuestion, stripPatientName, type ChatPatient } from "@/lib/goat-ai/global-chat";
import { isNoPatientName, tidyTodoTitle } from "@/lib/goat-intents";
import { matchPatientsByName } from "@/lib/goat-notes";
import { activeFirst, isActiveCase } from "@/lib/patient-name-match";

/**
 * "/todo …" when no leading name started the step-by-step flow: what the confirm card should say.
 *
 *  - The task text is kept in full ("call tyler smith" → "Call Tyler Smith"). The patient's name is
 *    only taken out when it was an "for / re / about <name>" tail, since the Patient line carries it.
 *  - A patient named in the text is the patient. Several matches → ask which. None → a to-do with
 *    no patient (never a different patient).
 */
export type SlashTodoPlan =
  | { kind: "needText" }
  | { kind: "card"; title: string; due: string; patient: ChatPatient | null; /** Tap-to-attach options when a first name alone matched. */ attach?: ChatPatient[]; attachText?: string }
  | { kind: "ask"; name: string; shown: ChatPatient[]; hidden: ChatPatient[]; chipText: string }
  | { kind: "notFound"; name: string };

export function resolveSlashTodo(rest: string, today: string, patients: ChatPatient[]): SlashTodoPlan {
  const t = parseTodo(rest, today);
  if (!t.title) return { kind: "needText" };
  const noPatient = isNoPatientName(t.name);

  if (t.name && !noPatient) {
    const all = matchPatientsByName(t.name, patients);
    if (!all.length) return { kind: "notFound", name: t.name };
    if (all.length > 1) {
      const split = activeFirst(all, (p) => isActiveCase(p.caseStatus));
      return { kind: "ask", name: t.name, shown: split.shown, hidden: split.hidden, chipText: rest.replace(/^[^:]*:\s*/, "") };
    }
    return { kind: "card", title: tidyTodoTitle(t.title, all[0].fullName), due: t.due, patient: all[0] };
  }
  if (noPatient) return { kind: "card", title: tidyTodoTitle(t.title), due: t.due, patient: null };

  const found = findPatientsInQuestion(t.title, patients);
  if (found.confident) {
    const p = found.confident.patient;
    const stripped = (stripPatientName(t.title, p.fullName) || t.title).replace(/\s+(for|re|about|on)\s*$/i, "").trim();
    // Only drop the name from a "for <name>" tail; "call Tyler Smith" keeps its object.
    const tail = /\b(?:for|re|about|regarding|on)\s+\S/i.test(t.title) && stripped.split(/\s+/).length >= 2;
    return { kind: "card", title: tidyTodoTitle(tail ? stripped : t.title, p.fullName), due: t.due, patient: p };
  }
  if (found.candidates.length) {
    const typedFull = found.candidates.some((c) => c.words.length >= 2);
    if (typedFull) {
      return { kind: "ask", name: found.named ?? found.candidates[0].words.join(" "), shown: found.candidates.map((c) => c.patient), hidden: found.inactive.map((c) => c.patient), chipText: rest };
    }
    // A first name alone ("call Vahe …") never forces a question: general to-do, linking is optional.
    return { kind: "card", title: tidyTodoTitle(t.title), due: t.due, patient: null, attach: found.candidates.slice(0, 4).map((c) => c.patient), attachText: rest };
  }
  return { kind: "card", title: tidyTodoTitle(t.title), due: t.due, patient: null };
}

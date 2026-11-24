/**
 * G.O.A.T. — Compliance and patient notes (rules only, pure: no storage, no network, no AI).
 *
 *   "set compliance for Mock Smith to Yes"      → ONE confirm card (old → new). Nothing saved here.
 *   "mark Mock Smith non-compliant"             → same
 *   "how many patients are non-compliant"       → count + names + link to Patient List
 *   "compliance breakdown" / "who has no compliance set"
 *   "what notes does Mock Smith have"           → newest notes (date, author) + Earlier notes
 *
 * The caller passes in what it already loaded (patients, the office's Compliance options, the
 * Compliance column switch, the person's edit access, notes), so this file only decides the
 * reply. It never guesses: two matching patients → it asks; column off → it says how to turn it on.
 */
import { displayName, type ChatPatient } from "@/lib/goat-ai/global-chat";
import { findNameAnywhere } from "@/lib/goat-commands";
import { HOWTO_QUESTION } from "@/lib/goat-howto";
import { isActiveCase } from "@/lib/patient-name-match";
import { COMPLIANCE_NOT_SET_LABEL, liveComplianceOptions, resolveComplianceOption, type ComplianceOption } from "@/lib/compliance";
import { formatEntryDate, type CaseNoteEntry } from "@/lib/case-note-entries";
import type { QuickPlan } from "@/lib/goat-quick";

export interface ComplianceCtx {
  patients: Array<ChatPatient & { compliance?: string }>;
  /** Every option, including removed ones (resolveComplianceOption ignores the removed). */
  options: ComplianceOption[];
  /** Settings → Office → Case Status Categories → "Compliance column". */
  enabled: boolean;
  /** The signed-in person may edit patients. */
  canEdit: boolean;
  canViewPatients: boolean;
  notesFor: (patientId: string) => { entries: CaseNoteEntry[]; legacy: string };
}

export type ComplianceStep =
  | { kind: "plan"; plan: QuickPlan }
  | { kind: "say"; text: string; links?: Array<{ label: string; href: string }> };

const SETTINGS_LINK = { label: "Settings → Case Status Categories", href: "/settings?section=caseStatuses" };
const PATIENTS_LINK = { label: "Open Patient List", href: "/patients" };

/** Lowercase words only; hyphens and punctuation become spaces ("Non-Compliant?" → "non compliant"). */
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Everyday ways of saying a built-in option (only applied to the built-ins, by their id). */
const DEFAULT_ALIASES: Array<{ id: string; phrases: string[] }> = [
  { id: "Non-Compliant", phrases: ["non compliant", "noncompliant", "not compliant", "uncompliant", "non compliance", "not complying", "non complying"] },
  { id: "Yes", phrases: ["compliant", "complying", "compliance yes"] },
  { id: "DNS ATM", phrases: ["dns atm", "dns", "did not show at the moment"] },
  { id: "New Patient", phrases: ["new patient", "new pt"] },
];

interface Phrase { text: string; option: ComplianceOption; weak: boolean }

function phrasesFor(options: ComplianceOption[]): Phrase[] {
  const live = liveComplianceOptions(options);
  const out: Phrase[] = [];
  for (const o of live) {
    const label = norm(o.label);
    if (!label) continue;
    // "yes" / "no" alone are ordinary words: only count them when the question says "compliance yes".
    out.push({ text: label, option: o, weak: label === "yes" || label === "no" || label.length <= 2 });
    const aliases = DEFAULT_ALIASES.find((a) => a.id === o.id);
    for (const a of aliases?.phrases ?? []) out.push({ text: a, option: o, weak: false });
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

const wordsIn = (haystack: string, needle: string) => (` ${haystack} `).includes(` ${needle} `);

/** The option named anywhere in the question ("how many are non-compliant"). */
function optionAnywhere(q: string, options: ComplianceOption[]): ComplianceOption | null {
  for (const p of phrasesFor(options)) {
    if (p.weak) {
      if (new RegExp(`\\bcompliance\\s*(?:is|of|=|equals|set to|marked)?\\s*${p.text}\\b`).test(q)) return p.option;
      continue;
    }
    if (wordsIn(q, p.text)) return p.option;
  }
  return null;
}

/** The option the question ENDS with ("set compliance for Mock Smith to Yes"), and the rest of it. */
function optionAtEnd(q: string, options: ComplianceOption[]): { option: ComplianceOption; rest: string } | null {
  const words = q.replace(/\b(please|pls|thanks|thank you)\b\s*$/i, "").trim().split(" ").filter(Boolean);
  for (const p of phrasesFor(options)) {
    const n = p.text.split(" ").length;
    if (words.length <= n) continue;
    if (words.slice(-n).join(" ") === p.text) return { option: p.option, rest: words.slice(0, -n).join(" ") };
  }
  return null;
}

const SET_VERB = /\b(set|change|update|mark|make|put|switch|flag|move|changed?)\b/;
const CLEAR_VERB = /\b(clear|remove|reset|unset|blank)\b/;
const COMPLIANCE_WORD = /\bcompl(?:iance|iant|ying)\b|\bnon compliant\b|\bnoncompliant\b|\bdns atm\b/;
const NOT_SET = /\b(no compliance|without (?:a )?compliance|compliance (?:is )?(?:not set|blank|empty|missing|unset)|not set|unset|never set|havent set|have not set)\b/;
const COUNT_INTENT = /\b(how many|how much|number of|count|total|who|whos|which|list|show|breakdown|break down|summary|overview|percent|percentage)\b/;
const NOTE_ACTION = /\b(add|write|log|save|put|enter|type|leave|append|create|make|record|jot|edit|delete|remove)\b/;

function patientAndRest(rest: string, patients: ComplianceCtx["patients"]) {
  const withActive = patients.map((p) => ({ ...p, active: isActiveCase(p.caseStatus) }));
  return findNameAnywhere(rest, withActive);
}

function askWhich(matches: Array<ChatPatient>, verb: string): ComplianceStep {
  const list = matches.slice(0, 6).map((p) => {
    const bits = [displayName(p.fullName), p.dob ? `DOB ${formatEntryDate(p.dob)}` : ""].filter(Boolean);
    return `• ${bits.join(" · ")}`;
  });
  return { kind: "say", text: `More than one patient matches. Which one do you mean?\n${list.join("\n")}\nSay the full first and last name and I'll ${verb}.` };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Returns null when the question isn't about compliance or a patient's notes (the normal pipeline handles it). */
export function understandCompliance(question: string, ctx: ComplianceCtx): ComplianceStep | null {
  const raw = question.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("@")) return null;
  // "how do I set compliance" is a how-to (the Handbook answers it); "add a note … : …" is the /note flow.
  if (HOWTO_QUESTION.test(raw) || /\b(add|write|log|save|leave|append|jot)\s+(a\s+|the\s+)?notes?\b/i.test(raw)) return null;
  const q = norm(raw);
  const optionsLive = liveComplianceOptions(ctx.options);
  const hasComplianceWord = COMPLIANCE_WORD.test(q);

  // ── What notes does X have? (a question — adding a note is /note or "add a note for…") ──
  if (/\bnotes?\b/.test(q) && /\b(what|whats|which|show|read|see|view|open|pull up|list|any|check|display)\b/.test(q) && !NOTE_ACTION.test(q) && !raw.includes(":") && !hasComplianceWord) {
    const hit = patientAndRest(q.replace(/\b(notes?|what|whats|which|show|read|see|view|open|pull up|list|any|check|display|does|do|has|have|me|the|for|on|of|in|about|with|written|there)\b/g, " "), ctx.patients);
    if (!hit) return null;
    if (!ctx.canViewPatients) return { kind: "say", text: "Your role doesn't have access to patient files, so I can't read their notes." };
    if (hit.matches.length > 1) return askWhich(hit.matches, "pull up their notes");
    const p = hit.matches[0];
    const { entries, legacy } = ctx.notesFor(p.id);
    const live = entries.filter((e) => !e.deleted).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    const old = legacy.trim();
    const link = [{ label: `Open ${displayName(p.fullName)}`, href: `/patients/${p.id}` }];
    if (!live.length && !old) return { kind: "say", text: `${displayName(p.fullName)} has no notes yet. To add one, type /note.`, links: link };
    const shown = live.slice(0, 8).map((e) => `• ${formatEntryDate(e.date)}${e.author ? ` · ${e.author}` : ""}: ${clip(e.text.replace(/\s*\n\s*/g, " ").trim(), 220)}`);
    const more = live.length > shown.length ? `\n…and ${live.length - shown.length} older note${live.length - shown.length === 1 ? "" : "s"} on the patient's Notes panel.` : "";
    const earlier = old ? `\n\nEarlier notes: ${clip(old.replace(/\s*\n\s*/g, " "), 300)}` : "";
    return { kind: "say", text: `${displayName(p.fullName)} — ${live.length} note${live.length === 1 ? "" : "s"}${old ? " plus Earlier notes" : ""}, newest first:\n${shown.join("\n")}${more}${earlier}`, links: link };
  }

  if (!hasComplianceWord) return null;

  // ── Clear: "clear compliance for Mock Smith" ──
  if (CLEAR_VERB.test(q) && /\bcompliance\b/.test(q)) {
    const hit = patientAndRest(q.replace(/\b(clear|remove|reset|unset|blank|compliance|for|on|of|the|from|status)\b/g, " "), ctx.patients);
    return buildSet(hit, null, ctx, "clear");
  }

  const tail = optionAtEnd(q, ctx.options);
  const wantsSet = SET_VERB.test(q) && !COUNT_INTENT.test(q.replace(/\bmake sure\b/, "")) && (tail || /\bcompliance\b/.test(q));

  // ── Set: "set compliance for X to Yes", "mark X non-compliant", "update X's compliance to DNS ATM" ──
  if (wantsSet) {
    if (!tail) {
      // "set compliance for X to maybe": an option we don't have.
      const opts = optionsLive.map((o) => o.label).join(", ");
      const named = /\bto\b|\bas\b/.test(q);
      if (named) return { kind: "say", text: `I don't have that Compliance option. Your options: ${opts}. Say "set compliance for <patient> to <option>".` };
      return { kind: "say", text: `Which Compliance value? Your options: ${opts}. Say "set compliance for <patient> to <option>".` };
    }
    const hit = patientAndRest(tail.rest.replace(/\b(set|change|update|mark|make|put|switch|flag|move|changed|compliance|compliant|status|for|on|of|the|to|as|is|please)\b/g, " "), ctx.patients);
    return buildSet(hit, tail.option, ctx, "set");
  }

  // ── Count / list / breakdown ──
  if (COUNT_INTENT.test(q) || NOT_SET.test(q)) {
    if (!ctx.canViewPatients) return { kind: "say", text: "Your role doesn't have access to the patient list, so I can't count compliance." };
    if (!ctx.enabled) return offSay();
    const notSet = NOT_SET.test(q);
    const option = notSet ? null : optionAnywhere(q, ctx.options);
    const nameHit = !notSet && !option && !/\b(patients|everyone|all|office|total|breakdown|break down|summary|overview)\b/.test(q) ? patientAndRest(q, ctx.patients) : null;
    if (nameHit && nameHit.matches.length === 1) return singleSay(nameHit.matches[0], ctx);
    const rows = ctx.patients.map((p) => ({ p, opt: resolveComplianceOption(p.compliance, ctx.options) }));
    const activeNote = (n: number, a: number) => (n === 0 ? "" : a === n ? " (all with an active case)" : ` (${a} with an active case)`);
    if (notSet || option) {
      const picked = rows.filter((r) => (notSet ? !r.opt : r.opt?.id === option!.id));
      const label = notSet ? COMPLIANCE_NOT_SET_LABEL : option!.label;
      const active = picked.filter((r) => isActiveCase(r.p.caseStatus)).length;
      if (!picked.length) return { kind: "say", text: notSet ? "Every patient has a Compliance value set." : `No patients are marked ${label}.`, links: [PATIENTS_LINK] };
      const names = picked.slice(0, 12).map((r) => displayName(r.p.fullName));
      const more = picked.length > names.length ? `, and ${picked.length - names.length} more` : "";
      return {
        kind: "say",
        text: `${picked.length} patient${picked.length === 1 ? " is" : "s are"} ${notSet ? "without a Compliance value" : `marked ${label}`}${activeNote(picked.length, active)}: ${names.join(", ")}${more}.`,
        links: [PATIENTS_LINK],
      };
    }
    // Breakdown of every option.
    const lines = optionsLive.map((o) => `• ${o.label}: ${rows.filter((r) => r.opt?.id === o.id).length}`);
    lines.push(`• ${COMPLIANCE_NOT_SET_LABEL}: ${rows.filter((r) => !r.opt).length}`);
    return { kind: "say", text: `Compliance across ${rows.length} patients:\n${lines.join("\n")}`, links: [PATIENTS_LINK] };
  }

  // ── "What's Mock Smith's compliance?" / "is Mock Smith compliant" ──
  if (/\b(what|whats|is|check|status|show)\b/.test(q)) {
    const hit = patientAndRest(q.replace(/\b(what|whats|is|check|status|show|compliance|compliant|the|s|for|of|on|are|their|his|her)\b/g, " "), ctx.patients);
    if (hit) {
      if (!ctx.canViewPatients) return { kind: "say", text: "Your role doesn't have access to patient files." };
      if (!ctx.enabled) return offSay();
      if (hit.matches.length > 1) return askWhich(hit.matches, "look it up");
      return singleSay(hit.matches[0], ctx);
    }
  }
  return null;
}

function offSay(): ComplianceStep {
  return { kind: "say", text: "The Compliance column is turned off for your office. An admin can turn it on: Settings → Office → Case Status Categories → Compliance column.", links: [SETTINGS_LINK] };
}

function singleSay(p: ChatPatient & { compliance?: string }, ctx: ComplianceCtx): ComplianceStep {
  const opt = resolveComplianceOption(p.compliance, ctx.options);
  return { kind: "say", text: opt ? `${displayName(p.fullName)}'s compliance is ${opt.label}.` : `${displayName(p.fullName)} has no Compliance value set.`, links: [{ label: `Open ${displayName(p.fullName)}`, href: `/patients/${p.id}` }] };
}

function buildSet(
  hit: ReturnType<typeof patientAndRest>,
  option: ComplianceOption | null,
  ctx: ComplianceCtx,
  mode: "set" | "clear",
): ComplianceStep {
  if (!ctx.enabled) return offSay();
  if (!ctx.canEdit) return { kind: "say", text: "Your role can't edit patients, so I can't change Compliance. An admin can give you edit access to Patients." };
  if (!hit) return { kind: "say", text: `Which patient? Say "set compliance for <patient> to <option>".` };
  if (hit.matches.length > 1) return askWhich(hit.matches, mode === "clear" ? "clear it" : "set it");
  const p = hit.matches[0];
  const patient = ctx.patients.find((x) => x.id === p.id)!;
  const was = resolveComplianceOption(patient.compliance, ctx.options);
  const name = displayName(p.fullName);
  if (mode === "clear") {
    if (!was) return { kind: "say", text: `${name} already has no Compliance value.` };
    return { kind: "plan", plan: { kind: "compliance", patientId: p.id, patientName: p.fullName, compliance: "", summary: `Clear ${name}'s compliance? (was ${was.label})` } };
  }
  if (!option) return { kind: "say", text: "Which Compliance value?" };
  if (!option.show && !was) return { kind: "say", text: `"${option.label}" is hidden in Compliance Categories, so I won't offer it. Turn its Show box on in Settings → Case Status Categories first.`, links: [SETTINGS_LINK] };
  if (was?.id === option.id) return { kind: "say", text: `${name}'s compliance is already ${option.label}.` };
  return {
    kind: "plan",
    plan: { kind: "compliance", patientId: p.id, patientName: p.fullName, compliance: option.id, summary: `Set ${name}'s compliance to ${option.label}?${was ? ` (was ${was.label})` : " (was not set)"}` },
  };
}

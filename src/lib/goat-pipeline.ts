/**
 * G.O.A.T. case-pipeline lists (admins): who needs an MRI referral, who's
 * waiting on MRI results / reports, ready to submit, submitted (checks
 * waiting), missing pieces. Rules only.
 *
 * Definitions are NOT new — they come from the app:
 *  - Needs MRI / MRI results / waiting for report: Case Flow rows from
 *    buildFollowUpItems with the office's Case Flow settings
 *    (lib/case-flow-options). Needs MRI = "MRI / CT" · "Needs Referral";
 *    MRI results = "MRI / CT" · "Report Not Received"; waiting for report =
 *    X-Ray "Waiting for Report" + MRI/CT and Specialist "Report Not Received".
 *    Cleared ("Clear task") rows are already left out by buildFollowUpItems.
 *  - Ready to submit / Submitted: the case status ("Ready To Submit",
 *    "Submitted" = billed, waiting for the check — same as Quick Biz).
 *    Days waiting = since the R&B Sent date.
 *  - Missing pieces: open (not closed, not cash) cases with no attorney,
 *    no date of injury, or no Initial Exam date.
 */
import type { FollowUpItem } from "@/lib/follow-up-queue";
import type { BriefTodoRow } from "@/lib/goat-briefs";

export type PipelineKind = "needsMri" | "mriResults" | "waitingReport" | "readyToSubmit" | "submitted" | "missing" | "overview";

export interface PipelinePatient {
  id: string;
  fullName: string;
  caseStatus: string;
  attorney?: string;
  dateOfLoss?: string;
  /** Initial Exam date as the patient page shows it (any format). */
  initialExam?: string;
  /** R&B Sent (submitted) date, MM/DD/YYYY or YYYY-MM-DD. */
  rbSent?: string;
  /** Discharge date, any format. */
  discharge?: string;
  cash?: boolean;
}

export interface PipelineData {
  today: string; // YYYY-MM-DD
  patients: PipelinePatient[];
  /** Case Flow rows (cleared ones already removed). */
  items: FollowUpItem[];
  closedStatuses: string[];
}

export interface PipelineAnswer {
  title: string;
  text: string;
  rows: BriefTodoRow[];
  textAfter?: string;
  choices: Array<{ label: string; question: string }>;
}

export const PIPELINE_LABEL: Record<PipelineKind, string> = {
  needsMri: "Needs MRI referral",
  mriResults: "Waiting on MRI results",
  waitingReport: "Waiting for reports",
  readyToSubmit: "Ready to submit",
  submitted: "Submitted (checks waiting)",
  missing: "Missing pieces",
  overview: "Case pipeline",
};

/** The follow-up chips after each list (the next step in the pipeline). */
const NEXT: Record<PipelineKind, PipelineKind[]> = {
  needsMri: ["mriResults", "waitingReport"],
  mriResults: ["waitingReport", "readyToSubmit"],
  waitingReport: ["readyToSubmit", "missing"],
  readyToSubmit: ["submitted", "waitingReport"],
  submitted: ["readyToSubmit", "missing"],
  missing: ["needsMri", "readyToSubmit"],
  overview: ["needsMri", "readyToSubmit"],
};
export const PIPELINE_CHIP: Record<PipelineKind, string> = {
  needsMri: "Who needs an MRI?",
  mriResults: "Waiting on MRI results?",
  waitingReport: "Waiting for reports?",
  readyToSubmit: "Ready to submit?",
  submitted: "Waiting for checks?",
  missing: "Missing pieces?",
  overview: "Case Pipeline",
};

/**
 * Office-wide pipeline question → which list. Needs a "who / which / list /
 * cases …" cue (or a pipeline phrase on its own) so a single patient's
 * question ("does kara need an mri") stays a patient question.
 */
export function detectPipeline(question: string): PipelineKind | null {
  const q = question.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  if (!q) return null;
  const chip = (Object.keys(PIPELINE_CHIP) as PipelineKind[]).find((k) => PIPELINE_CHIP[k].toLowerCase().replace(/[?']/g, "") === q);
  if (chip) return chip;
  if (/^(show )?(the |our )?case pipeline$|^pipeline$/.test(q)) return "overview";
  const office = /\b(who|whos|which|what|whats|list|show|cases|patients|anyone|everyone|everybody|how many|all)\b/.test(q);
  const bare = (re: RegExp) => new RegExp(`^(${re.source})$`).test(q);
  const mri = /\b(mri|mris|ct|imaging)\b/.test(q);
  if (mri && /\b(results?|reports?|back|waiting|pending|outstanding|not received)\b/.test(q) && (office || /^waiting (on|for) (the )?mri/.test(q))) return "mriResults";
  if (mri && /\b(need|needs|needing|referr\w*|order)\b/.test(q) && office) return "needsMri";
  if (/\bready to (submit|bill)\b/.test(q) && (office || bare(/ready to (submit|bill)/))) return "readyToSubmit";
  if (/\bwaiting (for|on) (the |our )?(checks?|payments?|money)\b|\bchecks? (waiting|pending|outstanding|out)\b/.test(q)) return "submitted";
  if (/\bsubmitted\b/.test(q) && office) return "submitted";
  if (/\b(waiting (for|on)|pending|outstanding|missing|not received)\b.*\b(narrative |specialist |x-?ray |xray )?reports?\b|\breports? (are |is )?(not received|outstanding|pending|missing)\b/.test(q) && (office || /^waiting (for|on)/.test(q))) return "waitingReport";
  if (/\bmissing (info|information|pieces|data|details|attorneys?|dol|date of (loss|injury)|initial exams?)\b|\b(no|without an?) (attorney|dol|date of (loss|injury)|initial exam)\b|\bincomplete (cases|files|charts)\b/.test(q) && office) return "missing";
  return null;
}

function toIso(d: string | undefined): string {
  const t = (d ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}
const daysBetween = (fromIso: string, toIsoDate: string) => Math.round((Date.parse(`${toIsoDate}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const patientHref = (id: string) => `/patients/${encodeURIComponent(id)}`;
const row = (id: string, name: string, after: string, key = id): BriefTodoRow => ({ id: key, href: patientHref(id), before: "", patientName: name, patientHref: patientHref(id), after });
const waited = (n: number | null) => (n === null ? "" : ` · ${n} day${n === 1 ? "" : "s"}`);

function flowList(d: PipelineData, pick: (i: FollowUpItem) => boolean, withCategory: boolean): BriefTodoRow[] {
  return d.items
    .filter(pick)
    .sort((a, b) => (b.daysFromAnchor ?? -1) - (a.daysFromAnchor ?? -1) || a.patientName.localeCompare(b.patientName))
    .map((i) => row(i.patientId, i.patientName, `${withCategory ? ` · ${i.category === "MRI / CT" ? "MRI/CT" : i.category}` : ""}${i.stage && withCategory ? ` (${i.stage.toLowerCase()})` : ""}${waited(i.daysFromAnchor)}`, i.id));
}

const isOpenCase = (p: PipelinePatient, closed: Set<string>) => !p.cash && !closed.has(p.caseStatus.trim().toLowerCase());

export function pipelineRows(kind: Exclude<PipelineKind, "overview">, d: PipelineData): BriefTodoRow[] {
  switch (kind) {
    case "needsMri":
      return flowList(d, (i) => i.category === "MRI / CT" && i.stage === "Needs Referral", false);
    case "mriResults":
      return flowList(d, (i) => i.category === "MRI / CT" && i.stage === "Report Not Received", false);
    case "waitingReport":
      return flowList(d, (i) => (i.category === "X-Ray" && i.stage === "Waiting for Report") || ((i.category === "MRI / CT" || i.category === "Specialist") && i.stage === "Report Not Received"), true);
    case "readyToSubmit":
    case "submitted": {
      const status = kind === "submitted" ? "Submitted" : "Ready To Submit";
      const since = (p: PipelinePatient) => toIso(kind === "submitted" ? p.rbSent : p.discharge);
      return d.patients
        .filter((p) => p.caseStatus === status && !p.cash)
        .map((p) => ({ p, iso: since(p) }))
        .sort((a, b) => (a.iso || "9999").localeCompare(b.iso || "9999") || a.p.fullName.localeCompare(b.p.fullName))
        .map(({ p, iso }) => row(p.id, p.fullName, iso ? ` · ${kind === "submitted" ? "sent" : "discharged"} ${us(iso)}${waited(daysBetween(iso, d.today))}` : kind === "submitted" ? " · no R&B Sent date" : ""));
    }
    case "missing": {
      const closed = new Set(d.closedStatuses.map((s) => s.trim().toLowerCase()));
      return d.patients
        .filter((p) => isOpenCase(p, closed))
        .map((p) => ({ p, gaps: [!p.attorney?.trim() && "no attorney", !p.dateOfLoss?.trim() && "no date of injury", !p.initialExam?.trim() && "no initial exam"].filter(Boolean) as string[] }))
        .filter((x) => x.gaps.length)
        .sort((a, b) => b.gaps.length - a.gaps.length || a.p.fullName.localeCompare(b.p.fullName))
        .map(({ p, gaps }) => row(p.id, p.fullName, ` · ${gaps.join(", ")}`));
    }
  }
}

const HOW: Record<Exclude<PipelineKind, "overview">, string> = {
  needsMri: "Case Flow MRI/CT rows at Needs Referral, longest waiting first.",
  mriResults: "Case Flow MRI/CT rows at Report Not Received, longest waiting first.",
  waitingReport: "Case Flow X-Ray, MRI/CT and Specialist report rows, longest waiting first. Narrative reports aren't tracked as a step in NoteGoat.",
  readyToSubmit: "Case status Ready To Submit, earliest discharge first.",
  submitted: "Case status Submitted (billed, waiting for the check), oldest R&B Sent first.",
  missing: "Open cases with no attorney, date of injury or Initial Exam date.",
};

const chipsFor = (kind: PipelineKind) => NEXT[kind].map((k) => ({ label: PIPELINE_CHIP[k], question: PIPELINE_CHIP[k] }));

export function pipelineAnswer(kind: PipelineKind, d: PipelineData): PipelineAnswer {
  if (kind === "overview") {
    const kinds: Array<Exclude<PipelineKind, "overview">> = ["needsMri", "mriResults", "waitingReport", "readyToSubmit", "submitted", "missing"];
    return {
      title: PIPELINE_LABEL.overview,
      text: `Case pipeline:\n${kinds.map((k) => `- ${PIPELINE_LABEL[k]}: ${pipelineRows(k, d).length}`).join("\n")}`,
      rows: [],
      choices: chipsFor("overview").concat([{ label: PIPELINE_CHIP.submitted, question: PIPELINE_CHIP.submitted }]),
    };
  }
  const rows = pipelineRows(kind, d);
  const shown = rows.slice(0, 25);
  return {
    title: PIPELINE_LABEL[kind],
    text: rows.length ? `${PIPELINE_LABEL[kind]} (${rows.length}):` : `${PIPELINE_LABEL[kind]}: none right now. 🎉`,
    rows: shown,
    textAfter: `${rows.length > shown.length ? `- …and ${rows.length - shown.length} more (Patient List → Case Flow)\n` : ""}(${HOW[kind]})`,
    choices: chipsFor(kind),
  };
}

// ---- Case Review ---------------------------------------------------------
// Straight from Case Flow: every open Case Flow row (whatever categories the
// office tracks — Initial Visit, X-Ray, MRI/CT, Specialist, Lien/LOP), with
// cleared ("Clear task") rows already left out by buildFollowUpItems.

export type ReviewAsk = { mode: "summary" } | { mode: "category"; category: string } | { mode: "patient"; name: string };

const CAT_LABEL: Record<string, string> = { "Initial Visit": "Initial visits", "X-Ray": "X-rays", "MRI / CT": "MRI/CT", Specialist: "Specialist", "Lien / LOP": "Lien/LOP" };
export const reviewChip = (category: string) => `Case review: ${CAT_LABEL[category] ?? category}`;
const catFromLabel = (t: string) => Object.keys(CAT_LABEL).find((k) => CAT_LABEL[k].toLowerCase() === t.toLowerCase() || k.toLowerCase() === t.toLowerCase()) ?? null;

export function detectReview(question: string): ReviewAsk | null {
  const q = question.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  const c = /^case review: (.+)$/.exec(q);
  if (c) { const cat = catFromLabel(c[1].trim()); return cat ? { mode: "category", category: cat } : null; }
  const p = /^(?:do a |run a |show )?case review (?:for|of|on) (.+)$|^what (?:does|do) (.+?) (?:still )?need$|^whats (?:still )?missing (?:for|on|in) (.+)$/.exec(q);
  if (p) return { mode: "patient", name: (p[1] ?? p[2] ?? p[3]).trim() };
  if (/^(do |run |show )?(a |the |our )?case reviews?( please| now)?$|^review (the |our )?cases$/.test(q)) return { mode: "summary" };
  if (/^(which|what) cases (are )?missing (key |important )?(info|information|things|stuff|steps)$|^whats (still )?missing$|^what are we missing$/.test(q)) return { mode: "summary" };
  return null;
}

const byUrgency = (a: FollowUpItem, b: FollowUpItem) => (b.daysFromAnchor ?? -1) - (a.daysFromAnchor ?? -1) || a.patientName.localeCompare(b.patientName);
const catOrder = (items: FollowUpItem[]) => [...new Set(items.map((i) => i.category))].sort((a, b) => Object.keys(CAT_LABEL).indexOf(a) - Object.keys(CAT_LABEL).indexOf(b));

export function caseReviewAnswer(ask: ReviewAsk, d: PipelineData, patient?: { id: string; fullName: string }): PipelineAnswer {
  if (ask.mode === "patient") {
    if (!patient) return { title: "Case review", text: `I couldn't find a patient named "${ask.name}".`, rows: [], choices: [{ label: "Case Review", question: "Case Review" }] };
    const mine = d.items.filter((i) => i.patientId === patient.id).sort(byUrgency);
    return {
      title: "Case review",
      text: mine.length ? `Case review — ${patient.fullName} still needs (${mine.length}):\n${mine.map((i) => `- ${CAT_LABEL[i.category] ?? i.category}: ${i.stage}${waited(i.daysFromAnchor)}`).join("\n")}` : `Case review — ${patient.fullName}: nothing open on Case Flow. 🎉`,
      rows: [row(patient.id, patient.fullName, " · open patient")],
      textAfter: "(From Case Flow; cleared tasks left out.)",
      choices: [{ label: "Case Review", question: "Case Review" }],
    };
  }
  if (ask.mode === "category") {
    const list = d.items.filter((i) => i.category === ask.category).sort(byUrgency);
    return {
      title: `Case review: ${CAT_LABEL[ask.category] ?? ask.category}`,
      text: list.length ? `${CAT_LABEL[ask.category] ?? ask.category} — ${new Set(list.map((i) => i.patientId)).size} case${list.length === 1 ? "" : "s"}, longest open first:` : `${CAT_LABEL[ask.category] ?? ask.category}: nothing open. 🎉`,
      rows: list.slice(0, 25).map((i) => row(i.patientId, i.patientName, ` · ${i.stage}${waited(i.daysFromAnchor)}`, i.id)),
      textAfter: list.length > 25 ? `- …and ${list.length - 25} more (Patient List → Case Flow)` : undefined,
      choices: catOrder(d.items).filter((c) => c !== ask.category).slice(0, 2).map((c) => ({ label: reviewChip(c), question: reviewChip(c) })),
    };
  }
  const cats = catOrder(d.items);
  const n = (c: string) => new Set(d.items.filter((i) => i.category === c).map((i) => i.patientId)).size;
  return {
    title: "Case review",
    text: cats.length ? `Case review — open Case Flow needs (${new Set(d.items.map((i) => i.patientId)).size} cases):\n${cats.map((c) => `- ${CAT_LABEL[c] ?? c}: ${n(c)} case${n(c) === 1 ? "" : "s"}`).join("\n")}\nTap one to see the patients, or ask "case review for <name>".` : "Case review: nothing open on Case Flow. 🎉",
    rows: [],
    textAfter: "(From Case Flow; cleared tasks left out.)",
    choices: cats.map((c) => ({ label: `${CAT_LABEL[c] ?? c}: ${n(c)}`, question: reviewChip(c) })),
  };
}

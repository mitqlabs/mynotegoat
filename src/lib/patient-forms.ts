/**
 * Patient questionnaire "Forms" (pure, no browser / network).
 *
 * A form template is a short list of SECTIONS, each pointing at one of the
 * practice's own Objective-section SOAP macros (by button name). When staff
 * send a form, `resolveForm` reads the CURRENT macro library and freezes a
 * snapshot of every question and option, so the patient answers with exactly
 * the option text staff click in the note. `answersToMacroFills` turns the
 * patient's answers back into macro answers (questionId → value), which the
 * encounter inserts through the same render path as a macro click.
 *
 * Mock/fictional data only in tests. Nothing here stores anything.
 */
import type { MacroAnswerMap, MacroQuestion, MacroTemplate } from "@/lib/macro-templates";

export const PATIENT_FORMS_STORAGE_KEY = "casemate.patient-forms.v1";

/** When a section is part of the form. */
export type FormIncludeWhen = "always" | "decompression" | "notDecompression";

export interface FormQuestionOverride {
  /** Hide this question from patients. */
  hidden?: boolean;
  /** Patient-facing wording (English). Empty = the macro's own label. */
  label?: string;
  /** Spanish wording (bilingual-ready). Empty = English shown. */
  labelEs?: string;
  /** Patient-facing wording per option, keyed by the exact macro option. */
  optionLabels?: Record<string, string>;
  optionLabelsEs?: Record<string, string>;
}

export interface FormSection {
  id: string;
  /** The Objective macro's button name, e.g. "MVC HX". Matched loosely (case, "&"/"and", plural). */
  macroName: string;
  /** Heading the patient sees. Empty = a friendly default for the macro. */
  title: string;
  titleEs?: string;
  enabled: boolean;
  includeWhen: FormIncludeWhen;
  /** Only these questions (by question id or label). Empty = all questions. */
  onlyQuestions?: string[];
  /** Per-question wording / hide, keyed by macro question id. */
  questions?: Record<string, FormQuestionOverride>;
}

export interface FormTemplate {
  id: string;
  name: string;
  /** Short note at the top of the patient page. */
  intro: string;
  introEs?: string;
  sections: FormSection[];
  /** Ships with the app (can be edited, not hard-deleted). */
  builtIn?: boolean;
  /** Tombstone so a merge from another computer can't bring it back. */
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Default "New Patient Questionnaire"
// ---------------------------------------------------------------------------

export const NEW_PATIENT_FORM_ID = "form-new-patient-questionnaire";
const EPOCH = "2026-10-19T00:00:00.000Z";

export function getDefaultPatientForms(): FormTemplate[] {
  const s = (id: string, macroName: string, title: string, titleEs: string, extra: Partial<FormSection> = {}): FormSection => ({
    id,
    macroName,
    title,
    titleEs,
    enabled: true,
    includeWhen: "always",
    ...extra,
  });
  return [
    {
      id: NEW_PATIENT_FORM_ID,
      name: "New Patient Questionnaire",
      intro: "Please answer a few questions before your first visit. It takes about 5 minutes. Your answers save as you go.",
      introEs: "Por favor conteste unas preguntas antes de su primera visita. Toma unos 5 minutos. Sus respuestas se guardan mientras avanza.",
      builtIn: true,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      sections: [
        s("mvc-hx", "MVC HX", "About the accident", "Sobre el accidente"),
        // Only for spinal decompression cases; questions it shares with MVC HX are asked once.
        s("mvc-hx-sd", "MVC HX SD", "Care after the accident", "Atención después del accidente", { includeWhen: "decompression" }),
        // Blood pressure / heart rate are taken in the office.
        s("vitals", "Vitals", "Height and weight", "Estatura y peso", { onlyQuestions: ["height", "weight"] }),
        s("medical-family-hx", "Medical & Family HX", "Your health history", "Su historial médico"),
        s("functional-limitations", "Functional Limitations", "Daily activities", "Actividades diarias"),
        s("chief-complaints", "Chief Complaints", "Where it hurts", "Dónde le duele"),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Normalize (cloud / localStorage values)
// ---------------------------------------------------------------------------

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const strMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string" && val.trim()) out[k] = val.slice(0, 500);
  return Object.keys(out).length ? out : undefined;
};

function normalizeOverride(v: unknown): FormQuestionOverride | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const o: FormQuestionOverride = {};
  if (r.hidden === true) o.hidden = true;
  if (str(r.label).trim()) o.label = str(r.label, 500);
  if (str(r.labelEs).trim()) o.labelEs = str(r.labelEs, 500);
  const ol = strMap(r.optionLabels);
  if (ol) o.optionLabels = ol;
  const oe = strMap(r.optionLabelsEs);
  if (oe) o.optionLabelsEs = oe;
  return o;
}

function normalizeSection(v: unknown): FormSection | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 120).trim();
  const macroName = str(r.macroName, 200).trim();
  if (!id || !macroName) return null;
  const includeWhen: FormIncludeWhen = r.includeWhen === "decompression" || r.includeWhen === "notDecompression" ? r.includeWhen : "always";
  const section: FormSection = { id, macroName, title: str(r.title, 200), enabled: r.enabled !== false, includeWhen };
  if (str(r.titleEs).trim()) section.titleEs = str(r.titleEs, 200);
  if (Array.isArray(r.onlyQuestions)) {
    const only = r.onlyQuestions.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    if (only.length) section.onlyQuestions = only;
  }
  if (r.questions && typeof r.questions === "object" && !Array.isArray(r.questions)) {
    const qs: Record<string, FormQuestionOverride> = {};
    for (const [k, val] of Object.entries(r.questions as Record<string, unknown>)) {
      const o = normalizeOverride(val);
      if (o && Object.keys(o).length) qs[k] = o;
    }
    if (Object.keys(qs).length) section.questions = qs;
  }
  return section;
}

export function normalizeFormTemplate(v: unknown): FormTemplate | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 120).trim();
  const name = str(r.name, 200).trim();
  if (!id || !name) return null;
  const sections = Array.isArray(r.sections) ? r.sections.map(normalizeSection).filter((x): x is FormSection => Boolean(x)) : [];
  const createdAt = str(r.createdAt, 40) || EPOCH;
  const t: FormTemplate = { id, name, intro: str(r.intro), sections, createdAt, updatedAt: str(r.updatedAt, 40) || createdAt };
  if (str(r.introEs).trim()) t.introEs = str(r.introEs);
  if (r.builtIn === true) t.builtIn = true;
  if (r.deleted === true) t.deleted = true;
  return t;
}

/** Stored list → templates. Built-in defaults are added when missing (never duplicated). */
export function normalizePatientForms(v: unknown): FormTemplate[] {
  const rows = Array.isArray(v) ? v.map(normalizeFormTemplate).filter((x): x is FormTemplate => Boolean(x)) : [];
  const seen = new Set<string>();
  const out: FormTemplate[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  for (const d of getDefaultPatientForms()) if (!seen.has(d.id)) out.unshift(d);
  return out;
}

export const liveForms = (forms: FormTemplate[]) => forms.filter((f) => !f.deleted);

// ---------------------------------------------------------------------------
// Macro matching + friendly wording
// ---------------------------------------------------------------------------

/** "Medical & Family HX" = "medical and family hx"; "Functional Limitations" = "Functional Limitation". */
export function macroNameKey(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bhistory\b/g, "hx")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/** The active Objective macro a section points at (exact key match). */
export function findSectionMacro(section: Pick<FormSection, "macroName">, macros: MacroTemplate[]): MacroTemplate | null {
  const key = macroNameKey(section.macroName);
  if (!key) return null;
  return macros.find((m) => m.section === "objective" && m.active && macroNameKey(m.buttonName) === key) ?? null;
}

const normLabel = (s: string) => s.toLowerCase().replace(/[?.:!,\s]+$/g, "").replace(/\s+/g, " ").trim();

/** Options that only make sense to staff (a blank to fill, or the "DELETE" reminder) are not shown to patients. */
export function isStaffOnlyOption(option: string): boolean {
  return /_{2,}/.test(option) || /^delete$/i.test(option.trim());
}

/**
 * Note wording → patient wording, for options without an owner override.
 * The VALUE saved is always the exact macro option; this is display only.
 *   "Patient denies any allergies." → "No"
 *   "Patient states they are employed and still working." → "I am employed and still working"
 *   "struck their head on the headrest" → "Struck my head on the headrest"
 */
export function friendlyOptionLabel(option: string, opts: { onlyOption?: boolean } = {}): string {
  let s = (option ?? "").trim();
  if (!s) return s;
  if (/^(patient )?denies\b/i.test(s)) {
    if (opts.onlyOption) return "No";
    const rest = s.replace(/^(patient )?denies\s+(having\s+|being\s+|taking\s+)?/i, "").replace(/[.,]+$/, "");
    return `No ${rest.replace(/^any\s+/i, "")}`;
  }
  s = s
    .replace(/^patient (states|reports|stated) (that )?they are\b/i, "I am")
    .replace(/^patient (states|reports|stated) (that )?they\b/i, "I")
    .replace(/^(states|reports) (that )?they are\b/i, "I am")
    .replace(/^(states|reports) (that )?they\b/i, "I")
    .replace(/\btheir\b/gi, "my")
    .replace(/\bthey are\b/gi, "I am")
    .replace(/\bthemselves\b/gi, "myself")
    .replace(/[.,;]+$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Snapshot (what is frozen into a sent link)
// ---------------------------------------------------------------------------

export type SnapshotKind = "single" | "multi" | "text";

export interface SnapshotOption {
  /** Exact macro option text (what gets saved and inserted). */
  value: string;
  label: string;
  labelEs?: string;
}

export interface SnapshotQuestion {
  /** Answer key on the patient page: `${sectionId}.${questionId}`. */
  key: string;
  macroQuestionId: string;
  label: string;
  labelEs?: string;
  kind: SnapshotKind;
  options: SnapshotOption[];
  /** A free-text "something else / explain" box (always on for choice questions). */
  allowOther: boolean;
  dateInput?: boolean;
  /** Same question in another included section (asked once, fills both). */
  alsoFills?: Array<{ sectionId: string; macroQuestionId: string }>;
}

export interface SnapshotSection {
  id: string;
  macroId: string;
  macroName: string;
  title: string;
  titleEs?: string;
  questions: SnapshotQuestion[];
}

export interface FormSnapshot {
  version: 1;
  formId: string;
  formName: string;
  intro: string;
  introEs?: string;
  decompression: boolean;
  sections: SnapshotSection[];
}

export interface ResolveResult {
  snapshot: FormSnapshot;
  /** Sections whose macro wasn't found in Objective (left out, shown to staff). */
  missing: string[];
}

function sectionIncluded(section: FormSection, decompression: boolean): boolean {
  if (!section.enabled) return false;
  if (section.includeWhen === "decompression") return decompression;
  if (section.includeWhen === "notDecompression") return !decompression;
  return true;
}

function questionPicked(section: FormSection, q: MacroQuestion): boolean {
  if (section.questions?.[q.id]?.hidden) return false;
  if (!section.onlyQuestions?.length) return true;
  const want = new Set(section.onlyQuestions.map((x) => normLabel(x)));
  return want.has(normLabel(q.id)) || want.has(normLabel(q.label));
}

const optionSetKey = (q: MacroQuestion) => [...(q.options ?? [])].map(normLabel).sort().join("|");

/** Freeze a form against the practice's current Objective macros. */
export function resolveForm(form: FormTemplate, macros: MacroTemplate[], ctx: { decompression: boolean }): ResolveResult {
  const missing: string[] = [];
  const sections: SnapshotSection[] = [];
  // macroQuestionId + option set → the snapshot question that already asks it.
  const asked = new Map<string, SnapshotQuestion>();
  for (const section of form.sections) {
    if (!sectionIncluded(section, ctx.decompression)) continue;
    const macro = findSectionMacro(section, macros);
    if (!macro) {
      missing.push(section.macroName);
      continue;
    }
    const questions: SnapshotQuestion[] = [];
    for (const q of macro.questions) {
      if (!questionPicked(section, q)) continue;
      const dupKey = `${q.id}::${optionSetKey(q)}::${q.multiSelect ? "m" : "s"}`;
      const prior = asked.get(dupKey);
      if (prior) {
        prior.alsoFills = [...(prior.alsoFills ?? []), { sectionId: section.id, macroQuestionId: q.id }];
        continue;
      }
      const o = section.questions?.[q.id] ?? {};
      const visible = (q.options ?? []).filter((opt) => !isStaffOnlyOption(opt));
      const kind: SnapshotKind = visible.length === 0 ? "text" : q.multiSelect ? "multi" : "single";
      const sq: SnapshotQuestion = {
        key: `${section.id}.${q.id}`,
        macroQuestionId: q.id,
        label: o.label?.trim() || q.label,
        kind,
        options: visible.map((value) => {
          const opt: SnapshotOption = { value, label: o.optionLabels?.[value]?.trim() || friendlyOptionLabel(value, { onlyOption: visible.length === 1 }) };
          const es = o.optionLabelsEs?.[value]?.trim();
          if (es) opt.labelEs = es;
          return opt;
        }),
        allowOther: kind !== "text",
      };
      if (o.labelEs?.trim()) sq.labelEs = o.labelEs.trim();
      if (q.dateInput) sq.dateInput = true;
      asked.set(dupKey, sq);
      questions.push(sq);
    }
    const out: SnapshotSection = { id: section.id, macroId: macro.id, macroName: macro.buttonName, title: section.title.trim() || macro.buttonName, questions };
    if (section.titleEs?.trim()) out.titleEs = section.titleEs.trim();
    // A section whose questions were all asked earlier still fills its macro (via alsoFills).
    sections.push(out);
  }
  return {
    snapshot: {
      version: 1,
      formId: form.id,
      formName: form.name,
      intro: form.intro,
      ...(form.introEs?.trim() ? { introEs: form.introEs.trim() } : {}),
      decompression: ctx.decompression,
      sections,
    },
    missing,
  };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One question's answer on the patient page. */
export interface PatientAnswer {
  /** Chosen option values (exact macro text). Single = at most one. */
  picks?: string[];
  /** Free text: the whole answer for text questions, "something else" otherwise. */
  other?: string;
}
export type PatientAnswers = Record<string, PatientAnswer>;

export const FORM_LIMITS = {
  sections: 30,
  questionsPerSection: 60,
  options: 80,
  labelChars: 500,
  otherChars: 1000,
  snapshotBytes: 200_000,
  answersBytes: 100_000,
} as const;

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, n) : "");

/** Server-side: keep only answers to questions in THIS snapshot, with known options. */
export function sanitizeAnswers(snapshot: FormSnapshot, raw: unknown): PatientAnswers {
  const out: PatientAnswers = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const section of snapshot.sections) {
    for (const q of section.questions) {
      const a = src[q.key];
      if (!a || typeof a !== "object" || Array.isArray(a)) continue;
      const r = a as Record<string, unknown>;
      const allowed = new Set(q.options.map((o) => o.value));
      let picks = Array.isArray(r.picks) ? r.picks.filter((p): p is string => typeof p === "string" && allowed.has(p)) : [];
      picks = [...new Set(picks)];
      if (q.kind === "single") picks = picks.slice(0, 1);
      if (q.kind === "text") picks = [];
      const other = q.kind === "text" || q.allowOther ? clip(r.other, FORM_LIMITS.otherChars).trim() : "";
      if (picks.length || other) out[q.key] = { ...(picks.length ? { picks } : {}), ...(other ? { other } : {}) };
    }
  }
  return out;
}

/** Server-side: is this a well-formed snapshot within limits? (Rejects anything else.) */
export function validateSnapshot(raw: unknown): FormSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    if (JSON.stringify(raw).length > FORM_LIMITS.snapshotBytes) return null;
  } catch {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.sections) || r.sections.length > FORM_LIMITS.sections) return null;
  const L = FORM_LIMITS.labelChars;
  const sections: SnapshotSection[] = [];
  const keys = new Set<string>();
  for (const s of r.sections as unknown[]) {
    if (!s || typeof s !== "object") return null;
    const sr = s as Record<string, unknown>;
    if (!Array.isArray(sr.questions) || sr.questions.length > FORM_LIMITS.questionsPerSection) return null;
    const id = clip(sr.id, 120);
    if (!id) return null;
    const questions: SnapshotQuestion[] = [];
    for (const q of sr.questions as unknown[]) {
      if (!q || typeof q !== "object") return null;
      const qr = q as Record<string, unknown>;
      const key = clip(qr.key, 300);
      const kind = qr.kind === "single" || qr.kind === "multi" || qr.kind === "text" ? qr.kind : null;
      if (!key || !kind || keys.has(key) || !Array.isArray(qr.options) || qr.options.length > FORM_LIMITS.options) return null;
      keys.add(key);
      const options: SnapshotOption[] = [];
      for (const o of qr.options as unknown[]) {
        if (!o || typeof o !== "object") return null;
        const or = o as Record<string, unknown>;
        const value = clip(or.value, L);
        if (!value) return null;
        options.push({ value, label: clip(or.label, L) || value, ...(clip(or.labelEs, L) ? { labelEs: clip(or.labelEs, L) } : {}) });
      }
      const alsoFills = Array.isArray(qr.alsoFills)
        ? (qr.alsoFills as unknown[])
            .map((x) => (x && typeof x === "object" ? { sectionId: clip((x as Record<string, unknown>).sectionId, 120), macroQuestionId: clip((x as Record<string, unknown>).macroQuestionId, 200) } : null))
            .filter((x): x is { sectionId: string; macroQuestionId: string } => Boolean(x && x.sectionId && x.macroQuestionId))
            .slice(0, 10)
        : [];
      questions.push({
        key,
        macroQuestionId: clip(qr.macroQuestionId, 200),
        label: clip(qr.label, L),
        ...(clip(qr.labelEs, L) ? { labelEs: clip(qr.labelEs, L) } : {}),
        kind,
        options,
        allowOther: qr.allowOther === true,
        ...(qr.dateInput === true ? { dateInput: true } : {}),
        ...(alsoFills.length ? { alsoFills } : {}),
      });
    }
    sections.push({
      id,
      macroId: clip(sr.macroId, 200),
      macroName: clip(sr.macroName, 200),
      title: clip(sr.title, 200),
      ...(clip(sr.titleEs, 200) ? { titleEs: clip(sr.titleEs, 200) } : {}),
      questions,
    });
  }
  return {
    version: 1,
    formId: clip(r.formId, 120),
    formName: clip(r.formName, 200) || "Questionnaire",
    intro: clip(r.intro, 2000),
    ...(clip(r.introEs, 2000) ? { introEs: clip(r.introEs, 2000) } : {}),
    decompression: r.decompression === true,
    sections,
  };
}

/** The patient's answer as one macro value (string or option list), or null if blank. */
function toMacroValue(q: SnapshotQuestion, a: PatientAnswer | undefined): string | string[] | null {
  if (!a) return null;
  const picks = (a.picks ?? []).filter(Boolean);
  const other = (a.other ?? "").trim();
  if (q.kind === "text") return other || null;
  if (q.kind === "multi") {
    const all = other ? [...picks, other] : picks;
    return all.length ? all : null;
  }
  // single: a pick, else their own words
  return picks[0] ?? (other || null);
}

export interface MacroFill {
  sectionId: string;
  macroId: string;
  macroName: string;
  answers: MacroAnswerMap;
}

/** Patient answers → one macro fill per section that has any answer. */
export function answersToMacroFills(snapshot: FormSnapshot, answers: PatientAnswers): MacroFill[] {
  const bySection = new Map<string, MacroFill>();
  for (const s of snapshot.sections) bySection.set(s.id, { sectionId: s.id, macroId: s.macroId, macroName: s.macroName, answers: {} });
  for (const s of snapshot.sections) {
    for (const q of s.questions) {
      const v = toMacroValue(q, answers[q.key]);
      if (v === null) continue;
      bySection.get(s.id)!.answers[q.macroQuestionId] = v;
      for (const extra of q.alsoFills ?? []) {
        const target = bySection.get(extra.sectionId);
        if (target) target.answers[extra.macroQuestionId] = v;
      }
    }
  }
  return [...bySection.values()].filter((f) => Object.keys(f.answers).length > 0);
}

/** Readable rows for the staff review card: section → question → answer text. */
export function answerSummary(snapshot: FormSnapshot, answers: PatientAnswers): Array<{ section: string; rows: Array<{ question: string; answer: string }> }> {
  return snapshot.sections
    .map((s) => ({
      section: s.title,
      rows: s.questions
        .map((q) => {
          const a = answers[q.key];
          const picks = (a?.picks ?? []).map((p) => q.options.find((o) => o.value === p)?.label ?? p);
          const other = (a?.other ?? "").trim();
          const parts = [...picks, ...(other ? [q.kind === "text" ? other : `"${other}"`] : [])];
          return { question: q.label, answer: parts.join("; ") };
        })
        .filter((r) => r.answer),
    }))
    .filter((s) => s.rows.length > 0);
}

/** Questions answered / total, for the progress bar. */
export function answeredCount(snapshot: FormSnapshot, answers: PatientAnswers): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const s of snapshot.sections)
    for (const q of s.questions) {
      total++;
      if (toMacroValue(q, answers[q.key]) !== null) answered++;
    }
  return { answered, total };
}

/** A decompression case? From the patient's appointment / visit types (or the send-time toggle). */
export function looksLikeDecompressionCase(types: string[]): boolean {
  return types.some((t) => /decompress/i.test(t ?? "") && !/\b(begin|start|recommend|consider|consult|discuss)\b/i.test(t ?? ""));
}

/** Plain-language link text for a text / email. No patient details beyond the first name. */
export function formMessage(firstName: string, formName: string, url: string, officeName: string): string {
  const hi = firstName.trim() ? `Hi ${firstName.trim()}` : "Hi";
  const from = officeName.trim() ? ` from ${officeName.trim()}` : "";
  return `${hi}, this is your ${formName}${from}. Please fill it out before your visit (about 5 minutes): ${url}`;
}

/** Status words staff see for a sent link. */
export type FormRequestStatus = "sent" | "started" | "submitted" | "revoked" | "expired";
export function displayStatus(row: { status: string; expires_at: string; revoked_at?: string | null }, now = Date.now()): FormRequestStatus {
  if (row.revoked_at || row.status === "revoked") return "revoked";
  if (row.status === "submitted") return "submitted";
  if (Date.parse(row.expires_at) <= now) return "expired";
  return row.status === "started" ? "started" : "sent";
}

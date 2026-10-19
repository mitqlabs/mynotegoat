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

/** A question the practice writes itself (not from a macro). */
export type CustomQuestionType = "short" | "long" | "yesno" | "single" | "multi" | "number";
export const CUSTOM_QUESTION_TYPES: Array<{ value: CustomQuestionType; label: string }> = [
  { value: "short", label: "Short answer" },
  { value: "long", label: "Long answer" },
  { value: "yesno", label: "Yes / No" },
  { value: "single", label: "Pick one" },
  { value: "multi", label: "Pick any" },
  { value: "number", label: "Number" },
];

export interface CustomQuestion {
  id: string;
  label: string;
  labelEs?: string;
  type: CustomQuestionType;
  /** Choices for "single" / "multi" (one per line in the builder). */
  options?: string[];
  /** Off = kept in the form but not asked. */
  enabled: boolean;
}

/** "macro" = one of the practice's Objective macros; "custom" = the practice's own questions. */
export type FormSectionKind = "macro" | "custom";

export interface FormSection {
  id: string;
  /** Missing = "macro" (forms saved before custom questions existed). */
  kind?: FormSectionKind;
  /** The Objective macro's button name, e.g. "MVC HX". Matched loosely (case, "&"/"and", plural). Empty for custom sections. */
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
  /** Custom sections: the practice's own questions, in order. */
  customQuestions?: CustomQuestion[];
}

export interface FormTemplate {
  id: string;
  name: string;
  /** Short note at the top of the patient page. */
  intro: string;
  introEs?: string;
  sections: FormSection[];
  /** Turned off: kept, but not offered in Send form. */
  disabled?: boolean;
  /** Legacy flag from the first preview (no form ships with the app any more). */
  builtIn?: boolean;
  /** Tombstone so a merge from another computer can't bring it back. */
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

const EPOCH = "2026-10-19T00:00:00.000Z";

// NOTE: no form ships with the app. Every practice starts with zero forms and
// builds its own (Settings -> Forms). An owner's existing questionnaire is a
// saved cloud form, seeded per workspace by scripts/seed/patient-forms-seed.mjs.

export function macroSection(id: string, macroName: string): FormSection {
  return { id, kind: "macro", macroName, title: macroName, enabled: true, includeWhen: "always" };
}

export function customSection(id: string, title = "More questions"): FormSection {
  return { id, kind: "custom", macroName: "", title, enabled: true, includeWhen: "always", customQuestions: [] };
}

export const isCustomSection = (s: Pick<FormSection, "kind">) => s.kind === "custom";

/** Builder helper: a new, empty form. */
export function blankForm(id: string, now: string): FormTemplate {
  return { id, name: "Untitled form", intro: "Please answer a few questions before your visit. Your answers save as you go.", sections: [], createdAt: now, updatedAt: now };
}

/** A copy with fresh ids everywhere (Duplicate), never sharing ids with the original. */
export function duplicateForm(f: FormTemplate, ids: { form: string; next: () => string }, now: string): FormTemplate {
  const copy = structuredClone(f);
  return {
    ...copy,
    id: ids.form,
    name: `${f.name} (copy)`,
    builtIn: undefined,
    deleted: undefined,
    createdAt: now,
    updatedAt: now,
    sections: copy.sections.map((s) => ({
      ...s,
      id: ids.next(),
      ...(s.customQuestions ? { customQuestions: s.customQuestions.map((q) => ({ ...q, id: ids.next() })) } : {}),
    })),
  };
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

const CUSTOM_TYPES = new Set<CustomQuestionType>(["short", "long", "yesno", "single", "multi", "number"]);

function normalizeCustomQuestion(v: unknown): CustomQuestion | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 120).trim();
  if (!id) return null;
  const type = CUSTOM_TYPES.has(r.type as CustomQuestionType) ? (r.type as CustomQuestionType) : "short";
  const q: CustomQuestion = { id, label: str(r.label, 500), type, enabled: r.enabled !== false };
  if (str(r.labelEs).trim()) q.labelEs = str(r.labelEs, 500);
  if (type === "single" || type === "multi") {
    q.options = Array.isArray(r.options)
      ? r.options.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 500)).slice(0, FORM_LIMITS.options)
      : [];
  }
  return q;
}

function normalizeSection(v: unknown): FormSection | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 120).trim();
  const kind: FormSectionKind = r.kind === "custom" ? "custom" : "macro";
  const macroName = kind === "custom" ? "" : str(r.macroName, 200).trim();
  if (!id || (kind === "macro" && !macroName)) return null;
  const includeWhen: FormIncludeWhen = r.includeWhen === "decompression" || r.includeWhen === "notDecompression" ? r.includeWhen : "always";
  const section: FormSection = { id, kind, macroName, title: str(r.title, 200), enabled: r.enabled !== false, includeWhen };
  if (kind === "custom") {
    section.customQuestions = Array.isArray(r.customQuestions)
      ? r.customQuestions.map(normalizeCustomQuestion).filter((x): x is CustomQuestion => Boolean(x)).slice(0, FORM_LIMITS.questionsPerSection)
      : [];
  }
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
  if (r.disabled === true) t.disabled = true;
  if (r.builtIn === true) t.builtIn = true;
  if (r.deleted === true) t.deleted = true;
  return t;
}

/** Stored list → templates (deduped by id). Nothing is ever added: an empty list stays empty. */
export function normalizePatientForms(v: unknown): FormTemplate[] {
  const rows = Array.isArray(v) ? v.map(normalizeFormTemplate).filter((x): x is FormTemplate => Boolean(x)) : [];
  const seen = new Set<string>();
  const out: FormTemplate[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export const liveForms = (forms: FormTemplate[]) => forms.filter((f) => !f.deleted);
/** Forms offered in Send form: not deleted, not turned off. */
export const sendableForms = (forms: FormTemplate[]) => liveForms(forms).filter((f) => !f.disabled);

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
export function findSectionMacro(section: Pick<FormSection, "macroName"> & { kind?: FormSectionKind }, macros: MacroTemplate[]): MacroTemplate | null {
  if (section.kind === "custom") return null;
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
export type SnapshotInput = "short" | "long" | "number";

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
  /** Text questions: the box to show. Missing = one-line answer. */
  input?: SnapshotInput;
  /** Same question in another included section (asked once, fills both). */
  alsoFills?: Array<{ sectionId: string; macroQuestionId: string }>;
}

export interface SnapshotSection {
  id: string;
  macroId: string;
  macroName: string;
  title: string;
  titleEs?: string;
  /** The practice's own questions: inserted as plain text, not through a macro. */
  custom?: boolean;
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

const YES_NO: SnapshotOption[] = [
  { value: "Yes", label: "Yes", labelEs: "Sí" },
  { value: "No", label: "No", labelEs: "No" },
];

function resolveCustomQuestions(section: FormSection): SnapshotQuestion[] {
  const out: SnapshotQuestion[] = [];
  for (const q of section.customQuestions ?? []) {
    const label = q.label.trim();
    if (!q.enabled || !label) continue;
    const base = { key: `${section.id}.${q.id}`, macroQuestionId: q.id, label, ...(q.labelEs?.trim() ? { labelEs: q.labelEs.trim() } : {}) };
    if (q.type === "yesno") {
      out.push({ ...base, kind: "single", options: YES_NO.map((o) => ({ ...o })), allowOther: false });
    } else if (q.type === "single" || q.type === "multi") {
      const opts = [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (!opts.length) continue; // a choice question with no choices isn't asked
      out.push({ ...base, kind: q.type, options: opts.map((value) => ({ value, label: value })), allowOther: false });
    } else {
      out.push({ ...base, kind: "text", options: [], allowOther: false, ...(q.type === "short" ? {} : { input: q.type }) });
    }
  }
  return out;
}

/** Freeze a form against the practice's current Objective macros. */
export function resolveForm(form: FormTemplate, macros: MacroTemplate[], ctx: { decompression: boolean }): ResolveResult {
  const missing: string[] = [];
  const sections: SnapshotSection[] = [];
  // macroQuestionId + option set → the snapshot question that already asks it.
  const asked = new Map<string, SnapshotQuestion>();
  for (const section of form.sections) {
    if (!sectionIncluded(section, ctx.decompression)) continue;
    if (isCustomSection(section)) {
      const questions = resolveCustomQuestions(section);
      if (!questions.length) continue;
      const out: SnapshotSection = { id: section.id, macroId: "", macroName: "", title: section.title.trim() || "More questions", custom: true, questions };
      if (section.titleEs?.trim()) out.titleEs = section.titleEs.trim();
      sections.push(out);
      continue;
    }
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
      let other = q.kind === "text" || q.allowOther ? clip(r.other, FORM_LIMITS.otherChars).trim() : "";
      if (q.input === "number" && !/^-?\d{0,9}([.,]\d{0,4})?$/.test(other)) other = "";
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
        ...(qr.input === "long" || qr.input === "number" || qr.input === "short" ? { input: qr.input as SnapshotInput } : {}),
        ...(alsoFills.length ? { alsoFills } : {}),
      });
    }
    sections.push({
      id,
      macroId: clip(sr.macroId, 200),
      macroName: clip(sr.macroName, 200),
      title: clip(sr.title, 200),
      ...(clip(sr.titleEs, 200) ? { titleEs: clip(sr.titleEs, 200) } : {}),
      ...(sr.custom === true ? { custom: true } : {}),
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
  const macroSections = snapshot.sections.filter((s) => !s.custom);
  for (const s of macroSections) bySection.set(s.id, { sectionId: s.id, macroId: s.macroId, macroName: s.macroName, answers: {} });
  for (const s of macroSections) {
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

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The practice's own (custom) questions -> plain HTML for Objective:
 * a bold section heading, then "Question: answer" lines. Blank answers are left out.
 */
export function customAnswersHtml(snapshot: FormSnapshot, answers: PatientAnswers): string {
  const blocks: string[] = [];
  for (const s of snapshot.sections) {
    if (!s.custom) continue;
    const lines: string[] = [];
    for (const q of s.questions) {
      const v = toMacroValue(q, answers[q.key]);
      if (v === null) continue;
      const text = Array.isArray(v) ? v.join(", ") : v;
      lines.push(`${escapeHtml(q.label)}: ${escapeHtml(text).replace(/\n/g, "<br>")}`);
    }
    if (lines.length) blocks.push(`<p><strong>${escapeHtml(s.title)}</strong><br>${lines.join("<br>")}</p>`);
  }
  return blocks.join("");
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

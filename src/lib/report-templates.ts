import { documentFontOptions } from "@/lib/document-templates";

export interface NarrativeReportPrompt {
  id: string;
  label: string;
  token: string;
  options: string[];
  required: boolean;
}

export interface NarrativeReportTemplate {
  id: string;
  name: string;
  body: string;
  fontFamily: string;
  active: boolean;
  prompts: NarrativeReportPrompt[];
}

export interface NarrativeReportLibrary {
  templates: NarrativeReportTemplate[];
}

export interface NarrativeReportAutoField {
  token: string;
  label: string;
}

const STORAGE_KEY = "casemate.report-templates.v1";

const defaultReportBody = `Narrative Report\n\nPatient: {{PATIENT_FULL_NAME}}\nDOB: {{PATIENT_DOB}}\nDate Of Injury: {{DATE_OF_INJURY}}\nCase #: {{CASE_NUMBER}}\nAttorney: {{ATTORNEY_NAME}}\n\nHistory of Injury:\n{{FIRST_OBJECTIVE}}\n\nClinical Progress (Objective):\n{{ALL_OBJECTIVE}}\n\nAssessment Overview:\n{{ALL_ASSESSMENT}}\n\nPlan Of Care:\n{{ALL_PLAN}}\n\nDiagnoses:\n{{DIAGNOSIS_LIST}}\n\nEncounter Charges:\n{{CHARGE_LEDGER}}\n\nImaging Summary:\n{{IMAGING_SUMMARY}}\n\nX-Ray Findings:\n{{XRAY_FINDINGS}}\n\nMRI / CT Findings:\n{{MRI_CT_FINDINGS}}\n\nSpecialist Summary:\n{{SPECIALIST_SUMMARY}}\n\nSpecialist Recommendations:\n{{SPECIALIST_RECOMMENDATIONS}}\n\nAdditional Notes:\n{{PATIENT_NOTES}}\n\nCustom Input:\n{{PROMPT_CUSTOM_NOTE}}`;

function defaultFontFamily() {
  return documentFontOptions[0]?.value ?? "Georgia, 'Times New Roman', serif";
}

function createDefaultTemplate(): NarrativeReportTemplate {
  return {
    id: "report-full-narrative",
    name: "Full Narrative Report",
    body: defaultReportBody,
    fontFamily: defaultFontFamily(),
    active: true,
    prompts: [
      {
        id: "prompt-custom-note",
        label: "Custom note",
        token: "PROMPT_CUSTOM_NOTE",
        options: [],
        required: false,
      },
    ],
  };
}

export const narrativeReportAutoFields: NarrativeReportAutoField[] = [
  { token: "TODAY_DATE", label: "Today Date" },
  { token: "OFFICE_NAME", label: "Office Name" },
  { token: "OFFICE_ADDRESS", label: "Office Address" },
  { token: "OFFICE_PHONE", label: "Office Phone" },
  { token: "OFFICE_FAX", label: "Office Fax" },
  { token: "OFFICE_EMAIL", label: "Office Email" },
  { token: "DOCTOR_NAME", label: "Doctor Name" },
  { token: "PATIENT_FULL_NAME", label: "Patient Full Name" },
  { token: "PATIENT_FIRST_NAME", label: "Patient First Name" },
  { token: "PATIENT_LAST_NAME", label: "Patient Last Name" },
  { token: "PATIENT_DOB", label: "Patient DOB" },
  { token: "PATIENT_PHONE", label: "Patient Phone" },
  { token: "PATIENT_EMAIL", label: "Patient Email" },
  { token: "MR_MRS_MS_LAST_NAME", label: "Mr./Mrs./Ms. Last Name" },
  { token: "HE_SHE", label: "He/She" },
  { token: "HIS_HER", label: "His/Her" },
  { token: "DATE_OF_INJURY", label: "Date Of Injury" },
  { token: "INITIAL_EXAM", label: "Initial Exam" },
  { token: "CASE_NUMBER", label: "Case #" },
  { token: "CASE_STATUS", label: "Case Status" },
  { token: "LIEN_STATUS", label: "Lien / LOP" },
  { token: "PRIOR_CARE", label: "Prior Care" },
  { token: "PATIENT_NOTES", label: "Patient File Notes" },
  { token: "XRAY_FINDINGS", label: "X-Ray Findings" },
  { token: "MRI_CT_FINDINGS", label: "MRI / CT Findings" },
  { token: "SPECIALIST_RECOMMENDATIONS", label: "Specialist Recommendations" },
  { token: "BILLED_AMOUNT", label: "Billed Amount" },
  { token: "PAID_AMOUNT", label: "Paid Amount" },
  { token: "PERCENTAGE_PAID", label: "Percentage Paid" },
  // DISCHARGE_DATE removed from the picker per user feedback — the
  // dischargeDate field on PatientRecord is rarely populated, so the
  // token resolved to an empty string in practice. Users now reach for
  // the per-encounter ENCOUNTER_n_DATE / ENCOUNTER_n_TYPE pair (or the
  // appointment-typed group tokens) which are always populated. Token
  // is still resolved by report-generator so any pre-existing template
  // that references it keeps rendering (just resolves to "").
  { token: "RB_SENT_DATE", label: "R&B Sent Date" },
  { token: "PAID_DATE", label: "Paid Date" },
  { token: "REVIEW_STATUS", label: "Review Status" },
  { token: "FIRST_ENCOUNTER_DATE", label: "First Encounter Date" },
  { token: "LATEST_ENCOUNTER_DATE", label: "Latest Encounter Date" },
  { token: "ENCOUNTER_COUNT", label: "Encounter Count" },
  { token: "FIRST_SUBJECTIVE", label: "First Subjective" },
  { token: "FIRST_OBJECTIVE", label: "First Objective" },
  { token: "FIRST_ASSESSMENT", label: "First Assessment" },
  { token: "FIRST_PLAN", label: "First Plan" },
  { token: "LATEST_SUBJECTIVE", label: "Latest Subjective" },
  { token: "LATEST_OBJECTIVE", label: "Latest Objective" },
  { token: "LATEST_ASSESSMENT", label: "Latest Assessment" },
  { token: "LATEST_PLAN", label: "Latest Plan" },
  { token: "ALL_SUBJECTIVE", label: "All Subjective" },
  { token: "ALL_OBJECTIVE", label: "All Objective" },
  { token: "ALL_ASSESSMENT", label: "All Assessment" },
  { token: "ALL_PLAN", label: "All Plan" },
  { token: "MACRO_SUBJECTIVE", label: "Macro Subjective" },
  { token: "MACRO_OBJECTIVE", label: "Macro Objective" },
  { token: "MACRO_ASSESSMENT", label: "Macro Assessment" },
  { token: "MACRO_PLAN", label: "Macro Plan" },
  { token: "ENCOUNTER_TIMELINE", label: "Encounter Timeline" },
  { token: "DIAGNOSIS_LIST", label: "Diagnosis List" },
  { token: "DIAGNOSIS_CODES", label: "Diagnosis Codes" },
  { token: "CHARGE_LEDGER", label: "Charge Ledger" },
  { token: "TOTAL_CHARGE_AMOUNT", label: "Total Charge Amount" },
  { token: "XRAY_SUMMARY", label: "X-Ray Summary" },
  { token: "XRAY_SENT_DATE", label: "X-Ray Sent Date" },
  { token: "XRAY_COMPLETED_DATE", label: "X-Ray Completed Date" },
  { token: "XRAY_REVIEWED_DATE", label: "X-Ray Reviewed Date" },
  { token: "MRI_CT_SUMMARY", label: "MRI/CT Summary" },
  { token: "MRI_SENT_DATE", label: "MRI Sent Date" },
  { token: "MRI_SCHEDULED_DATE", label: "MRI Scheduled Date" },
  { token: "MRI_COMPLETED_DATE", label: "MRI Completed Date" },
  { token: "MRI_REVIEWED_DATE", label: "MRI Reviewed Date" },
  { token: "SPECIALIST_SUMMARY", label: "Specialist Summary" },
  { token: "SPECIALIST_NAME", label: "Specialist Name(s)" },
  { token: "DECOMPRESSION_SUMMARY", label: "Decompression Treatment Summary" },
  // ── Numbered specialist tokens (specialist #1 through #10) ──
  ...Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return [
      { token: `SPECIALIST_${n}_NAME`, label: `Specialist #${n} Name` },
      { token: `SPECIALIST_${n}_SENT`, label: `Specialist #${n} Sent Date` },
      { token: `SPECIALIST_${n}_COMPLETED`, label: `Specialist #${n} Completed Date` },
      { token: `SPECIALIST_${n}_RECOMMENDATIONS`, label: `Specialist #${n} Recommendations` },
    ];
  }).flat(),
  // ── Numbered encounter tokens (encounter #1 through #20, each SOAP section) ──
  ...Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    return [
      { token: `ENCOUNTER_${n}_SUBJECTIVE`, label: `Encounter #${n} Subjective` },
      { token: `ENCOUNTER_${n}_OBJECTIVE`, label: `Encounter #${n} Objective` },
      { token: `ENCOUNTER_${n}_ASSESSMENT`, label: `Encounter #${n} Assessment` },
      { token: `ENCOUNTER_${n}_PLAN`, label: `Encounter #${n} Plan` },
      { token: `ENCOUNTER_${n}_DATE`, label: `Encounter #${n} Date` },
      { token: `ENCOUNTER_${n}_TYPE`, label: `Encounter #${n} Appointment Type` },
    ];
  }).flat(),
];

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizePrompt(value: unknown): NarrativeReportPrompt | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<NarrativeReportPrompt>;
  const id = normalizeString(row.id);
  const label = normalizeString(row.label);
  const token = normalizeString(row.token).toUpperCase();
  if (!id || !label || !/^[A-Z0-9_]+$/.test(token)) {
    return null;
  }
  const options = Array.isArray(row.options)
    ? row.options.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
  return {
    id,
    label,
    token,
    options,
    required: row.required === true,
  };
}

function normalizeTemplate(value: unknown): NarrativeReportTemplate | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<NarrativeReportTemplate>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  const body = typeof row.body === "string" ? row.body : "";
  if (!id || !name || !body.trim()) {
    return null;
  }
  const prompts = Array.isArray(row.prompts)
    ? row.prompts.map(normalizePrompt).filter((entry): entry is NarrativeReportPrompt => Boolean(entry))
    : [];
  return {
    id,
    name,
    body,
    fontFamily: normalizeString(row.fontFamily) || defaultFontFamily(),
    active: row.active !== false,
    prompts,
  };
}

function normalizeLibrary(value: unknown): NarrativeReportLibrary {
  const defaults = getDefaultNarrativeReportLibrary();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const row = value as Partial<NarrativeReportLibrary>;
  const templates = Array.isArray(row.templates)
    ? row.templates.map(normalizeTemplate).filter((entry): entry is NarrativeReportTemplate => Boolean(entry))
    : [];

  if (!templates.length) {
    return defaults;
  }

  return {
    templates,
  };
}

export function getDefaultNarrativeReportLibrary(): NarrativeReportLibrary {
  return {
    templates: [createDefaultTemplate()],
  };
}

export function loadNarrativeReportLibrary(): NarrativeReportLibrary {
  if (typeof window === "undefined") {
    return getDefaultNarrativeReportLibrary();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // localStorage is empty — try to load from cloud asynchronously.
      // Return defaults for now; the hook will update when cloud data arrives.
      void loadNarrativeReportLibraryFromCloud();
      return getDefaultNarrativeReportLibrary();
    }
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    return getDefaultNarrativeReportLibrary();
  }
}

/**
 * Async fallback: fetch report templates from the cloud KV table
 * and write them to localStorage. Dispatches a storage event so
 * any mounted hooks re-read.
 */
async function loadNarrativeReportLibraryFromCloud(): Promise<void> {
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const value = await fetchKvValue<NarrativeReportLibrary>(STORAGE_KEY);
    if (!value || !value.templates || value.templates.length === 0) {
      return;
    }
    const library = normalizeLibrary(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    } catch {
      // Quota still full — that's OK, we'll use the cloud value directly
    }
    // Trigger re-render in any mounted hook
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  } catch (err) {
    console.warn("[report-templates] cloud fallback failed:", err);
  }
}

export function saveNarrativeReportLibrary(config: NarrativeReportLibrary) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", config));
}

export function createPromptTokenFromLabel(label: string) {
  const normalized = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return "PROMPT_FIELD";
  }
  if (normalized.startsWith("PROMPT_")) {
    return normalized;
  }
  return `PROMPT_${normalized}`;
}

export function toPromptOptions(optionDraft: string) {
  return optionDraft
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

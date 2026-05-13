/**
 * Per-user preferences for the Patient Page layout — specifically,
 * which collapsible sections should be open by default when the user
 * navigates to any patient. Lives separately from per-patient state so
 * "Notes always open everywhere" doesn't require touching each patient
 * record.
 *
 * Storage: localStorage with cloud dual-write through kv-cloud, same
 * pattern as office-settings / sms-templates.
 */

export type PatientPagePanelKey =
  | "notes"
  | "reExam"
  | "relatedCases"
  | "appointments"
  | "diagnosis"
  | "letters"
  | "narrative"
  | "patientFiles"
  | "additionalDetails";

export const patientPagePanelKeys: PatientPagePanelKey[] = [
  "notes",
  "reExam",
  "relatedCases",
  "appointments",
  "diagnosis",
  "letters",
  "narrative",
  "patientFiles",
  "additionalDetails",
];

/** Display labels — match what the user actually sees on the patient
 *  page so the Settings checkboxes don't read as developer keys. */
export const patientPagePanelLabels: Record<PatientPagePanelKey, string> = {
  notes: "Notes",
  reExam: "Case Flow & To-Do",
  relatedCases: "Related Cases",
  appointments: "Appointments / Encounters",
  diagnosis: "Diagnosis Codes",
  letters: "Letters",
  narrative: "Reports",
  patientFiles: "Patient Files",
  additionalDetails: "Additional Details",
};

export interface PatientPagePrefs {
  /** Map from panel key → boolean (true = start expanded on patient page mount). */
  defaultOpen: Record<PatientPagePanelKey, boolean>;
}

const STORAGE_KEY = "casemate.patient-page-prefs.v1";

/** Defaults the user explicitly asked for: Notes is the one panel
 *  the user wants always open so they don't miss patient notes. The
 *  rest stay closed (matches the patient-page behavior before this
 *  feature existed). */
export function getDefaultPatientPagePrefs(): PatientPagePrefs {
  return {
    defaultOpen: {
      notes: true,
      reExam: false,
      relatedCases: false,
      appointments: false,
      diagnosis: false,
      letters: false,
      narrative: false,
      patientFiles: false,
      additionalDetails: false,
    },
  };
}

function normalizeDefaultOpen(value: unknown): Record<PatientPagePanelKey, boolean> {
  const defaults = getDefaultPatientPagePrefs().defaultOpen;
  if (!value || typeof value !== "object") return defaults;
  const record = value as Record<string, unknown>;
  const next = { ...defaults };
  for (const key of patientPagePanelKeys) {
    const incoming = record[key];
    if (typeof incoming === "boolean") {
      next[key] = incoming;
    }
  }
  return next;
}

export function normalizePatientPagePrefs(value: unknown): PatientPagePrefs {
  if (!value || typeof value !== "object") {
    return getDefaultPatientPagePrefs();
  }
  const payload = value as { defaultOpen?: unknown };
  return {
    defaultOpen: normalizeDefaultOpen(payload.defaultOpen),
  };
}

export function loadPatientPagePrefs(): PatientPagePrefs {
  if (typeof window === "undefined") {
    return getDefaultPatientPagePrefs();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultPatientPagePrefs();
    return normalizePatientPagePrefs(JSON.parse(raw));
  } catch {
    return getDefaultPatientPagePrefs();
  }
}

export function savePatientPagePrefs(prefs: PatientPagePrefs) {
  if (typeof window === "undefined") return;
  const normalized = normalizePatientPagePrefs(prefs);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(STORAGE_KEY, "tasks", normalized),
  );
}

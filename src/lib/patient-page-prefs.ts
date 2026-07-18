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

/** Three-way per-section display mode:
 *   open → visible and expanded on patient-page load
 *   show → visible but collapsed
 *   hide → not rendered at all */
export type PatientPageSectionMode = "open" | "show" | "hide";

export interface PatientPagePrefs {
  /** Map from panel key → display mode. */
  mode: Record<PatientPagePanelKey, PatientPageSectionMode>;
}

const STORAGE_KEY = "casemate.patient-page-prefs.v1";

/** Defaults: Notes opens expanded (so notes are never missed); the rest
 *  are visible but collapsed. Nothing is hidden by default. */
export function getDefaultPatientPagePrefs(): PatientPagePrefs {
  return {
    mode: {
      notes: "open",
      reExam: "show",
      relatedCases: "show",
      appointments: "show",
      diagnosis: "show",
      letters: "show",
      narrative: "show",
      patientFiles: "show",
      additionalDetails: "show",
    },
  };
}

function normalizeMode(value: unknown, legacyDefaultOpen: unknown): Record<PatientPagePanelKey, PatientPageSectionMode> {
  const defaults = getDefaultPatientPagePrefs().mode;
  const next = { ...defaults };
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  // Legacy migration: old prefs stored defaultOpen booleans (true = open,
  // false = collapsed-but-visible). Map those to the new modes.
  const legacy =
    legacyDefaultOpen && typeof legacyDefaultOpen === "object"
      ? (legacyDefaultOpen as Record<string, unknown>)
      : null;
  for (const key of patientPagePanelKeys) {
    const incoming = record?.[key];
    if (incoming === "open" || incoming === "show" || incoming === "hide") {
      next[key] = incoming;
    } else if (legacy && typeof legacy[key] === "boolean") {
      next[key] = legacy[key] ? "open" : "show";
    }
  }
  return next;
}

export function normalizePatientPagePrefs(value: unknown): PatientPagePrefs {
  if (!value || typeof value !== "object") {
    return getDefaultPatientPagePrefs();
  }
  const payload = value as { mode?: unknown; defaultOpen?: unknown };
  return {
    mode: normalizeMode(payload.mode, payload.defaultOpen),
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

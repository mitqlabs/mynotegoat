export interface PatientDiagnosisEntry {
  id: string;
  code: string;
  description: string;
  source: string;
  createdAt: string;
}

type PatientDiagnosisMap = Record<string, PatientDiagnosisEntry[]>;

export const PATIENT_DIAGNOSES_STORAGE_KEY = "casemate.patient-diagnoses.v1";
const STORAGE_KEY = PATIENT_DIAGNOSES_STORAGE_KEY;

function normalizeEntry(value: unknown): PatientDiagnosisEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<PatientDiagnosisEntry>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const source = typeof row.source === "string" ? row.source.trim() : "";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
  if (!id || !code || !description) {
    return null;
  }
  return {
    id,
    code,
    description,
    source: source || "Manual",
    createdAt,
  };
}

export function loadPatientDiagnosesMap(): PatientDiagnosisMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const map: PatientDiagnosisMap = {};
    Object.entries(parsed).forEach(([patientId, entries]) => {
      if (!Array.isArray(entries)) {
        return;
      }
      const normalized = entries.map(normalizeEntry).filter((entry): entry is PatientDiagnosisEntry => Boolean(entry));
      map[patientId] = normalized;
    });
    return map;
  } catch {
    return {};
  }
}

export function savePatientDiagnosesMap(value: PatientDiagnosisMap) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "billing", value));
}


/** Code key for "is this code already on the patient": case, dots and spaces ignored. */
export function diagnosisCodeKey(code: string): string {
  return code.replace(/[\s.]/g, "").toUpperCase();
}

function createDiagnosisEntry(code: string, description: string, source: string): PatientDiagnosisEntry {
  return {
    id: `pdx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    description,
    source: source.trim() || "Manual",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Append codes to a patient's list, skipping blanks and any code already on
 * the patient (or earlier in `items`) — one row per code, however it's added
 * (bundle, search, G.O.A.T., + Dx Code). Returns the same array when nothing
 * was added.
 */
export function addDiagnosesToList(
  current: PatientDiagnosisEntry[],
  items: Array<{ code: string; description: string; source?: string }>,
  defaultSource = "Manual",
): { entries: PatientDiagnosisEntry[]; added: number } {
  const seen = new Set(current.map((entry) => diagnosisCodeKey(entry.code)));
  const additions: PatientDiagnosisEntry[] = [];
  for (const item of items) {
    const code = item.code.trim().toUpperCase();
    const description = item.description.trim();
    const key = diagnosisCodeKey(code);
    if (!key || !description || seen.has(key)) continue;
    seen.add(key);
    additions.push(createDiagnosisEntry(code, description, item.source ?? defaultSource));
  }
  return additions.length ? { entries: [...current, ...additions], added: additions.length } : { entries: current, added: 0 };
}

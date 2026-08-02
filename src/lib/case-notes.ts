/**
 * Per-patient free-form Case Notes, shared across the patient page and the
 * encounter workspace so the two boxes mirror each other. One blob:
 * { [patientId]: notesText }, dual-written to the "tasks" KV namespace.
 *
 * Seeded lazily from the legacy patient.matrix.notes: until a patient's note
 * is edited through this store, getCaseNote returns null and callers fall back
 * to the matrix value, so nothing looks empty after the switch.
 */

const STORAGE_KEY = "casemate.case-notes.v1";
export const STORAGE_KEY_CASE_NOTES = STORAGE_KEY;

type CaseNotesMap = Record<string, string>;

function load(): CaseNotesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CaseNotesMap) : {};
  } catch {
    return {};
  }
}

function save(map: CaseNotesMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", map));
}

/** Returns the stored note, or null if this patient has no entry yet. */
export function getCaseNote(patientId: string): string | null {
  const key = patientId.trim();
  if (!key) return null;
  const map = load();
  return Object.prototype.hasOwnProperty.call(map, key) ? String(map[key] ?? "") : null;
}

export function setCaseNote(patientId: string, notes: string) {
  const key = patientId.trim();
  if (!key) return;
  const map = load();
  map[key] = notes;
  save(map);
}

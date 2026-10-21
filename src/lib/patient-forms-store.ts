/**
 * Form templates (Settings → Forms): one workspace_kv row per office,
 * cached in localStorage like every other settings key. Union-merged by
 * template id (newest updatedAt wins), so two computers editing different
 * forms never overwrite each other; deletes are tombstones (`deleted`).
 */
import { normalizePatientForms, PATIENT_FORMS_STORAGE_KEY, type FormTemplate } from "@/lib/patient-forms";

export function loadPatientForms(): FormTemplate[] {
  if (typeof window === "undefined") return normalizePatientForms([]);
  try {
    const raw = window.localStorage.getItem(PATIENT_FORMS_STORAGE_KEY);
    return normalizePatientForms(raw ? JSON.parse(raw) : []);
  } catch {
    return normalizePatientForms([]);
  }
}

export function savePatientForms(rows: FormTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PATIENT_FORMS_STORAGE_KEY, JSON.stringify(rows));
  void mergeAndUpload(rows);
}

/**
 * Read-merge-write: pull the cloud copy, union it with ours by template id
 * (newest updatedAt wins), upload the merge. A form edited on another
 * computer since our last sync is kept, not overwritten.
 */
async function mergeAndUpload(rows: FormTemplate[]) {
  try {
    const [{ fetchKvValue, dualWriteKv }, { unionMerge, sameJson }, { notifyChange }] = await Promise.all([
      import("@/lib/kv-cloud"),
      import("@/lib/kv-merge"),
      import("@/lib/local-sync"),
    ]);
    const cloud = await fetchKvValue<unknown>(PATIENT_FORMS_STORAGE_KEY);
    const merged = cloud ? normalizePatientForms(unionMerge(rows, cloud)) : rows;
    await dualWriteKv(PATIENT_FORMS_STORAGE_KEY, "tasks", merged);
    // Only write the merge back if nothing was typed meanwhile; otherwise
    // this stale copy would undo the newest keystrokes.
    const stillOurs = window.localStorage.getItem(PATIENT_FORMS_STORAGE_KEY) === JSON.stringify(rows);
    if (stillOurs && !sameJson(merged, rows)) {
      window.localStorage.setItem(PATIENT_FORMS_STORAGE_KEY, JSON.stringify(merged));
      notifyChange(PATIENT_FORMS_STORAGE_KEY);
    }
  } catch (err) {
    console.error("[patient-forms] cloud save failed:", err);
  }
}

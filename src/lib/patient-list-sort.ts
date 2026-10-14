/**
 * The Patients list sort (column + direction), remembered per browser.
 *
 * The old keys started with "casemate.", so they rode along in the workspace's
 * cloud snapshot and a restore on the next load put back an old/other device's
 * sort. This key is outside that prefix, so only this browser's choice counts.
 */
export const PATIENT_LIST_SORT_KEY = "notegoat-ui.patient-list-sort.v1";
const LEGACY_COLUMN_KEY = "casemate.patient-sort-column.v1";
const LEGACY_ASC_KEY = "casemate.patient-sort-asc.v1";

export interface PatientListSort<C extends string = string> {
  column: C;
  asc: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function store(s?: Store | null): Store | null {
  if (s) return s;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved sort, or the fallback. Reads the legacy keys once if there's nothing new yet. */
export function loadPatientListSort<C extends string>(columns: readonly C[], fallback: PatientListSort<C>, s?: Store | null): PatientListSort<C> {
  const st = store(s);
  if (!st) return fallback;
  try {
    const raw = st.getItem(PATIENT_LIST_SORT_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PatientListSort>;
      if (typeof v.column === "string" && columns.includes(v.column as C)) {
        return { column: v.column as C, asc: v.asc !== false };
      }
    }
    const col = st.getItem(LEGACY_COLUMN_KEY);
    if (col && columns.includes(col as C)) {
      return { column: col as C, asc: st.getItem(LEGACY_ASC_KEY) !== "false" };
    }
  } catch {
    // unreadable → fallback
  }
  return fallback;
}

export function savePatientListSort<C extends string>(sort: PatientListSort<C>, s?: Store | null): void {
  const st = store(s);
  if (!st) return;
  try {
    st.setItem(PATIENT_LIST_SORT_KEY, JSON.stringify({ column: sort.column, asc: sort.asc }));
  } catch {
    // quota / private mode: the sort just isn't remembered
  }
}

/** Clicking a header: same column flips direction, a new column starts ascending. */
export function nextSort<C extends string>(current: PatientListSort<C>, clicked: C): PatientListSort<C> {
  return current.column === clicked ? { column: clicked, asc: !current.asc } : { column: clicked, asc: true };
}

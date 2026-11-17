/**
 * Keeps person columns on existing case rows from being rewritten when the
 * folder preview is on. The folder record is the source of truth for those
 * fields; the case row keeps the values it had before any overlay.
 *
 * With the switch off, every function here is a no-op and patient saves are
 * unchanged.
 */
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";

export type FrozenPerson = {
  fullName: string;
  dob: string;
  sex: string | null;
  maritalStatus: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  alerts: string[] | null;
};

const frozenByCaseId = new Map<string, FrozenPerson>();

export function rememberOriginalPerson(caseId: string, person: FrozenPerson): void {
  if (!patientFoldersEnabled()) return;
  if (!caseId || frozenByCaseId.has(caseId)) return;
  frozenByCaseId.set(caseId, {
    fullName: person.fullName,
    dob: person.dob,
    sex: person.sex,
    maritalStatus: person.maritalStatus,
    phone: person.phone,
    email: person.email,
    address: person.address,
    alerts: person.alerts ? [...person.alerts] : null,
  });
}

/** Person columns to write back onto an existing case row. Null when the switch is off. */
export function frozenPersonColumns(caseId: string): FrozenPerson | null {
  if (!patientFoldersEnabled()) return null;
  return frozenByCaseId.get(caseId) ?? null;
}

export const PERSON_PATCH_KEYS = [
  "fullName",
  "dob",
  "sex",
  "maritalStatus",
  "phone",
  "email",
  "address",
  "alerts",
] as const;

export type PersonPatchKey = (typeof PERSON_PATCH_KEYS)[number];

/** Pull person fields out of a case save so they are not written onto the case row. */
export function splitPersonPatch<T extends Record<string, unknown>>(patch: T): {
  hasPerson: boolean;
  person: Partial<Pick<T, PersonPatchKey>>;
  casePatch: Partial<T>;
} {
  if (!patientFoldersEnabled()) {
    return { hasPerson: false, person: {}, casePatch: patch };
  }
  const person: Partial<Pick<T, PersonPatchKey>> = {};
  const casePatch: Partial<T> = {};
  let hasPerson = false;
  for (const [key, value] of Object.entries(patch)) {
    if ((PERSON_PATCH_KEYS as readonly string[]).includes(key)) {
      hasPerson = true;
      (person as Record<string, unknown>)[key] = value;
    } else {
      (casePatch as Record<string, unknown>)[key] = value;
    }
  }
  return { hasPerson, person, casePatch };
}

/** Test-only reset. */
export function resetFrozenPeople(): void {
  frozenByCaseId.clear();
}

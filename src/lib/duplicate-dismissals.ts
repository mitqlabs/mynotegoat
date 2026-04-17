"use client";

/**
 * Duplicate-patient dismissals.
 *
 * The duplicate scanner often turns up groups that look like duplicates
 * by name + DOB / DOL but are actually intentional — e.g. one patient
 * with two separate accidents has two records with the same name + DOB
 * but different dates of loss, so each record should stay distinct.
 *
 * When the user marks a group as "Not a Duplicate" we record a
 * fingerprint of the group's patient IDs so future scans skip it. The
 * fingerprint is order-independent: ids are sorted and joined with "|".
 *
 * If a NEW patient later joins what looks like the same cluster, the
 * fingerprint changes (the new id makes a new key) so the user is asked
 * to confirm the bigger group too — they can dismiss it again or merge.
 */

const STORAGE_KEY = "casemate.duplicate-dismissals.v1";

/** Build a stable fingerprint for a set of patient ids. */
export function dismissalFingerprint(patientIds: string[]): string {
  return [...patientIds].sort().join("|");
}

function loadRaw(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveRaw(set: Set<string>): void {
  if (typeof window === "undefined") return;
  const arr = Array.from(set);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", arr));
}

export function loadDuplicateDismissals(): Set<string> {
  return loadRaw();
}

export function isDuplicateDismissed(patientIds: string[]): boolean {
  const set = loadRaw();
  return set.has(dismissalFingerprint(patientIds));
}

export function dismissDuplicateGroup(patientIds: string[]): void {
  const set = loadRaw();
  set.add(dismissalFingerprint(patientIds));
  saveRaw(set);
}

export function undismissDuplicateGroup(patientIds: string[]): void {
  const set = loadRaw();
  set.delete(dismissalFingerprint(patientIds));
  saveRaw(set);
}

/** Drop a fingerprint that contains a no-longer-existing patient id. Called
 *  after a merge so a "ghost" dismissal doesn't outlive the patients it
 *  referenced. */
export function purgeDismissalsContaining(patientId: string): void {
  const set = loadRaw();
  let changed = false;
  for (const fp of Array.from(set)) {
    if (fp.split("|").includes(patientId)) {
      set.delete(fp);
      changed = true;
    }
  }
  if (changed) saveRaw(set);
}

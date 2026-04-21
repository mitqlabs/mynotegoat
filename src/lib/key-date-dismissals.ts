"use client";

/**
 * Key-Date Conflict Dismissals
 *
 * Persistent per-workspace set of appointment IDs the user has
 * explicitly "cleared" from the Key Dates conflict warnings list.
 * Once an appointment is in this set, the Key Dates page stops
 * surfacing it as a warning — the appointment itself still exists
 * and shows up on every other screen (patient file, schedule, etc).
 * Dismissal just means "yes, I know about this, stop nagging me."
 *
 * Removing an appointment from the schedule implicitly removes it
 * from this list too so dismissals don't linger against deleted
 * records. The schedule-appointments hook is responsible for calling
 * `purgeDismissalsForAppointments` when it removes entries.
 */

const STORAGE_KEY = "casemate.key-date-dismissals.v1";

export type KeyDateDismissalSet = Set<string>;

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
  }
  return out;
}

export function loadKeyDateDismissals(): KeyDateDismissalSet {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(normalizeList(JSON.parse(raw)));
  } catch {
    return new Set();
  }
}

export function saveKeyDateDismissals(dismissals: KeyDateDismissalSet) {
  if (typeof window === "undefined") return;
  const sorted = Array.from(dismissals).sort();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(STORAGE_KEY, "tasks", sorted),
  );
}

export const keyDateDismissalsStorageKey = STORAGE_KEY;

"use client";

import { useCallback, useSyncExternalStore } from "react";

export type DateSortDirection = "oldest" | "newest";

/** Per-page storage keys. Deliberately NOT under the "casemate." prefix:
 *  this is a per-device view preference, and casemate.* writes trigger a
 *  full cloud push (see storage-sync-interceptor). */
export const DATE_SORT_KEYS = {
  patientAppointments: "notegoat.sort.patient-appointments",
  encountersPage: "notegoat.sort.encounters-page",
} as const;

// Same-tab listeners (the "storage" event only fires in other tabs).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSaved(key: string): DateSortDirection | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === "oldest" || raw === "newest" ? raw : null;
  } catch {
    return null;
  }
}

/** Date sort direction for one list, remembered per page in localStorage.
 *  Server render / first hydration pass uses `fallback`; the saved choice
 *  applies on the client. */
export function useDateSortPreference(key: string, fallback: DateSortDirection) {
  const direction = useSyncExternalStore(
    subscribe,
    () => readSaved(key) ?? fallback,
    () => fallback,
  );

  const setDirection = useCallback(
    (next: DateSortDirection) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Storage full / disabled: nothing to persist.
      }
      listeners.forEach((notify) => notify());
    },
    [key],
  );

  const toggle = useCallback(() => {
    setDirection(direction === "newest" ? "oldest" : "newest");
  }, [direction, setDirection]);

  return { direction, setDirection, toggle };
}

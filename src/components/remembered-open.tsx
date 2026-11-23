"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Open/closed flags for Statistics sections. One map, one "user" key
 * (casemate.dashboard.sections-open.v1), mirrored by user-prefs-cloud.
 * A missing flag is open, so the first visit starts expanded.
 */
export const DASHBOARD_SECTIONS_KEY = "casemate.dashboard.sections-open.v1";

export const ATTORNEY_PERFORMANCE_SECTION = "attorneyPerformance";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readSectionMap(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DASHBOARD_SECTIONS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function readSectionOpen(id: string): boolean {
  return readSectionMap()[id] !== false;
}

export function useRememberedOpen(id: string) {
  const savedOpen = useSyncExternalStore(subscribeToStorage, () => readSectionOpen(id), () => true);
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? savedOpen;

  const setOpen = useCallback((next: boolean) => {
    setOverride(next);
    try {
      const saved = readSectionMap();
      window.localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify({ ...saved, [id]: next }));
    } catch {
      // The on-screen choice still updates. The cloud mirror runs on a successful write.
    }
  }, [id]);

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  /** Show the section for this visit (a deep link) without changing the saved choice. */
  const reveal = useCallback(() => setOverride(true), []);

  return { open, toggle, setOpen, reveal };
}

"use client";

/**
 * Holiday DATES the office chose to keep on schedule.
 *
 * When a recurring series is saved with a federal holiday set to "Keep",
 * that specific ISO date (e.g. "2026-06-19") is remembered here. Future
 * bookings that land on the same date show it as "Kept on schedule" and
 * book it as a normal visit. It is per DATE, so it does not carry over to
 * the same holiday in later years. A CLOSED key date still wins.
 *
 * v2 replaces the name-based v1 key ("casemate.holiday-keep-schedule.v1",
 * e.g. ["Veterans Day"]). v1 entries are deliberately ignored, not
 * migrated: a name can't be mapped to the one date the user meant, and
 * carrying it to every year is exactly what the new spec rules out.
 *
 * Stored like the other small workspace settings: localStorage plus a
 * dual-write to the workspace_kv cloud row (namespace "tasks"), with the
 * key listed in cloud-state's hydrate list so other devices restore it.
 */

const STORAGE_KEY = "casemate.holiday-keep-schedule.v2";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && datePattern.test(entry));
}

export function loadKeptHolidayDates(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? normalizeList(JSON.parse(raw)) : []);
  } catch {
    return new Set();
  }
}

function saveKeptHolidayDates(dates: Set<string>) {
  if (typeof window === "undefined") return;
  const sorted = Array.from(dates).sort();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Quota or private mode — the cloud copy below still records it.
  }
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", sorted));
}

/** Remember holiday dates as kept on schedule. Returns the updated set. */
export function addKeptHolidayDates(dates: string[]): Set<string> {
  const next = loadKeptHolidayDates();
  const valid = dates.filter((date) => datePattern.test(date));
  if (!valid.length) return next;
  valid.forEach((date) => next.add(date));
  saveKeptHolidayDates(next);
  return next;
}

/** Forget a kept holiday date ("Undo"). Returns the updated set. */
export function removeKeptHolidayDate(dateIso: string): Set<string> {
  const next = loadKeptHolidayDates();
  if (next.delete(dateIso)) saveKeptHolidayDates(next);
  return next;
}

export const holidayKeepScheduleStorageKey = STORAGE_KEY;

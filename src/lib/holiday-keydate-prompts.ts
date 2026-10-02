"use client";

/**
 * Holiday → Key Dates prompt memory.
 *
 * When a recurring series books a federal holiday as Canceled, the New
 * Appointment modal offers to add that holiday to Key Dates as a Closed
 * day. This set remembers which holidays the user has already been asked
 * about — by holiday NAME (e.g. "Veterans Day"), so one answer carries
 * across years and a declined holiday isn't asked about again.
 *
 * Stored like the other small workspace settings: localStorage plus a
 * dual-write to the workspace_kv cloud row (namespace "tasks"), and the
 * key is listed in cloud-state's hydrate list so it comes back on other
 * devices / after local data is cleared.
 */

const STORAGE_KEY = "casemate.holiday-keydate-prompts.v1";

/** "Independence Day (observed)" → "Independence Day". */
export function holidayPromptName(name: string) {
  return name.replace(/\s*\(observed\)\s*$/i, "").trim();
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => holidayPromptName(entry));
}

export function loadPromptedHolidayNames(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? normalizeList(JSON.parse(raw)) : []);
  } catch {
    return new Set();
  }
}

export function markHolidayNamesPrompted(names: string[]) {
  if (typeof window === "undefined" || !names.length) return;
  const next = loadPromptedHolidayNames();
  names.forEach((name) => next.add(holidayPromptName(name)));
  const sorted = Array.from(next).sort();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Quota or private mode — the cloud copy below still records it.
  }
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", sorted));
}

export const holidayKeyDatePromptsStorageKey = STORAGE_KEY;

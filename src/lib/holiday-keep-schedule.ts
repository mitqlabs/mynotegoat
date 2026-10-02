"use client";

/**
 * Holidays the office has chosen to keep on schedule.
 *
 * When a recurring series is saved with "Keep Schedule" ticked for a
 * federal holiday, that holiday's NAME (e.g. "Veterans Day", with
 * "(observed)" stripped, so it carries across years and covers the
 * observed day too) is remembered here. Remembered holidays are treated
 * as normal workdays in future bookings: no Canceled placeholder, no extra
 * visit, no Key Dates prompt. A CLOSED key date still wins.
 *
 * Stored like holiday-keydate-prompts: localStorage plus a dual-write to
 * the workspace_kv cloud row (namespace "tasks"), with the key listed in
 * cloud-state's hydrate list so it is restored on other devices.
 */

import { holidayPromptName } from "@/lib/holiday-keydate-prompts";

const STORAGE_KEY = "casemate.holiday-keep-schedule.v1";

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => holidayPromptName(entry));
}

export function loadKeptHolidayNames(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? normalizeList(JSON.parse(raw)) : []);
  } catch {
    return new Set();
  }
}

function saveKeptHolidayNames(names: Set<string>) {
  if (typeof window === "undefined") return;
  const sorted = Array.from(names).sort();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Quota or private mode — the cloud copy below still records it.
  }
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", sorted));
}

/** Remember holidays as kept on schedule. Returns the updated set. */
export function addKeptHolidayNames(names: string[]): Set<string> {
  const next = loadKeptHolidayNames();
  if (!names.length) return next;
  names.forEach((name) => next.add(holidayPromptName(name)));
  saveKeptHolidayNames(next);
  return next;
}

/** Forget a kept holiday ("Undo"). Returns the updated set. */
export function removeKeptHolidayName(name: string): Set<string> {
  const next = loadKeptHolidayNames();
  if (next.delete(holidayPromptName(name))) saveKeptHolidayNames(next);
  return next;
}

export const holidayKeepScheduleStorageKey = STORAGE_KEY;

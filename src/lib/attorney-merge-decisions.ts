"use client";

/**
 * "These two are NOT the same firm" — remembered once, applied forever.
 *
 * Consolidate Attorneys guesses which spellings belong together. When it
 * guesses wrong, the user says so once and that pair stops being grouped,
 * on every device (localStorage first so the modal opens instantly, cloud
 * so it isn't per-browser).
 */

import { normalizeAttorneyKey } from "@/lib/attorney-name";

const STORAGE_KEY = "casemate.attorney-not-same.v1";

/** One decision: the two normalized names, sorted, joined. */
export function pairKey(a: string, b: string): string {
  const [x, y] = [normalizeAttorneyKey(a), normalizeAttorneyKey(b)].sort();
  return `${x}||${y}`;
}

export function loadNotSamePairs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveNotSamePairs(pairs: Set<string>): void {
  if (typeof window === "undefined") return;
  const list = [...pairs];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Cache only — the cloud write below is the real record.
  }
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", list));
}

/** Merge in whatever the cloud has (other devices' decisions). */
export async function fetchNotSamePairs(): Promise<Set<string> | null> {
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const remote = await fetchKvValue<unknown>(STORAGE_KEY);
    if (!Array.isArray(remote)) return null;
    return new Set(remote.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

/**
 * How G.O.A.T. writes recommendations (Settings → G.O.A.T.):
 *   - Show costs / fees (on by default)
 *   - Region order (head to toe by default)
 *
 * Per workspace in localStorage and dual-written to workspace_kv like the
 * G.O.A.T. words & synonyms, so every device in the office answers the same way.
 * Used by the answer on screen and by its Copy text.
 */

import type { RecFormatOptions } from "@/lib/goat-recs";

export const GOAT_ANSWER_PREFS_KEY = "casemate.goat-answer-prefs.v1";

export const DEFAULT_GOAT_REGION_ORDER = [
  "Cervical",
  "Thoracic",
  "Lumbar",
  "Shoulder",
  "Elbow",
  "Wrist/Hand",
  "Hip",
  "Knee",
  "Ankle/Foot",
];

export interface GoatAnswerPrefs {
  /** Include fees / costs written in reports. */
  showCosts: boolean;
  /** Order of the region headings in recommendations. */
  regionOrder: string[];
  updatedAt: string;
}

export const DEFAULT_GOAT_ANSWER_PREFS: GoatAnswerPrefs = {
  showCosts: true,
  regionOrder: DEFAULT_GOAT_REGION_ORDER,
  updatedAt: "",
};

/** Any stored value → valid prefs (unknown fields dropped, every region exactly once). */
export function normalizeGoatAnswerPrefs(value: unknown): GoatAnswerPrefs {
  const v = (value && typeof value === "object" ? value : {}) as Partial<GoatAnswerPrefs>;
  const order = Array.isArray(v.regionOrder)
    ? v.regionOrder.filter((r): r is string => typeof r === "string" && DEFAULT_GOAT_REGION_ORDER.includes(r))
    : [];
  // Keep every known region exactly once (new ones added to the end).
  const regionOrder = [...new Set([...order, ...DEFAULT_GOAT_REGION_ORDER])];
  return {
    showCosts: typeof v.showCosts === "boolean" ? v.showCosts : DEFAULT_GOAT_ANSWER_PREFS.showCosts,
    regionOrder,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
  };
}

/** Prefs → the recommendations formatter's options. */
export function recFormatFromPrefs(prefs: GoatAnswerPrefs): RecFormatOptions {
  return { showCosts: prefs.showCosts, regionOrder: prefs.regionOrder };
}

export function loadGoatAnswerPrefs(): GoatAnswerPrefs {
  if (typeof window === "undefined") return normalizeGoatAnswerPrefs(undefined);
  try {
    const raw = window.localStorage.getItem(GOAT_ANSWER_PREFS_KEY);
    return normalizeGoatAnswerPrefs(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeGoatAnswerPrefs(undefined);
  }
}

export function saveGoatAnswerPrefs(prefs: GoatAnswerPrefs) {
  if (typeof window === "undefined") return;
  const normalized = normalizeGoatAnswerPrefs({ ...prefs, updatedAt: new Date().toISOString() });
  window.localStorage.setItem(GOAT_ANSWER_PREFS_KEY, JSON.stringify(normalized));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(GOAT_ANSWER_PREFS_KEY, "tasks", normalized));
}

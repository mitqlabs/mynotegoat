/**
 * G.O.A.T. Smart mode (beta) answer preferences (Settings → G.O.A.T.).
 *
 * Per workspace in localStorage and dual-written to workspace_kv like the
 * other G.O.A.T. settings, so every device in the office answers the same way.
 * Only Smart mode reads these; normal G.O.A.T. is unchanged.
 */

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
  /** Lead each answer line with its body region, in `regionOrder`. */
  groupByRegion: boolean;
  regionOrder: string[];
  /** Show the exact matching lines from files under Smart answers (off: just a small source link). */
  showQuotes: boolean;
  updatedAt: string;
}

export const DEFAULT_GOAT_ANSWER_PREFS: GoatAnswerPrefs = {
  showCosts: true,
  groupByRegion: true,
  regionOrder: DEFAULT_GOAT_REGION_ORDER,
  showQuotes: false,
  updatedAt: "",
};

export function normalizeGoatAnswerPrefs(value: unknown): GoatAnswerPrefs {
  const v = (value && typeof value === "object" ? value : {}) as Partial<GoatAnswerPrefs>;
  const order = Array.isArray(v.regionOrder)
    ? v.regionOrder.filter((r): r is string => typeof r === "string" && DEFAULT_GOAT_REGION_ORDER.includes(r))
    : [];
  // Keep every known region exactly once (new ones added to the end).
  const regionOrder = [...new Set([...order, ...DEFAULT_GOAT_REGION_ORDER])];
  return {
    showCosts: typeof v.showCosts === "boolean" ? v.showCosts : DEFAULT_GOAT_ANSWER_PREFS.showCosts,
    groupByRegion: typeof v.groupByRegion === "boolean" ? v.groupByRegion : DEFAULT_GOAT_ANSWER_PREFS.groupByRegion,
    regionOrder,
    showQuotes: typeof v.showQuotes === "boolean" ? v.showQuotes : DEFAULT_GOAT_ANSWER_PREFS.showQuotes,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
  };
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

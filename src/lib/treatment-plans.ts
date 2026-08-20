/**
 * Per-patient treatment plans.
 *
 * A plan covers a date range and says, for each weekday, which regions get
 * which treatments. A "region" is a Plan-section macro (configured in
 * Settings → Macros → Treatment Plan Settings); "treatments" are that
 * macro's charge-linked "Treatments Performed" options. On an encounter
 * inside the range, the matching weekday's regions auto-apply into the Plan
 * section (text + charges).
 *
 * One blob per workspace, dual-written to the "billing" KV namespace.
 */

const STORAGE_KEY = "casemate.treatment-plans.v1";
export const STORAGE_KEY_TREATMENT_PLANS = STORAGE_KEY;

export interface WeekdayRegion {
  /** The region's Plan-section macro id. */
  macroId: string;
  /** Selected "Treatments Performed" option labels for this region/day. */
  treatments: string[];
  /**
   * Pre-picked answers to the macro's OTHER options-questions (e.g. a
   * Left/Right laterality picker), keyed by question id → selected option
   * labels. The charge-linked treatments question stays in `treatments`;
   * everything else lives here so auto-apply fills the note completely.
   */
  answers?: Record<string, string[]>;
}

/**
 * Spinal Decompression weight progression. One config per plan (applies to the
 * whole decompression macro, not per region). The weight steps up by `increase`
 * each decompression visit, starting from `startWeight` — e.g. start 12,
 * increase 2 → 12, 14, 16 … on successive covered encounters. `cycles` is a
 * static per-session value printed alongside the weight. All stored as the
 * user-typed strings so blanks/partial entry don't get coerced to 0.
 */
export interface DecompressionProgression {
  startWeight: string;
  increase: string;
  cycles: string;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  /** US MM/DD/YYYY (inclusive). */
  startDate: string;
  endDate: string;
  /** weekday 0=Sunday … 6=Saturday → the regions applied that day. */
  days: Record<number, WeekdayRegion[]>;
  /** Spinal Decompression weight progression (optional; see type). */
  decompression?: DecompressionProgression;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Detect the Spinal Decompression macro by its button name — the weight-
 *  progression feature keys off this (the macro itself is user data). */
export function isDecompressionMacroName(name: string): boolean {
  return /decompress/i.test(name);
}

/**
 * Stepped weight for a decompression visit. `visitIndex` is 0-based (first
 * covered encounter = 0 → startWeight). Returns null when no usable start
 * weight is configured.
 */
export function computeDecompressionWeight(
  config: DecompressionProgression | undefined,
  visitIndex: number,
): number | null {
  if (!config) return null;
  const start = Number(config.startWeight);
  if (!Number.isFinite(start) || config.startWeight.trim() === "") return null;
  const incRaw = Number(config.increase);
  const increase = Number.isFinite(incRaw) ? incRaw : 0;
  return start + increase * Math.max(0, visitIndex);
}

export type TreatmentPlansByPatient = Record<string, TreatmentPlan[]>;

export function createTreatmentPlanId(): string {
  return `TP-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    const t = normalizeText(v);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function normalizeAnswers(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeText(k);
    if (!key) continue;
    const arr = normalizeStringArray(v);
    if (arr.length) out[key] = arr;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeDays(value: unknown): Record<number, WeekdayRegion[]> {
  const out: Record<number, WeekdayRegion[]> = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, list] of Object.entries(value as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(list)) continue;
    const regions: WeekdayRegion[] = [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const macroId = normalizeText((r as { macroId?: unknown }).macroId);
      if (!macroId) continue;
      const answers = normalizeAnswers((r as { answers?: unknown }).answers);
      regions.push({
        macroId,
        treatments: normalizeStringArray((r as { treatments?: unknown }).treatments),
        ...(answers ? { answers } : {}),
      });
    }
    if (regions.length) out[day] = regions;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDecompression(value: unknown): DecompressionProgression | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<DecompressionProgression>;
  const startWeight = normalizeText(row.startWeight);
  const increase = normalizeText(row.increase);
  const cycles = normalizeText(row.cycles);
  if (!startWeight && !increase && !cycles) return undefined;
  return { startWeight, increase, cycles };
}

function normalizePlan(value: unknown): TreatmentPlan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TreatmentPlan>;
  const id = normalizeText(row.id);
  const patientId = normalizeText(row.patientId);
  if (!id || !patientId) return null;
  const decompression = normalizeDecompression(row.decompression);
  return {
    id,
    patientId,
    startDate: normalizeText(row.startDate),
    endDate: normalizeText(row.endDate),
    days: normalizeDays(row.days),
    ...(decompression ? { decompression } : {}),
    active: row.active !== false,
    createdAt: normalizeText(row.createdAt) || nowIso(),
    updatedAt: normalizeText(row.updatedAt) || nowIso(),
  };
}

function normalizeMap(value: unknown): TreatmentPlansByPatient {
  if (!value || typeof value !== "object") return {};
  const out: TreatmentPlansByPatient = {};
  for (const [patientId, list] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeText(patientId);
    if (!key || !Array.isArray(list)) continue;
    const plans = list.map(normalizePlan).filter((p): p is TreatmentPlan => Boolean(p));
    if (plans.length) out[key] = plans;
  }
  return out;
}

export function loadTreatmentPlans(): TreatmentPlansByPatient {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveTreatmentPlans(map: TreatmentPlansByPatient) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "billing", map));
}

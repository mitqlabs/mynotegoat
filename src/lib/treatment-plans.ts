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
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  /** US MM/DD/YYYY (inclusive). */
  startDate: string;
  endDate: string;
  /** weekday 0=Sunday … 6=Saturday → the regions applied that day. */
  days: Record<number, WeekdayRegion[]>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
      regions.push({ macroId, treatments: normalizeStringArray((r as { treatments?: unknown }).treatments) });
    }
    if (regions.length) out[day] = regions;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlan(value: unknown): TreatmentPlan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TreatmentPlan>;
  const id = normalizeText(row.id);
  const patientId = normalizeText(row.patientId);
  if (!id || !patientId) return null;
  return {
    id,
    patientId,
    startDate: normalizeText(row.startDate),
    endDate: normalizeText(row.endDate),
    days: normalizeDays(row.days),
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

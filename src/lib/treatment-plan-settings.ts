/**
 * Treatment Plan settings (Settings → Macros → Treatment Plan Settings).
 *
 * Holds the office-wide config for the Treatment Plan feature:
 *   - regions: the body regions available when building a plan. Each region
 *     points at a Plan-section SOAP macro (e.g. "Cervical" → the Cervical
 *     Plan macro), which supplies the "Region: [treatments]" output and the
 *     charge-linked treatment options.
 *   - behavior toggles: whether an active plan overrides the prior-encounter
 *     auto-salt, and whether SALT confirms before replacing existing Plan
 *     text.
 *
 * One blob per workspace, dual-written to the "macros" KV namespace.
 */

const STORAGE_KEY = "casemate.treatment-plan-settings.v1";
export const STORAGE_KEY_TREATMENT_PLAN_SETTINGS = STORAGE_KEY;

export interface TreatmentPlanRegion {
  id: string;
  /** Display name shown in plans, e.g. "Cervical". */
  name: string;
  /** Id of the Plan-section macro that produces this region's output + charges. */
  macroId: string;
}

export interface TreatmentPlanSettings {
  regions: TreatmentPlanRegion[];
  /** When true, an active treatment plan turns off the prior-encounter
   *  auto-salt for that patient (the plan is the source of truth). */
  planOverridesSalt: boolean;
  /** When true, hitting SALT / re-applying asks to confirm before replacing
   *  existing Plan-section content. */
  saltConfirmsReplace: boolean;
}

export function createRegionId(): string {
  return `TPR-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRegion(value: unknown): TreatmentPlanRegion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TreatmentPlanRegion>;
  const id = normalizeText(row.id);
  const name = normalizeText(row.name);
  const macroId = normalizeText(row.macroId);
  if (!id || !name) return null;
  return { id, name, macroId };
}

export function getDefaultTreatmentPlanSettings(): TreatmentPlanSettings {
  return { regions: [], planOverridesSalt: true, saltConfirmsReplace: true };
}

export function normalizeTreatmentPlanSettings(value: unknown): TreatmentPlanSettings {
  const row = (value && typeof value === "object" ? value : {}) as Partial<TreatmentPlanSettings>;
  const regions = Array.isArray(row.regions)
    ? row.regions.map(normalizeRegion).filter((r): r is TreatmentPlanRegion => Boolean(r))
    : [];
  return {
    regions,
    planOverridesSalt: row.planOverridesSalt !== false,
    saltConfirmsReplace: row.saltConfirmsReplace !== false,
  };
}

export function loadTreatmentPlanSettings(): TreatmentPlanSettings {
  if (typeof window === "undefined") return getDefaultTreatmentPlanSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultTreatmentPlanSettings();
    return normalizeTreatmentPlanSettings(JSON.parse(raw));
  } catch {
    return getDefaultTreatmentPlanSettings();
  }
}

export function saveTreatmentPlanSettings(settings: TreatmentPlanSettings) {
  if (typeof window === "undefined") return;
  const normalized = normalizeTreatmentPlanSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", normalized));
}

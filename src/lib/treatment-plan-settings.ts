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

export interface TreatmentPlanSettings {
  /** Plan-section macro ids marked as treatment regions (Cervical, Lumbar,
   *  …). A "region" IS its macro — name/treatments/charges come from it. */
  regionMacroIds: string[];
  /** When true, an active treatment plan turns off the prior-encounter
   *  auto-salt for that patient (the plan is the source of truth). */
  planOverridesSalt: boolean;
  /** When true, hitting SALT / re-applying asks to confirm before replacing
   *  existing Plan-section content. */
  saltConfirmsReplace: boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMacroIds(value: unknown, legacyRegions: unknown): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    const id = normalizeText(v);
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (Array.isArray(value)) {
    for (const v of value) push(v);
  } else if (Array.isArray(legacyRegions)) {
    // Migrate the old {id, name, macroId}[] shape → macro-id list.
    for (const r of legacyRegions) {
      if (r && typeof r === "object") push((r as { macroId?: unknown }).macroId);
    }
  }
  return ids;
}

export function getDefaultTreatmentPlanSettings(): TreatmentPlanSettings {
  return { regionMacroIds: [], planOverridesSalt: true, saltConfirmsReplace: true };
}

export function normalizeTreatmentPlanSettings(value: unknown): TreatmentPlanSettings {
  const row = (value && typeof value === "object" ? value : {}) as Partial<TreatmentPlanSettings> & {
    regions?: unknown;
  };
  return {
    regionMacroIds: normalizeMacroIds(row.regionMacroIds, row.regions),
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

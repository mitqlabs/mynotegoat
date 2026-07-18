/**
 * Module visibility. Now that Note Goat is a single all-access plan, an
 * office can HIDE features it doesn't use. Hiding a feature removes it
 * from the nav and (via guards elsewhere) hides its entry points across
 * the app — but background linkages still run (e.g. Key Dates can still
 * be auto-populated by scheduling even if the Key Dates tab is hidden).
 *
 * Patients and Settings are never hideable. Stored per workspace and
 * dual-written to the "tasks" KV namespace.
 */

import type { PortalFeature } from "@/lib/plan-access";

const STORAGE_KEY = "casemate.module-visibility.v1";
export const STORAGE_KEY_MODULE_VISIBILITY = STORAGE_KEY;

/** The features an office may hide. Patients + Settings are excluded. */
export const HIDEABLE_FEATURES: { feature: PortalFeature; label: string }[] = [
  { feature: "statistics", label: "Statistics" },
  { feature: "contacts", label: "Contacts" },
  { feature: "appointments", label: "Schedule" },
  { feature: "encounters", label: "Encounters" },
  { feature: "keyDates", label: "Key Dates" },
  { feature: "myFiles", label: "My Files" },
  { feature: "billing", label: "Billing" },
  { feature: "timers", label: "Timers" },
  { feature: "marketing", label: "Marketing" },
];

const HIDEABLE_SET = new Set<PortalFeature>(HIDEABLE_FEATURES.map((f) => f.feature));

/** feature → enabled. Missing key = enabled (features are on by default). */
export type ModuleVisibility = Partial<Record<PortalFeature, boolean>>;

export function isFeatureEnabled(
  visibility: ModuleVisibility | null | undefined,
  feature: PortalFeature,
): boolean {
  if (!HIDEABLE_SET.has(feature)) return true; // patients, settings, etc.
  return visibility?.[feature] ?? true;
}

export function normalizeModuleVisibility(value: unknown): ModuleVisibility {
  if (!value || typeof value !== "object") return {};
  const out: ModuleVisibility = {};
  for (const { feature } of HIDEABLE_FEATURES) {
    const v = (value as Record<string, unknown>)[feature];
    if (typeof v === "boolean") out[feature] = v;
  }
  return out;
}

export function loadModuleVisibility(): ModuleVisibility {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeModuleVisibility(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveModuleVisibility(visibility: ModuleVisibility) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", visibility));
}

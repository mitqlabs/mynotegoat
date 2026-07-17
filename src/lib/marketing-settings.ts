/**
 * Owner-configurable Marketing settings. For now just the "Type of
 * Visit" list used by the Marketing activity logger; more knobs will be
 * added here over time.
 *
 * Stored as one blob per workspace, dual-written to the "contacts" KV
 * namespace so it hydrates alongside the contact directory + marketing
 * activities.
 */

import { DEFAULT_MARKETING_VISIT_TYPES } from "@/lib/marketing";
import type { CaseStatusConfig } from "@/lib/case-statuses";

const STORAGE_KEY = "casemate.marketing-settings.v1";
export const STORAGE_KEY_MARKETING_SETTINGS = STORAGE_KEY;

// How a case status counts toward a firm's case totals on the Marketing
// page:
//   active → counts in BOTH the Active and Total figures (a live case)
//   total  → counts in Total only (e.g. Paid — completed, not active)
//   none   → excluded entirely (e.g. Dropped — a lost case)
export type MarketingCaseBucket = "active" | "total" | "none";

export interface MarketingSettings {
  visitTypes: string[];
  /** Per-case-status override, keyed by lowercased status name. When a
   *  status isn't listed here, its bucket is derived from defaults. */
  caseBucketByStatus: Record<string, MarketingCaseBucket>;
}

/** Default bucket for a status when the user hasn't set an override. */
export function defaultBucketForStatus(status: Pick<CaseStatusConfig, "name" | "isCaseClosed">): MarketingCaseBucket {
  const name = status.name.toLowerCase();
  if (name.includes("drop")) return "none";
  return status.isCaseClosed ? "total" : "active";
}

/** Resolve a status name to its marketing bucket (override or default). */
export function resolveCaseBucket(
  statusName: string,
  settings: Pick<MarketingSettings, "caseBucketByStatus">,
  caseStatuses: CaseStatusConfig[],
): MarketingCaseBucket {
  const key = statusName.trim().toLowerCase();
  if (!key) return "none";
  const override = settings.caseBucketByStatus[key];
  if (override) return override;
  const cfg = caseStatuses.find((s) => s.name.toLowerCase() === key);
  if (!cfg) return "active"; // unknown status → count as an active case
  return defaultBucketForStatus(cfg);
}

function normalizeVisitTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_MARKETING_VISIT_TYPES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const t = typeof entry === "string" ? entry.trim() : "";
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length ? out : [...DEFAULT_MARKETING_VISIT_TYPES];
}

function normalizeCaseBuckets(value: unknown): Record<string, MarketingCaseBucket> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, MarketingCaseBucket> = {};
  for (const [name, bucket] of Object.entries(value as Record<string, unknown>)) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    if (bucket === "active" || bucket === "total" || bucket === "none") {
      out[key] = bucket;
    }
  }
  return out;
}

export function normalizeMarketingSettings(value: unknown): MarketingSettings {
  const row = (value && typeof value === "object" ? value : {}) as Partial<MarketingSettings>;
  return {
    visitTypes: normalizeVisitTypes(row.visitTypes),
    caseBucketByStatus: normalizeCaseBuckets(row.caseBucketByStatus),
  };
}

export function getDefaultMarketingSettings(): MarketingSettings {
  return { visitTypes: [...DEFAULT_MARKETING_VISIT_TYPES], caseBucketByStatus: {} };
}

export function loadMarketingSettings(): MarketingSettings {
  if (typeof window === "undefined") return getDefaultMarketingSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultMarketingSettings();
    return normalizeMarketingSettings(JSON.parse(raw));
  } catch {
    return getDefaultMarketingSettings();
  }
}

export function saveMarketingSettings(settings: MarketingSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "contacts", settings));
}

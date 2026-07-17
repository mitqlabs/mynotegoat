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

const STORAGE_KEY = "casemate.marketing-settings.v1";
export const STORAGE_KEY_MARKETING_SETTINGS = STORAGE_KEY;

export interface MarketingSettings {
  visitTypes: string[];
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

export function normalizeMarketingSettings(value: unknown): MarketingSettings {
  const row = (value && typeof value === "object" ? value : {}) as Partial<MarketingSettings>;
  return { visitTypes: normalizeVisitTypes(row.visitTypes) };
}

export function getDefaultMarketingSettings(): MarketingSettings {
  return { visitTypes: [...DEFAULT_MARKETING_VISIT_TYPES] };
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

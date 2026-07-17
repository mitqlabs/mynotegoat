/**
 * Marketing / business-development tracker.
 *
 * The office markets to the attorneys who refer them cases — visits,
 * lunch drop-offs, calls, gifts, etc. This module stores those
 * outreach "touches" keyed by the attorney's contact id (the same
 * ContactRecord id from the Contacts directory), so the Marketing page
 * can auto-populate from the Attorney contacts and show each firm's
 * outreach history + when they're due for another visit.
 *
 * Same persistence shape as patient-packages / cash-payments: one blob
 * per workspace in localStorage, dual-written to workspace_kv (namespace
 * "contacts", so it hydrates alongside the contact directory).
 */

import { usDateToIso } from "@/components/us-date-input";

// Visit/activity type is a free string so the office can customize the
// list in Settings → Admin → Marketing. These are the seed defaults.
export type MarketingActivityType = string;

export const DEFAULT_MARKETING_VISIT_TYPES: string[] = [
  "Visit",
  "Lunch Drop-off",
  "Call",
  "Email",
  "Gift",
  "Meeting",
  "Event",
  "Other",
];

export interface MarketingActivity {
  id: string;
  /** ContactRecord id of the attorney this touch was directed at. */
  contactId: string;
  /** US format MM/DD/YYYY. */
  date: string;
  type: MarketingActivityType;
  /** Who from our office did it (optional). */
  repName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type MarketingByContact = Record<string, MarketingActivity[]>;

const STORAGE_KEY = "casemate.marketing.v1";
export const STORAGE_KEY_MARKETING = STORAGE_KEY;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeType(value: unknown): MarketingActivityType {
  return normalizeText(value) || "Visit";
}

function normalizeActivity(value: unknown, contactId: string): MarketingActivity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MarketingActivity>;
  const id = normalizeText(row.id);
  if (!id) return null;
  return {
    id,
    contactId: normalizeText(row.contactId) || contactId,
    date: normalizeText(row.date),
    type: normalizeType(row.type),
    repName: normalizeText(row.repName) || undefined,
    notes: normalizeText(row.notes) || undefined,
    createdAt: normalizeText(row.createdAt) || nowIso(),
    updatedAt: normalizeText(row.updatedAt) || nowIso(),
  };
}

function normalizeMap(value: unknown): MarketingByContact {
  if (!value || typeof value !== "object") return {};
  const out: MarketingByContact = {};
  for (const [contactId, list] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeText(contactId);
    if (!key || !Array.isArray(list)) continue;
    const activities = list
      .map((entry) => normalizeActivity(entry, key))
      .filter((entry): entry is MarketingActivity => Boolean(entry));
    if (activities.length) out[key] = activities;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

export function loadMarketing(): MarketingByContact {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveMarketing(map: MarketingByContact) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "contacts", map));
}

export function createMarketingActivityId() {
  return `MKT-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

/** Sort key: ISO date string (empty dates sort last). */
function isoKey(usDate: string): string {
  const iso = usDateToIso(usDate);
  return iso || "0000-00-00";
}

/** Most-recent activity first. */
export function sortActivitiesDesc(activities: MarketingActivity[]): MarketingActivity[] {
  return [...activities].sort((a, b) => isoKey(b.date).localeCompare(isoKey(a.date)));
}

/** The latest activity for a contact, or null. */
export function latestActivity(activities: MarketingActivity[]): MarketingActivity | null {
  return sortActivitiesDesc(activities)[0] ?? null;
}

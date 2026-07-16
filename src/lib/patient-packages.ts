"use client";

/**
 * Patient packages — the per-patient ASSIGNED record of treatment
 * packages a cash patient has purchased.
 *
 * Distinct from `TreatmentPackage` (in billing-macros.ts) which is
 * the SHOP-LEVEL package TEMPLATE the office offers. When a cash
 * patient buys "Spinal Decompression — Gold (10 visits / $500)",
 * we snapshot the template at purchase time into a PatientPackage
 * row. The snapshot means future edits to the template (renaming,
 * reprice) don't retroactively change what the patient owes or how
 * many visits they're entitled to — the contract is frozen.
 *
 * Storage shape: Record<patientId, PatientPackage[]> in a single
 * localStorage key + dualWriteKv to the "billing" KV namespace,
 * exactly like cash-payments.ts. One blob per workspace; small
 * enough that even with hundreds of patients on packages it stays
 * well under the workspace_kv row size budget.
 */

import type { TreatmentPackageItem } from "@/lib/billing-macros";

export type PatientPackageStatus = "active" | "completed" | "refunded";

/** A partial payment toward a package's price. */
export interface PackagePayment {
  id: string;
  amount: number;
  /** US format MM/DD/YYYY. */
  date: string;
  note?: string;
}

export interface PatientPackage {
  id: string;
  patientId: string;
  /** Original template id — useful for "renew this package" UX
   *  but NOT trusted as the source of pricing/visits. The snapshot
   *  below is the canonical contract. */
  templateId: string;
  /** Frozen snapshot of the template at the moment of purchase. */
  snapshot: {
    name: string;
    totalVisits: number;
    discountedPrice: number;
    items: TreatmentPackageItem[];
    family?: string;
  };
  /** US format MM/DD/YYYY — matches the rest of the patient page. */
  purchaseDate: string;
  /** How many visits have been used. Manual + / - on the row. */
  visitsUsed: number;
  /** Partial payments toward snapshot.discountedPrice. Empty = unpaid. */
  payments: PackagePayment[];
  /** Appointment ids applied to this package (front-desk "apply
   *  appointment to package"). Dedups so one appointment can't
   *  decrement the same package twice. */
  countedAppointmentIds: string[];
  status: PatientPackageStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type PatientPackagesByPatient = Record<string, PatientPackage[]>;

const STORAGE_KEY = "casemate.patient-packages.v1";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return Math.max(0, num);
  }
  return 0;
}

function normalizeStatus(value: unknown): PatientPackageStatus {
  if (value === "completed" || value === "refunded") return value;
  return "active";
}

function normalizeSnapshotItems(value: unknown): TreatmentPackageItem[] {
  if (!Array.isArray(value)) return [];
  const result: TreatmentPackageItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<TreatmentPackageItem>;
    const treatmentId = normalizeText(row.treatmentId).trim();
    const visits = Math.max(0, Math.round(normalizeNumber(row.visits)));
    if (!treatmentId || visits === 0) continue;
    result.push({ treatmentId, visits });
  }
  return result;
}

function normalizePayments(value: unknown): PackagePayment[] {
  if (!Array.isArray(value)) return [];
  const result: PackagePayment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<PackagePayment>;
    const id = normalizeText(row.id).trim();
    const amount = normalizeNumber(row.amount);
    if (!id || amount <= 0) continue;
    result.push({
      id,
      amount,
      date: normalizeText(row.date).trim(),
      note: normalizeText(row.note).trim() || undefined,
    });
  }
  return result;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizePackage(value: unknown): PatientPackage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PatientPackage> & { snapshot?: Partial<PatientPackage["snapshot"]> };
  const id = normalizeText(row.id).trim();
  const patientId = normalizeText(row.patientId).trim();
  const purchaseDate = normalizeText(row.purchaseDate).trim();
  if (!id || !patientId || !purchaseDate) return null;
  const snap: Partial<PatientPackage["snapshot"]> = row.snapshot ?? {};
  const totalVisits = Math.max(0, Math.round(normalizeNumber(snap.totalVisits)));
  const snapshot: PatientPackage["snapshot"] = {
    name: normalizeText(snap.name).trim() || "Untitled package",
    totalVisits,
    discountedPrice: normalizeNumber(snap.discountedPrice),
    items: normalizeSnapshotItems(snap.items),
    family: normalizeText(snap.family).trim() || undefined,
  };
  return {
    id,
    patientId,
    templateId: normalizeText(row.templateId).trim(),
    snapshot,
    purchaseDate,
    visitsUsed: Math.max(0, Math.round(normalizeNumber(row.visitsUsed))),
    payments: normalizePayments(row.payments),
    countedAppointmentIds: normalizeStringArray(row.countedAppointmentIds),
    status: normalizeStatus(row.status),
    note: normalizeText(row.note).trim() || undefined,
    createdAt: normalizeText(row.createdAt) || nowIso(),
    updatedAt: normalizeText(row.updatedAt) || nowIso(),
  };
}

function normalizeMap(value: unknown): PatientPackagesByPatient {
  if (!value || typeof value !== "object") return {};
  const result: PatientPackagesByPatient = {};
  for (const [patientId, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!patientId || !Array.isArray(entries)) continue;
    const cleaned: PatientPackage[] = [];
    for (const entry of entries) {
      const normalized = normalizePackage(entry);
      if (normalized) cleaned.push(normalized);
    }
    if (cleaned.length > 0) result[patientId] = cleaned;
  }
  return result;
}

export function loadPatientPackages(): PatientPackagesByPatient {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function savePatientPackages(map: PatientPackagesByPatient) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "billing", map));
}

export function createPatientPackageId() {
  return `PKG-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

export function createPackagePaymentId() {
  return `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

/** Total paid toward a package across all its partial payments. */
export function sumPackagePayments(pkg: Pick<PatientPackage, "payments">): number {
  return (pkg.payments ?? []).reduce(
    (sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0),
    0,
  );
}

/** Auto-derive status from the visits used vs total. Caller can
 *  override (e.g. mark refunded manually) — this is just the
 *  "should be" status when nothing else is going on. */
export function deriveStatusFromVisits(
  current: PatientPackageStatus,
  visitsUsed: number,
  totalVisits: number,
): PatientPackageStatus {
  // Refunded never auto-flips back.
  if (current === "refunded") return "refunded";
  if (totalVisits > 0 && visitsUsed >= totalVisits) return "completed";
  return "active";
}

export const STORAGE_KEY_PATIENT_PACKAGES = STORAGE_KEY;

"use client";

import type { CashPaymentEntry } from "@/lib/mock-data";

type CashPaymentsByPatient = Record<string, CashPaymentEntry[]>;

const STORAGE_KEY = "casemate.cash-payments.v1";

const paymentTypes: CashPaymentEntry["paymentType"][] = [
  "Cash",
  "Venmo",
  "Zelle",
  "Cash App",
  "Credit Card",
  "Check",
  "Other",
];

export const cashPaymentTypeOptions = paymentTypes;

function createId() {
  return `CASH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return Math.max(0, num);
  }
  return 0;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePaymentType(value: unknown): CashPaymentEntry["paymentType"] {
  if (typeof value !== "string") return "Cash";
  const match = paymentTypes.find((t) => t.toLowerCase() === value.toLowerCase());
  return match ?? "Cash";
}

function normalizeEntry(value: unknown): CashPaymentEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CashPaymentEntry>;
  const id = normalizeText(row.id).trim();
  const date = normalizeText(row.date).trim();
  if (!id || !date) return null;
  return {
    id,
    date,
    amount: normalizeAmount(row.amount),
    paymentType: normalizePaymentType(row.paymentType),
    note: normalizeText(row.note) || undefined,
    createdAt: normalizeText(row.createdAt) || nowIso(),
  };
}

function normalizePayments(value: unknown): CashPaymentsByPatient {
  if (!value || typeof value !== "object") return {};
  const result: CashPaymentsByPatient = {};
  for (const [patientId, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!patientId || !Array.isArray(entries)) continue;
    const cleaned: CashPaymentEntry[] = [];
    for (const entry of entries) {
      const normalized = normalizeEntry(entry);
      if (normalized) cleaned.push(normalized);
    }
    if (cleaned.length > 0) result[patientId] = cleaned;
  }
  return result;
}

export function loadCashPayments(): CashPaymentsByPatient {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizePayments(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveCashPayments(payments: CashPaymentsByPatient) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payments));
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(STORAGE_KEY, "billing", payments),
  );
}

export function createCashPayment(input: {
  date: string;
  amount: number;
  paymentType: CashPaymentEntry["paymentType"];
  note?: string;
}): CashPaymentEntry {
  return {
    id: createId(),
    date: input.date,
    amount: normalizeAmount(input.amount),
    paymentType: input.paymentType,
    note: input.note?.trim() || undefined,
    createdAt: nowIso(),
  };
}

export function sumCashPayments(entries: CashPaymentEntry[] | undefined): number {
  if (!entries || entries.length === 0) return 0;
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

export function formatCashAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

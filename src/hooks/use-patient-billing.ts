"use client";

import { useCallback, useMemo, useState } from "react";
import {
  createPatientBillingRecord,
  loadPatientBillingMap,
  savePatientBillingMap,
  type PatientBillingAdjustment,
  type PatientBillingMap,
  type PatientBillingRecord,
} from "@/lib/patient-billing";
import { logActivity } from "@/lib/activity-log";
import { patients as patientDirectory } from "@/lib/mock-data";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function logBilling(patientId: string, action: string, summary: string, details?: Record<string, unknown>) {
  const patient = patientDirectory.find((p) => p.id === patientId.trim());
  logActivity({
    category: "billing",
    action,
    summary,
    patientId: patientId.trim(),
    patientName: patient?.fullName,
    details,
  });
}

type PatientBillingCorePatch = Partial<Pick<PatientBillingRecord, "billedAmount" | "paidAmount" | "paidDate">>;
type AddPatientBillingAdjustmentDraft = {
  label: string;
  amount: number;
  note?: string;
};
type UpdatePatientBillingAdjustmentPatch = Partial<Pick<PatientBillingAdjustment, "label" | "amount" | "note">>;

function nowIso() {
  return new Date().toISOString();
}

function normalizeMoney(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function toUsDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split("/");
    return `${month}/${day}/20${year}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    return `${month}/${day}/${year}`;
  }
  return "";
}

function createAdjustmentId() {
  return `pbadj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function usePatientBilling() {
  const [recordsByPatientId, setRecordsByPatientId] = useState<PatientBillingMap>(() => loadPatientBillingMap());

  const updateMap = useCallback((updater: (current: PatientBillingMap) => PatientBillingMap) => {
    setRecordsByPatientId((current) => {
      const next = updater(current);
      savePatientBillingMap(next);
      return next;
    });
  }, []);

  const updatePatientRecord = useCallback(
    (patientId: string, updater: (current: PatientBillingRecord) => PatientBillingRecord) => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return;
      }
      updateMap((current) => {
        const existing = current[normalizedPatientId] ?? createPatientBillingRecord(normalizedPatientId);
        const nextRecord = updater(existing);
        return {
          ...current,
          [normalizedPatientId]: {
            ...nextRecord,
            patientId: normalizedPatientId,
            updatedAt: nowIso(),
          },
        };
      });
    },
    [updateMap],
  );

  const getRecord = useCallback(
    (patientId: string) => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return null;
      }
      return recordsByPatientId[normalizedPatientId] ?? null;
    },
    [recordsByPatientId],
  );

  const setCoreFields = useCallback(
    (patientId: string, patch: PatientBillingCorePatch) => {
      // Autosave re-sends these on every save, so only log real changes.
      const before = recordsByPatientId[patientId.trim()] ?? createPatientBillingRecord(patientId.trim());
      if (patch.billedAmount !== undefined && normalizeMoney(patch.billedAmount) !== before.billedAmount) {
        logBilling(patientId, "billing.billed_changed", `Billed ${money(before.billedAmount)} → ${money(normalizeMoney(patch.billedAmount))}`);
      }
      if (patch.paidAmount !== undefined && normalizeMoney(patch.paidAmount) !== before.paidAmount) {
        logBilling(patientId, "billing.paid_changed", `Paid ${money(before.paidAmount)} → ${money(normalizeMoney(patch.paidAmount))}`);
      }
      if (patch.paidDate !== undefined && toUsDate(patch.paidDate) !== before.paidDate) {
        logBilling(patientId, "billing.paid_date_changed", `Paid date ${before.paidDate || "—"} → ${toUsDate(patch.paidDate) || "—"}`);
      }
      updatePatientRecord(patientId, (current) => ({
        ...current,
        billedAmount:
          patch.billedAmount === undefined ? current.billedAmount : normalizeMoney(patch.billedAmount),
        paidAmount: patch.paidAmount === undefined ? current.paidAmount : normalizeMoney(patch.paidAmount),
        paidDate: patch.paidDate === undefined ? current.paidDate : toUsDate(patch.paidDate),
      }));
    },
    [updatePatientRecord, recordsByPatientId],
  );

  const addAdjustment = useCallback(
    (patientId: string, draft: AddPatientBillingAdjustmentDraft) => {
      const normalizedLabel = draft.label.trim();
      if (!normalizedLabel) {
        return false;
      }
      const normalizedAmount = normalizeMoney(draft.amount);
      logBilling(patientId, "billing.adjustment_added", `Added adjustment "${normalizedLabel}" ${money(normalizedAmount)}`);
      updatePatientRecord(patientId, (current) => ({
        ...current,
        adjustments: [
          ...current.adjustments,
          {
            id: createAdjustmentId(),
            label: normalizedLabel,
            amount: normalizedAmount,
            note: draft.note?.trim() ?? "",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          },
        ],
      }));
      return true;
    },
    [updatePatientRecord],
  );

  const updateAdjustment = useCallback(
    (patientId: string, adjustmentId: string, patch: UpdatePatientBillingAdjustmentPatch) => {
      const normalizedAdjustmentId = adjustmentId.trim();
      if (!normalizedAdjustmentId) {
        return;
      }
      updatePatientRecord(patientId, (current) => ({
        ...current,
        adjustments: current.adjustments.map((entry) => {
          if (entry.id !== normalizedAdjustmentId) {
            return entry;
          }
          return {
            ...entry,
            label: patch.label === undefined ? entry.label : patch.label.trim() || entry.label,
            amount: patch.amount === undefined ? entry.amount : normalizeMoney(patch.amount),
            note: patch.note === undefined ? entry.note : patch.note.trim(),
            updatedAt: nowIso(),
          };
        }),
      }));
    },
    [updatePatientRecord],
  );

  const removeAdjustment = useCallback(
    (patientId: string, adjustmentId: string) => {
      const normalizedAdjustmentId = adjustmentId.trim();
      if (!normalizedAdjustmentId) {
        return;
      }
      const removed = recordsByPatientId[patientId.trim()]?.adjustments.find((entry) => entry.id === normalizedAdjustmentId);
      if (removed) {
        logBilling(patientId, "billing.adjustment_removed", `Removed adjustment "${removed.label}" ${money(removed.amount)}`);
      }
      updatePatientRecord(patientId, (current) => ({
        ...current,
        adjustments: current.adjustments.filter((entry) => entry.id !== normalizedAdjustmentId),
      }));
    },
    [updatePatientRecord, recordsByPatientId],
  );

  const removeRecord = useCallback(
    (patientId: string) => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return;
      }
      updateMap((current) => {
        if (!current[normalizedPatientId]) {
          return current;
        }
        const next = { ...current };
        delete next[normalizedPatientId];
        return next;
      });
    },
    [updateMap],
  );

  const totalsByPatientId = useMemo(() => {
    const map = new Map<string, { billed: number; paid: number; adjustments: number; balance: number }>();
    Object.entries(recordsByPatientId).forEach(([patientId, record]) => {
      const adjustments = record.adjustments.reduce((sum, entry) => sum + entry.amount, 0);
      const balance = record.billedAmount - record.paidAmount - adjustments;
      map.set(patientId, {
        billed: record.billedAmount,
        paid: record.paidAmount,
        adjustments,
        balance,
      });
    });
    return map;
  }, [recordsByPatientId]);

  return {
    recordsByPatientId,
    totalsByPatientId,
    getRecord,
    setCoreFields,
    addAdjustment,
    updateAdjustment,
    removeAdjustment,
    removeRecord,
  };
}

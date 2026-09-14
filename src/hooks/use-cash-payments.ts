"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CashPaymentEntry } from "@/lib/mock-data";
import { loadCashPayments, saveCashPayments } from "@/lib/cash-payments";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { logActivity } from "@/lib/activity-log";
import { patients as patientDirectory } from "@/lib/mock-data";

const SYNC_KEY = "casemate.cash-payments.v1";

export function useCashPayments() {
  const [paymentsByPatient, setPaymentsByPatient] = useState(() => loadCashPayments());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(SYNC_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setPaymentsByPatient(loadCashPayments());
    });
  }, []);

  const updatePatientPayments = useCallback(
    (
      patientId: string,
      updater: (current: CashPaymentEntry[]) => CashPaymentEntry[],
    ) => {
      // Describe added / removed payments for the Activity Log.
      const before = paymentsByPatient[patientId] ?? [];
      const after = updater(before);
      const beforeIds = new Set(before.map((p) => p.id));
      const afterIds = new Set(after.map((p) => p.id));
      const patient = patientDirectory.find((p) => p.id === patientId);
      const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
      for (const added of after.filter((p) => !beforeIds.has(p.id))) {
        logActivity({
          category: "billing",
          action: "billing.cash_payment_added",
          summary: `Cash payment ${money(added.amount)} on ${added.date}${added.discount ? ` (${money(added.discount)} off)` : ""}`,
          patientId,
          patientName: patient?.fullName,
        });
      }
      for (const removed of before.filter((p) => !afterIds.has(p.id))) {
        logActivity({
          category: "billing",
          action: "billing.cash_payment_removed",
          summary: `Removed cash payment ${money(removed.amount)} from ${removed.date}`,
          patientId,
          patientName: patient?.fullName,
        });
      }
      setPaymentsByPatient((current) => {
        const existing = current[patientId] ?? [];
        const next = updater(existing);
        const merged = { ...current, [patientId]: next };
        if (next.length === 0) {
          delete merged[patientId];
        }
        saveCashPayments(merged);
        selfWriteCountRef.current++;
        notifyChange(SYNC_KEY);
        return merged;
      });
    },
    [paymentsByPatient],
  );

  return { paymentsByPatient, updatePatientPayments };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CashPaymentEntry } from "@/lib/mock-data";
import { loadCashPayments, saveCashPayments } from "@/lib/cash-payments";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

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
    [],
  );

  return { paymentsByPatient, updatePatientPayments };
}

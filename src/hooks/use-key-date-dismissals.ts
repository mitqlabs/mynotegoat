"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  keyDateDismissalsStorageKey,
  loadKeyDateDismissals,
  saveKeyDateDismissals,
  type KeyDateDismissalSet,
} from "@/lib/key-date-dismissals";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useKeyDateDismissals() {
  const [dismissals, setDismissals] = useState<KeyDateDismissalSet>(() =>
    loadKeyDateDismissals(),
  );
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(keyDateDismissalsStorageKey, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setDismissals(loadKeyDateDismissals());
    });
  }, []);

  const dismissAppointment = useCallback((appointmentId: string) => {
    setDismissals((current) => {
      if (current.has(appointmentId)) return current;
      const next = new Set(current);
      next.add(appointmentId);
      saveKeyDateDismissals(next);
      selfWriteCountRef.current++;
      notifyChange(keyDateDismissalsStorageKey);
      return next;
    });
  }, []);

  const restoreAppointment = useCallback((appointmentId: string) => {
    setDismissals((current) => {
      if (!current.has(appointmentId)) return current;
      const next = new Set(current);
      next.delete(appointmentId);
      saveKeyDateDismissals(next);
      selfWriteCountRef.current++;
      notifyChange(keyDateDismissalsStorageKey);
      return next;
    });
  }, []);

  return { dismissals, dismissAppointment, restoreAppointment };
}

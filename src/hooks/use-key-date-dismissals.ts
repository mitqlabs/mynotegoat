"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  keyDateDismissalsStorageKey,
  loadKeyDateDismissals,
  loadKeyDateDismissalsFromCloud,
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

  // Hydrate from the cloud once on mount. Without this, "Clear" only ever
  // stuck in the browser that clicked it.
  useEffect(() => {
    let cancelled = false;
    void loadKeyDateDismissalsFromCloud().then((merged) => {
      if (cancelled || !merged) return;
      setDismissals((current) => {
        // Only re-render if the cloud actually added something.
        let changed = false;
        for (const id of merged) {
          if (!current.has(id)) {
            changed = true;
            break;
          }
        }
        return changed ? new Set([...current, ...merged]) : current;
      });
    });
    return () => {
      cancelled = true;
    };
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import {
  createKeyDateId,
  getDefaultKeyDates,
  loadKeyDates,
  saveKeyDates,
  type KeyDateOfficeStatus,
  type KeyDateRecord,
} from "@/lib/key-dates";

type KeyDateDraft = {
  startDate: string;
  endDate?: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
};

type AddKeyDateResult =
  | { added: true; keyDate: KeyDateRecord }
  | { added: false; reason: string };

type UpdateKeyDateResult =
  | { updated: true; keyDate: KeyDateRecord }
  | { updated: false; reason: string };

function compareByDate(left: KeyDateRecord, right: KeyDateRecord) {
  if (left.startDate !== right.startDate) {
    return right.startDate.localeCompare(left.startDate);
  }
  if (left.endDate !== right.endDate) {
    return right.endDate.localeCompare(left.endDate);
  }
  return left.id.localeCompare(right.id);
}

function normalizeReason(value: string) {
  return value.trim();
}

export function useKeyDates() {
  const [keyDates, setKeyDates] = useState<KeyDateRecord[]>(() => loadKeyDates());

  // Re-read when another writer updates the cached list (the cloud
  // bootstrap, or the New Appointment modal adding holiday closures).
  useEffect(() => onLocalChange("casemate.key-dates.v1", () => setKeyDates(loadKeyDates())), []);

  const updateKeyDates = useCallback((updater: (current: KeyDateRecord[]) => KeyDateRecord[]) => {
    setKeyDates((current) => {
      const next = updater(current).sort(compareByDate);
      saveKeyDates(next);
      return next;
    });
  }, []);

  const addKeyDate = useCallback(
    (draft: KeyDateDraft): AddKeyDateResult => {
      const startDate = draft.startDate.trim();
      const endDate = (draft.endDate ?? draft.startDate).trim() || startDate;
      const reason = normalizeReason(draft.reason);
      if (!startDate) {
        return { added: false, reason: "Start date is required." };
      }
      if (!endDate) {
        return { added: false, reason: "End date is required." };
      }
      if (endDate < startDate) {
        return { added: false, reason: "End date cannot be before start date." };
      }

      const next: KeyDateRecord = {
        id: createKeyDateId(),
        startDate,
        endDate,
        officeStatus: draft.officeStatus,
        reason,
      };

      updateKeyDates((current) => [...current, next]);
      return { added: true, keyDate: next };
    },
    [updateKeyDates],
  );

  const updateKeyDate = useCallback(
    (id: string, draft: KeyDateDraft): UpdateKeyDateResult => {
      const startDate = draft.startDate.trim();
      const endDate = (draft.endDate ?? draft.startDate).trim() || startDate;
      const reason = normalizeReason(draft.reason);

      if (!startDate) {
        return { updated: false, reason: "Start date is required." };
      }
      if (!endDate) {
        return { updated: false, reason: "End date is required." };
      }
      if (endDate < startDate) {
        return { updated: false, reason: "End date cannot be before start date." };
      }

      let updated: KeyDateRecord | null = null;
      updateKeyDates((current) =>
        current.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }
          updated = {
            ...entry,
            startDate,
            endDate,
            officeStatus: draft.officeStatus,
            reason,
          };
          return updated;
        }),
      );

      if (!updated) {
        return { updated: false, reason: "Key date not found." };
      }
      return { updated: true, keyDate: updated };
    },
    [updateKeyDates],
  );

  const removeKeyDate = useCallback(
    (id: string) => {
      updateKeyDates((current) => current.filter((entry) => entry.id !== id));
    },
    [updateKeyDates],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultKeyDates();
    setKeyDates(defaults);
    saveKeyDates(defaults);
  }, []);

  return {
    keyDates,
    addKeyDate,
    updateKeyDate,
    removeKeyDate,
    resetToDefaults,
  };
}

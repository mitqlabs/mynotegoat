"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDefaultOfficeSettings,
  loadOfficeSettings,
  saveOfficeSettings,
  STORAGE_KEY_OFFICE_SETTINGS,
  type OfficeSettings,
} from "@/lib/office-settings";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useOfficeSettings() {
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(() => loadOfficeSettings());
  const selfWriteCountRef = useRef(0);

  // Keep every mounted instance in sync in REAL TIME. Persisting immediately
  // (below) + reloading here means no instance ever holds stale state, so a
  // later write can't clobber another instance's change. (An earlier
  // debounced version raced: a second instance flushed stale state 400ms
  // later and wiped a just-added office.) Per-keystroke spam is avoided by
  // using <DebouncedInput> for text fields, which commit on a short debounce.
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_OFFICE_SETTINGS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setOfficeSettings(loadOfficeSettings());
    });
  }, []);

  const updateOfficeSettings = useCallback(
    (patch: Partial<OfficeSettings> | ((current: OfficeSettings) => Partial<OfficeSettings>)) => {
      setOfficeSettings((current) => {
        // Resolve against the LATEST state so array edits (locations,
        // doctors) can't clobber concurrent changes with a stale snapshot.
        const resolved = typeof patch === "function" ? patch(current) : patch;
        const next = { ...current, ...resolved };
        saveOfficeSettings(next);
        selfWriteCountRef.current++;
        notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
        return next;
      });
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultOfficeSettings();
    setOfficeSettings(defaults);
    saveOfficeSettings(defaults);
    selfWriteCountRef.current++;
    notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
  }, []);

  return {
    officeSettings,
    updateOfficeSettings,
    resetToDefaults,
  };
}

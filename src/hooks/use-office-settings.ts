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

  // Keep every mounted instance in sync. Without this, two components each
  // holding independent office-settings state would clobber each other's
  // fields on save (each does a full-object {...current, ...patch} write).
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_OFFICE_SETTINGS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setOfficeSettings(loadOfficeSettings());
    });
  }, []);

  const updateOfficeSettings = useCallback((patch: Partial<OfficeSettings>) => {
    setOfficeSettings((current) => {
      const next = { ...current, ...patch };
      saveOfficeSettings(next);
      selfWriteCountRef.current++;
      notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
      return next;
    });
  }, []);

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

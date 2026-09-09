"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDefaultOfficeSettings,
  loadOfficeSettings,
  saveOfficeSettings,
  STORAGE_KEY_OFFICE_SETTINGS,
  type OfficeSettings,
} from "@/lib/office-settings";
import {
  markLocalWrite,
  notifyChange,
  onLocalChange,
  wasRecentlyWrittenLocally,
} from "@/lib/local-sync";

export function useOfficeSettings() {
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(() => loadOfficeSettings());

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_OFFICE_SETTINGS, () => {
      // Ignore reloads while this key is being actively edited on this
      // device — a stale echo would make a just-added office disappear.
      if (wasRecentlyWrittenLocally(STORAGE_KEY_OFFICE_SETTINGS)) return;
      setOfficeSettings(loadOfficeSettings());
    });
  }, []);

  const updateOfficeSettings = useCallback(
    (patch: Partial<OfficeSettings> | ((current: OfficeSettings) => Partial<OfficeSettings>)) => {
      setOfficeSettings((current) => {
        const resolved = typeof patch === "function" ? patch(current) : patch;
        const next = { ...current, ...resolved };
        markLocalWrite(STORAGE_KEY_OFFICE_SETTINGS);
        saveOfficeSettings(next);
        notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
        return next;
      });
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultOfficeSettings();
    markLocalWrite(STORAGE_KEY_OFFICE_SETTINGS);
    setOfficeSettings(defaults);
    saveOfficeSettings(defaults);
    notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
  }, []);

  return {
    officeSettings,
    updateOfficeSettings,
    resetToDefaults,
  };
}

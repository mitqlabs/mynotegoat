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

// While the user is actively editing, incoming syncs (a cross-instance
// notify, or a realtime echo of our own cloud write bouncing back) must NOT
// reload and overwrite what they just typed/added. We treat local edits as
// authoritative for a short window after each keystroke-commit.
const EDIT_AUTHORITY_MS = 4000;

export function useOfficeSettings() {
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(() => loadOfficeSettings());
  const lastEditRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_OFFICE_SETTINGS, () => {
      // Ignore echoes while this instance is actively editing — otherwise a
      // stale round-trip makes a just-added office/character disappear and
      // bounce back.
      if (Date.now() - lastEditRef.current < EDIT_AUTHORITY_MS) return;
      setOfficeSettings(loadOfficeSettings());
    });
  }, []);

  const updateOfficeSettings = useCallback(
    (patch: Partial<OfficeSettings> | ((current: OfficeSettings) => Partial<OfficeSettings>)) => {
      setOfficeSettings((current) => {
        const resolved = typeof patch === "function" ? patch(current) : patch;
        const next = { ...current, ...resolved };
        lastEditRef.current = Date.now();
        saveOfficeSettings(next);
        notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
        return next;
      });
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultOfficeSettings();
    lastEditRef.current = Date.now();
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

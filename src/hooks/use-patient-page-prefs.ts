"use client";

import { useCallback, useState } from "react";
import {
  getDefaultPatientPagePrefs,
  loadPatientPagePrefs,
  savePatientPagePrefs,
  type PatientPagePanelKey,
  type PatientPagePrefs,
} from "@/lib/patient-page-prefs";

export function usePatientPagePrefs() {
  const [prefs, setPrefs] = useState<PatientPagePrefs>(() => loadPatientPagePrefs());

  const setDefaultOpen = useCallback((panel: PatientPagePanelKey, value: boolean) => {
    setPrefs((current) => {
      const next: PatientPagePrefs = {
        ...current,
        defaultOpen: { ...current.defaultOpen, [panel]: value },
      };
      savePatientPagePrefs(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultPatientPagePrefs();
    setPrefs(defaults);
    savePatientPagePrefs(defaults);
  }, []);

  return {
    patientPagePrefs: prefs,
    setPatientPageDefaultOpen: setDefaultOpen,
    resetPatientPagePrefs: resetToDefaults,
  };
}

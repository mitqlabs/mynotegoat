"use client";

import { useCallback, useState } from "react";
import {
  getDefaultPatientPagePrefs,
  loadPatientPagePrefs,
  savePatientPagePrefs,
  type PatientPagePanelKey,
  type PatientPagePrefs,
  type PatientPageSectionMode,
} from "@/lib/patient-page-prefs";

export function usePatientPagePrefs() {
  const [prefs, setPrefs] = useState<PatientPagePrefs>(() => loadPatientPagePrefs());

  const setSectionMode = useCallback(
    (panel: PatientPagePanelKey, value: PatientPageSectionMode) => {
      setPrefs((current) => {
        const next: PatientPagePrefs = {
          ...current,
          mode: { ...current.mode, [panel]: value },
        };
        savePatientPagePrefs(next);
        return next;
      });
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultPatientPagePrefs();
    setPrefs(defaults);
    savePatientPagePrefs(defaults);
  }, []);

  return {
    patientPagePrefs: prefs,
    setPatientPageSectionMode: setSectionMode,
    resetPatientPagePrefs: resetToDefaults,
  };
}

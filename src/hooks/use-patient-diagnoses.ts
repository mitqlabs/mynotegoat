"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PATIENT_DIAGNOSES_STORAGE_KEY,
  addDiagnosesToList,
  loadPatientDiagnosesMap,
  savePatientDiagnosesMap,
  type PatientDiagnosisEntry,
} from "@/lib/patient-diagnoses";
import { markLocalWrite, notifyChange, onLocalChange } from "@/lib/local-sync";

type DiagnosisMap = Record<string, PatientDiagnosisEntry[]>;

/**
 * A patient's diagnosis list. Stays live: a change from another component on
 * this page (e.g. the Encounter's G.O.A.T. panel), another tab, or another
 * device (GlobalKvRealtime writes localStorage and fires notifyChange) is
 * picked up without a reload, so everything that reads `entries` (the table,
 * the search's "Added" state, G.O.A.T.'s MRI suggestions) reflects what's on
 * screen.
 *
 * Writes are computed synchronously against the latest map (a ref), so the
 * return values of addDiagnosis / addBulkDiagnoses are real — not the result
 * of a setState updater React may run later.
 */
export function usePatientDiagnoses(patientId: string) {
  const [diagnosisMap, setDiagnosisMap] = useState<DiagnosisMap>(() => loadPatientDiagnosesMap());
  const mapRef = useRef(diagnosisMap);

  useEffect(() => {
    const reload = () => {
      const fresh = loadPatientDiagnosesMap();
      if (JSON.stringify(fresh) === JSON.stringify(mapRef.current)) return;
      mapRef.current = fresh;
      setDiagnosisMap(fresh);
    };
    const off = onLocalChange(PATIENT_DIAGNOSES_STORAGE_KEY, reload);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PATIENT_DIAGNOSES_STORAGE_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      off();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const entries = useMemo(() => diagnosisMap[patientId] ?? [], [diagnosisMap, patientId]);

  /** Apply `updater` to this patient's list now; returns whether it changed. */
  const update = useCallback(
    (updater: (current: PatientDiagnosisEntry[]) => PatientDiagnosisEntry[]) => {
      const currentMap = mapRef.current;
      const currentEntries = currentMap[patientId] ?? [];
      const nextEntries = updater(currentEntries);
      if (nextEntries === currentEntries) return false;
      const nextMap = { ...currentMap, [patientId]: nextEntries };
      mapRef.current = nextMap;
      markLocalWrite(PATIENT_DIAGNOSES_STORAGE_KEY);
      savePatientDiagnosesMap(nextMap);
      setDiagnosisMap(nextMap);
      notifyChange(PATIENT_DIAGNOSES_STORAGE_KEY);
      return true;
    },
    [patientId],
  );

  /** Adds one code. Returns false if it's invalid or the code is already on the patient. */
  const addDiagnosis = useCallback(
    (code: string, description: string, source = "Manual") => {
      let added = 0;
      update((current) => {
        const result = addDiagnosesToList(current, [{ code, description, source }], "Manual");
        added = result.added;
        return result.entries;
      });
      return added > 0;
    },
    [update],
  );

  /** Adds several codes (a bundle); codes already on the patient are skipped. Returns how many were added. */
  const addBulkDiagnoses = useCallback(
    (items: Array<{ code: string; description: string; source?: string }>) => {
      if (!items.length) return 0;
      let added = 0;
      update((current) => {
        const result = addDiagnosesToList(current, items, "Bundle");
        added = result.added;
        return result.entries;
      });
      return added;
    },
    [update],
  );

  const removeDiagnosis = useCallback(
    (id: string) => {
      update((current) => {
        const next = current.filter((entry) => entry.id !== id);
        return next.length === current.length ? current : next;
      });
    },
    [update],
  );

  const reorderDiagnoses = useCallback(
    (fromIndex: number, toIndex: number) => {
      update((current) => {
        if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) {
          return current;
        }
        const next = [...current];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [update],
  );

  return {
    entries,
    addDiagnosis,
    addBulkDiagnoses,
    removeDiagnosis,
    reorderDiagnoses,
  };
}

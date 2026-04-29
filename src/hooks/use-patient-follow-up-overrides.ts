"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPatientFollowUpOverrideRecord,
  hasAnyFollowUpOverrideFlags,
  loadPatientFollowUpOverridesMap,
  savePatientFollowUpOverridesMap,
  type FollowUpCategoryOverrideFlags,
  type FollowUpOverrideCategory,
  type PatientFollowUpOverrideMap,
  type PatientFollowUpOverrideRecord,
} from "@/lib/patient-follow-up-overrides";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

const SYNC_KEY = "casemate.patient-follow-up-overrides.v1";

type FollowUpOverrideCategoryPatch = Partial<FollowUpCategoryOverrideFlags>;

function nowIso() {
  return new Date().toISOString();
}

export function usePatientFollowUpOverrides() {
  const [recordsByPatientId, setRecordsByPatientId] = useState<PatientFollowUpOverrideMap>(() =>
    loadPatientFollowUpOverridesMap(),
  );

  const selfWriteCountRef = useRef(0);
  // Mirror of the latest committed map so updateMap can compute `next`
  // synchronously (outside React's batched setState updater). Without
  // this, the cloud-write promise was created INSIDE the setState
  // updater — which runs asynchronously — but the awaitable setters
  // resolved against a stale ref captured BEFORE the updater fired.
  // Result: the patient page's "Saved ✓" pill flipped green before the
  // cloud write actually started, the user trusted the green, and a
  // refresh-with-failed-cloud-write wiped every toggle. This ref makes
  // the save synchronous so the returned promise is the real one.
  const recordsRef = useRef(recordsByPatientId);

  // Listen for changes made by other hook instances on this page
  useEffect(() => {
    return onLocalChange(SYNC_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      const fresh = loadPatientFollowUpOverridesMap();
      recordsRef.current = fresh;
      setRecordsByPatientId(fresh);
    });
  }, []);

  // Performs the save synchronously and returns the actual cloud-write
  // promise. The caller (setPatientRefusedAsync, etc.) awaits THIS
  // promise — not a stale ref captured before React's batch fires.
  const updateMap = useCallback(
    (updater: (current: PatientFollowUpOverrideMap) => PatientFollowUpOverrideMap): Promise<void> => {
      const current = recordsRef.current;
      const next = updater(current);
      // Update ref first so any subsequent rapid call (user clicking 2
      // checkboxes back-to-back) sees the just-committed value.
      recordsRef.current = next;
      // localStorage write + cloud dual-write happen here, OUTSIDE the
      // React batch. The returned promise IS the cloud-write; the
      // patient-page await on it is meaningful now.
      const cloudWrite = savePatientFollowUpOverridesMap(next);
      // Now schedule the React re-render so the UI reflects the new
      // map. selfWriteCountRef tells the local-sync listener to skip
      // its own re-load (we already have the truth).
      selfWriteCountRef.current++;
      setRecordsByPatientId(next);
      notifyChange(SYNC_KEY);
      return cloudWrite;
    },
    [],
  );

  const getRecord = useCallback(
    (patientId: string): PatientFollowUpOverrideRecord => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return createPatientFollowUpOverrideRecord("");
      }
      return recordsByPatientId[normalizedPatientId] ?? createPatientFollowUpOverrideRecord(normalizedPatientId);
    },
    [recordsByPatientId],
  );

  const setCategoryFlags = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, patch: FollowUpOverrideCategoryPatch): Promise<void> => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return Promise.resolve();
      }
      return updateMap((current) => {
        const base = current[normalizedPatientId] ?? createPatientFollowUpOverrideRecord(normalizedPatientId);
        const nextCategory: FollowUpCategoryOverrideFlags = {
          patientRefused:
            patch.patientRefused === undefined ? base[category].patientRefused : Boolean(patch.patientRefused),
          completedPriorCare:
            patch.completedPriorCare === undefined
              ? base[category].completedPriorCare
              : Boolean(patch.completedPriorCare),
          notNeeded:
            patch.notNeeded === undefined ? base[category].notNeeded : Boolean(patch.notNeeded),
        };
        const nextRecord: PatientFollowUpOverrideRecord = {
          ...base,
          [category]: nextCategory,
          updatedAt: nowIso(),
        };

        if (!hasAnyFollowUpOverrideFlags(nextRecord)) {
          if (!current[normalizedPatientId]) {
            return current;
          }
          const next = { ...current };
          delete next[normalizedPatientId];
          return next;
        }

        return {
          ...current,
          [normalizedPatientId]: nextRecord,
        };
      });
    },
    [updateMap],
  );

  // Fire-and-forget variants for callers that don't need confirmation.
  // We swallow the rejection here so an offline / failed cloud write
  // doesn't surface as an unhandled-rejection log; callers that NEED to
  // detect failure should use the *Async variants below.
  const setPatientRefused = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) => {
      setCategoryFlags(patientId, category, { patientRefused: enabled }).catch(() => {});
    },
    [setCategoryFlags],
  );

  const setCompletedPriorCare = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) => {
      setCategoryFlags(patientId, category, { completedPriorCare: enabled }).catch(() => {});
    },
    [setCategoryFlags],
  );

  const setNotNeeded = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) => {
      setCategoryFlags(patientId, category, { notNeeded: enabled }).catch(() => {});
    },
    [setCategoryFlags],
  );

  // Awaitable variants — same setter, but the returned promise IS the
  // actual cloud write (not a stale ref). The patient page awaits this
  // before flipping the "Saved ✓" pill so the green is only ever shown
  // when the cloud has actually accepted the write. If supabase rejects
  // (RLS, network, anything), this rejects and the page shows a sticky
  // red "did NOT save to cloud" pill instead.
  const setPatientRefusedAsync = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) =>
      setCategoryFlags(patientId, category, { patientRefused: enabled }),
    [setCategoryFlags],
  );

  const setCompletedPriorCareAsync = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) =>
      setCategoryFlags(patientId, category, { completedPriorCare: enabled }),
    [setCategoryFlags],
  );

  const setNotNeededAsync = useCallback(
    (patientId: string, category: FollowUpOverrideCategory, enabled: boolean) =>
      setCategoryFlags(patientId, category, { notNeeded: enabled }),
    [setCategoryFlags],
  );

  const clearPatientOverrides = useCallback(
    (patientId: string) => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) {
        return;
      }
      updateMap((current) => {
        if (!current[normalizedPatientId]) {
          return current;
        }
        const next = { ...current };
        delete next[normalizedPatientId];
        return next;
      }).catch(() => {});
    },
    [updateMap],
  );

  return {
    recordsByPatientId,
    getRecord,
    setCategoryFlags,
    setPatientRefused,
    setCompletedPriorCare,
    setNotNeeded,
    setPatientRefusedAsync,
    setCompletedPriorCareAsync,
    setNotNeededAsync,
    clearPatientOverrides,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTreatmentPlanSettings,
  saveTreatmentPlanSettings,
  STORAGE_KEY_TREATMENT_PLAN_SETTINGS,
  type TreatmentPlanSettings,
} from "@/lib/treatment-plan-settings";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useTreatmentPlanSettings() {
  const [settings, setSettings] = useState<TreatmentPlanSettings>(() =>
    loadTreatmentPlanSettings(),
  );
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_TREATMENT_PLAN_SETTINGS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setSettings(loadTreatmentPlanSettings());
    });
  }, []);

  const persist = useCallback((next: TreatmentPlanSettings) => {
    saveTreatmentPlanSettings(next);
    selfWriteCountRef.current++;
    notifyChange(STORAGE_KEY_TREATMENT_PLAN_SETTINGS);
    return next;
  }, []);

  // Add/remove a single Plan macro as a region.
  const toggleRegion = useCallback(
    (macroId: string, on: boolean) => {
      setSettings((current) => {
        const has = current.regionMacroIds.includes(macroId);
        if (on === has) return current;
        const regionMacroIds = on
          ? [...current.regionMacroIds, macroId]
          : current.regionMacroIds.filter((id) => id !== macroId);
        return persist({ ...current, regionMacroIds });
      });
    },
    [persist],
  );

  // Bulk add/remove (e.g. a whole folder's macros at once).
  const setRegionMembership = useCallback(
    (macroIds: string[], on: boolean) => {
      setSettings((current) => {
        const set = new Set(current.regionMacroIds);
        for (const id of macroIds) {
          if (on) set.add(id);
          else set.delete(id);
        }
        return persist({ ...current, regionMacroIds: [...set] });
      });
    },
    [persist],
  );

  const setToggle = useCallback(
    (key: "planOverridesSalt" | "saltConfirmsReplace", value: boolean) => {
      setSettings((current) => persist({ ...current, [key]: value }));
    },
    [persist],
  );

  return { settings, toggleRegion, setRegionMembership, setToggle };
}

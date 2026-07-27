"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRegionId,
  loadTreatmentPlanSettings,
  saveTreatmentPlanSettings,
  STORAGE_KEY_TREATMENT_PLAN_SETTINGS,
  type TreatmentPlanRegion,
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

  const addRegion = useCallback(
    (name: string, macroId: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setSettings((current) =>
        persist({
          ...current,
          regions: [...current.regions, { id: createRegionId(), name: trimmed, macroId }],
        }),
      );
    },
    [persist],
  );

  const updateRegion = useCallback(
    (id: string, patch: Partial<Omit<TreatmentPlanRegion, "id">>) => {
      setSettings((current) =>
        persist({
          ...current,
          regions: current.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }),
      );
    },
    [persist],
  );

  const removeRegion = useCallback(
    (id: string) => {
      setSettings((current) =>
        persist({ ...current, regions: current.regions.filter((r) => r.id !== id) }),
      );
    },
    [persist],
  );

  const moveRegion = useCallback(
    (from: number, to: number) => {
      setSettings((current) => {
        if (to < 0 || to >= current.regions.length) return current;
        const regions = [...current.regions];
        const [moved] = regions.splice(from, 1);
        regions.splice(to, 0, moved);
        return persist({ ...current, regions });
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

  return { settings, addRegion, updateRegion, removeRegion, moveRegion, setToggle };
}

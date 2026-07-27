"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTreatmentPlanId,
  loadTreatmentPlans,
  saveTreatmentPlans,
  STORAGE_KEY_TREATMENT_PLANS,
  type TreatmentPlan,
  type TreatmentPlansByPatient,
  type WeekdayRegion,
} from "@/lib/treatment-plans";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

function nowIso() {
  return new Date().toISOString();
}

export function useTreatmentPlans() {
  const [plansByPatient, setPlansByPatient] = useState<TreatmentPlansByPatient>(() =>
    loadTreatmentPlans(),
  );
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_TREATMENT_PLANS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setPlansByPatient(loadTreatmentPlans());
    });
  }, []);

  const updatePatientList = useCallback(
    (patientId: string, updater: (current: TreatmentPlan[]) => TreatmentPlan[]) => {
      const key = patientId.trim();
      if (!key) return;
      setPlansByPatient((current) => {
        const existing = current[key] ?? [];
        const next = updater(existing);
        if (next === existing) return current;
        const map: TreatmentPlansByPatient = { ...current };
        if (next.length === 0) delete map[key];
        else map[key] = next;
        saveTreatmentPlans(map);
        selfWriteCountRef.current++;
        notifyChange(STORAGE_KEY_TREATMENT_PLANS);
        return map;
      });
    },
    [],
  );

  const getPlansForPatient = useCallback(
    (patientId: string): TreatmentPlan[] => plansByPatient[patientId.trim()] ?? [],
    [plansByPatient],
  );

  const addPlan = useCallback(
    (patientId: string, input: { startDate: string; endDate: string }): TreatmentPlan | null => {
      const key = patientId.trim();
      if (!key) return null;
      const ts = nowIso();
      const plan: TreatmentPlan = {
        id: createTreatmentPlanId(),
        patientId: key,
        startDate: input.startDate.trim(),
        endDate: input.endDate.trim(),
        days: {},
        active: true,
        createdAt: ts,
        updatedAt: ts,
      };
      updatePatientList(key, (current) => [plan, ...current]);
      return plan;
    },
    [updatePatientList],
  );

  const updatePlan = useCallback(
    (patientId: string, planId: string, patch: Partial<Omit<TreatmentPlan, "id" | "patientId" | "createdAt">>) => {
      updatePatientList(patientId, (current) =>
        current.map((p) => (p.id === planId ? { ...p, ...patch, updatedAt: nowIso() } : p)),
      );
    },
    [updatePatientList],
  );

  const removePlan = useCallback(
    (patientId: string, planId: string) => {
      updatePatientList(patientId, (current) => current.filter((p) => p.id !== planId));
    },
    [updatePatientList],
  );

  // Copy one weekday's regions/treatments onto another weekday of the same
  // plan (e.g. Monday → Wednesday). Deep-copied so the two days stay
  // independent; overwrites the target day.
  const copyDayRegions = useCallback(
    (patientId: string, planId: string, fromWeekday: number, toWeekday: number) => {
      if (fromWeekday === toWeekday) return;
      updatePatientList(patientId, (current) =>
        current.map((p) => {
          if (p.id !== planId) return p;
          const source = (p.days[fromWeekday] ?? []).map((r) => ({
            macroId: r.macroId,
            treatments: [...r.treatments],
            ...(r.answers
              ? {
                  answers: Object.fromEntries(
                    Object.entries(r.answers).map(([k, v]) => [k, [...v]]),
                  ),
                }
              : {}),
          }));
          const days = { ...p.days };
          if (source.length) days[toWeekday] = source;
          else delete days[toWeekday];
          return { ...p, days, updatedAt: nowIso() };
        }),
      );
    },
    [updatePatientList],
  );

  // Set the regions (with treatments) for one weekday of a plan.
  const setDayRegions = useCallback(
    (patientId: string, planId: string, weekday: number, regions: WeekdayRegion[]) => {
      updatePatientList(patientId, (current) =>
        current.map((p) => {
          if (p.id !== planId) return p;
          const days = { ...p.days };
          const cleaned = regions.filter((r) => r.macroId);
          if (cleaned.length) days[weekday] = cleaned;
          else delete days[weekday];
          return { ...p, days, updatedAt: nowIso() };
        }),
      );
    },
    [updatePatientList],
  );

  return { plansByPatient, getPlansForPatient, addPlan, updatePlan, removePlan, copyDayRegions, setDayRegions };
}

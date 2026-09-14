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
import { logActivity } from "@/lib/activity-log";
import { patients as patientDirectory } from "@/lib/mock-data";

function logPlan(patientId: string, action: string, summary: string) {
  const patient = patientDirectory.find((p) => p.id === patientId.trim());
  logActivity({ category: "treatmentPlans", action, summary, patientId: patientId.trim(), patientName: patient?.fullName });
}

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
      logPlan(key, "plan.created", `Created treatment plan ${plan.startDate} – ${plan.endDate}`);
      return plan;
    },
    [updatePatientList],
  );

  const updatePlan = useCallback(
    (patientId: string, planId: string, patch: Partial<Omit<TreatmentPlan, "id" | "patientId" | "createdAt">>) => {
      // Log the plan-level changes that matter (dates, on/off). Treatment
      // picks change click-by-click while editing, so they aren't logged.
      const before = (plansByPatient[patientId.trim()] ?? []).find((p) => p.id === planId);
      if (before) {
        const nextStart = patch.startDate ?? before.startDate;
        const nextEnd = patch.endDate ?? before.endDate;
        if (nextStart !== before.startDate || nextEnd !== before.endDate) {
          logPlan(patientId, "plan.dates_changed", `Treatment plan dates ${before.startDate} – ${before.endDate} → ${nextStart} – ${nextEnd}`);
        }
        if (patch.active !== undefined && patch.active !== before.active) {
          logPlan(patientId, patch.active ? "plan.activated" : "plan.deactivated", `${patch.active ? "Activated" : "Deactivated"} treatment plan ${before.startDate} – ${before.endDate}`);
        }
      }
      updatePatientList(patientId, (current) =>
        current.map((p) => (p.id === planId ? { ...p, ...patch, updatedAt: nowIso() } : p)),
      );
    },
    [updatePatientList, plansByPatient],
  );

  const removePlan = useCallback(
    (patientId: string, planId: string) => {
      const removed = (plansByPatient[patientId.trim()] ?? []).find((p) => p.id === planId);
      if (removed) logPlan(patientId, "plan.deleted", `Deleted treatment plan ${removed.startDate} – ${removed.endDate}`);
      updatePatientList(patientId, (current) => current.filter((p) => p.id !== planId));
    },
    [updatePatientList, plansByPatient],
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

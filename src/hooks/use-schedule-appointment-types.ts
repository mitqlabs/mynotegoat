"use client";

import { useCallback, useState } from "react";
import {
  getDefaultAppointmentTypes,
  loadAppointmentTypes,
  saveAppointmentTypes,
  type AppointmentTypeConfig,
} from "@/lib/schedule-appointment-types";

function createTypeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `apt-type-${crypto.randomUUID()}`;
  }
  return `apt-type-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDuration(value: number) {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.max(5, Math.min(720, Math.round(value)));
}

export function useScheduleAppointmentTypes() {
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentTypeConfig[]>(() =>
    loadAppointmentTypes(),
  );

  const updateTypes = useCallback(
    (updater: (current: AppointmentTypeConfig[]) => AppointmentTypeConfig[]) => {
      setAppointmentTypes((current) => {
        const next = updater(current);
        saveAppointmentTypes(next);
        return next;
      });
    },
    [],
  );

  const addAppointmentType = useCallback(
    (
      name: string,
      color: string,
      durationMin: number,
      isDefault: boolean,
      patientTypes: AppointmentTypeConfig["patientTypes"] = { pi: true, cash: true },
    ) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return false;
      }

      let added = false;

      updateTypes((current) => {
        const exists = current.some((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase());
        if (exists) {
          return current;
        }
        added = true;
        const nextType: AppointmentTypeConfig = {
          id: createTypeId(),
          name: normalizedName,
          color,
          durationMin: normalizeDuration(durationMin),
          isDefault,
          patientTypes,
        };
        if (isDefault) {
          return [...current.map((entry) => ({ ...entry, isDefault: false })), nextType];
        }
        return [...current, nextType];
      });

      return added;
    },
    [updateTypes],
  );

  const updateAppointmentType = useCallback(
    (
      typeId: string,
      updates: Partial<{
        name: string;
        color: string;
        durationMin: number;
        patientTypes: AppointmentTypeConfig["patientTypes"];
      }>,
    ) => {
      updateTypes((current) =>
        current.map((entry) => {
          if (entry.id !== typeId) {
            return entry;
          }

          const nextNameRaw = updates.name !== undefined ? updates.name.trim() : entry.name;
          const nextName = nextNameRaw || entry.name;
          const hasDuplicateName = current.some(
            (candidate) =>
              candidate.id !== typeId && candidate.name.toLowerCase() === nextName.toLowerCase(),
          );

          return {
            ...entry,
            ...(hasDuplicateName ? {} : { name: nextName }),
            ...(updates.color !== undefined ? { color: updates.color } : {}),
            ...(updates.durationMin !== undefined
              ? { durationMin: normalizeDuration(updates.durationMin) }
              : {}),
            ...(updates.patientTypes !== undefined ? { patientTypes: updates.patientTypes } : {}),
          };
        }),
      );
    },
    [updateTypes],
  );

  const setDefaultAppointmentType = useCallback(
    (typeId: string) => {
      updateTypes((current) =>
        current.map((entry) => ({
          ...entry,
          isDefault: entry.id === typeId,
        })),
      );
    },
    [updateTypes],
  );

  const removeAppointmentType = useCallback(
    (typeId: string) => {
      updateTypes((current) => {
        const next = current.filter((entry) => entry.id !== typeId);
        if (!next.length) {
          return current;
        }
        if (!next.some((entry) => entry.isDefault)) {
          return next.map((entry, index) => ({ ...entry, isDefault: index === 0 }));
        }
        return next;
      });
    },
    [updateTypes],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultAppointmentTypes();
    setAppointmentTypes(defaults);
    saveAppointmentTypes(defaults);
  }, []);

  return {
    appointmentTypes,
    addAppointmentType,
    updateAppointmentType,
    setDefaultAppointmentType,
    removeAppointmentType,
    resetToDefaults,
  };
}

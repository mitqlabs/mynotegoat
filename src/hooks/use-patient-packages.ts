"use client";

/**
 * React hook for managing patient packages.
 *
 * Same shape as use-cash-payments: holds a Record<patientId,
 * PatientPackage[]> in state, hydrates from localStorage on mount,
 * dual-writes every change through savePatientPackages (which
 * writes localStorage + dualWriteKv to the "billing" KV
 * namespace), and listens for both same-page (onLocalChange) and
 * cross-device (GlobalKvRealtime, mounted in the portal layout)
 * notifications so the React state stays in sync with cloud.
 *
 * Methods:
 *   - assignPackage    — record that a patient bought a template
 *   - updatePackage    — patch any field on an existing assignment
 *   - removePackage    — delete an assignment
 *   - incrementVisits  — +1 to visits used, auto-flip to completed
 *   - decrementVisits  — -1, never below zero, auto-flip back to active
 *   - setStatus        — explicit status override (e.g. refunded)
 *
 * `assignPackage` accepts the live TreatmentPackage template and
 * snapshots it at the moment of assignment, so future template
 * edits don't retroactively change this patient's contract.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPatientPackageId,
  deriveStatusFromVisits,
  loadPatientPackages,
  savePatientPackages,
  STORAGE_KEY_PATIENT_PACKAGES,
  type PatientPackage,
  type PatientPackageStatus,
  type PatientPackagesByPatient,
} from "@/lib/patient-packages";
import type { TreatmentPackage } from "@/lib/billing-macros";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

function nowIso() {
  return new Date().toISOString();
}

function formatUsDateNow(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const y = now.getFullYear();
  return `${m}/${d}/${y}`;
}

export function usePatientPackages() {
  const [packagesByPatient, setPackagesByPatient] = useState<PatientPackagesByPatient>(
    () => loadPatientPackages(),
  );
  const selfWriteCountRef = useRef(0);

  // Listen for changes from other hook instances OR from the
  // GlobalKvRealtime listener (cross-device sync). selfWriteCount
  // skips notifications we generated ourselves so we don't fire a
  // redundant setState that React would no-op anyway.
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_PATIENT_PACKAGES, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setPackagesByPatient(loadPatientPackages());
    });
  }, []);

  const updatePatientList = useCallback(
    (patientId: string, updater: (current: PatientPackage[]) => PatientPackage[]) => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) return;
      setPackagesByPatient((current) => {
        const existing = current[normalizedPatientId] ?? [];
        const next = updater(existing);
        // If nothing changed, return the original map reference so
        // React skips the re-render.
        if (next === existing) return current;
        const map: PatientPackagesByPatient = { ...current };
        if (next.length === 0) {
          delete map[normalizedPatientId];
        } else {
          map[normalizedPatientId] = next;
        }
        savePatientPackages(map);
        selfWriteCountRef.current++;
        notifyChange(STORAGE_KEY_PATIENT_PACKAGES);
        return map;
      });
    },
    [],
  );

  const assignPackage = useCallback(
    (input: {
      patientId: string;
      template: TreatmentPackage;
      purchaseDate?: string;
      note?: string;
    }): PatientPackage | null => {
      const patientId = input.patientId.trim();
      if (!patientId) return null;
      const purchaseDate = (input.purchaseDate ?? "").trim() || formatUsDateNow();
      const timestamp = nowIso();
      const record: PatientPackage = {
        id: createPatientPackageId(),
        patientId,
        templateId: input.template.id,
        snapshot: {
          name: input.template.name,
          totalVisits: input.template.totalVisits,
          discountedPrice: input.template.discountedPrice,
          items: input.template.items.map((item) => ({ ...item })),
          family: input.template.family,
        },
        purchaseDate,
        visitsUsed: 0,
        status: "active",
        note: input.note?.trim() || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      updatePatientList(patientId, (current) => [record, ...current]);
      return record;
    },
    [updatePatientList],
  );

  const updatePackage = useCallback(
    (
      patientId: string,
      packageId: string,
      patch: Partial<Omit<PatientPackage, "id" | "patientId" | "createdAt">>,
    ) => {
      updatePatientList(patientId, (current) =>
        current.map((entry) => {
          if (entry.id !== packageId) return entry;
          return {
            ...entry,
            ...patch,
            // Always re-derive status from visits unless the caller
            // explicitly set it (e.g. refunded). Keeps active /
            // completed transitions automatic.
            status: deriveStatusFromVisits(
              patch.status ?? entry.status,
              patch.visitsUsed ?? entry.visitsUsed,
              patch.snapshot?.totalVisits ?? entry.snapshot.totalVisits,
            ),
            updatedAt: nowIso(),
          };
        }),
      );
    },
    [updatePatientList],
  );

  const removePackage = useCallback(
    (patientId: string, packageId: string) => {
      updatePatientList(patientId, (current) =>
        current.filter((entry) => entry.id !== packageId),
      );
    },
    [updatePatientList],
  );

  const incrementVisits = useCallback(
    (patientId: string, packageId: string) => {
      updatePatientList(patientId, (current) =>
        current.map((entry) => {
          if (entry.id !== packageId) return entry;
          const nextUsed = entry.visitsUsed + 1;
          return {
            ...entry,
            visitsUsed: nextUsed,
            status: deriveStatusFromVisits(entry.status, nextUsed, entry.snapshot.totalVisits),
            updatedAt: nowIso(),
          };
        }),
      );
    },
    [updatePatientList],
  );

  const decrementVisits = useCallback(
    (patientId: string, packageId: string) => {
      updatePatientList(patientId, (current) =>
        current.map((entry) => {
          if (entry.id !== packageId) return entry;
          const nextUsed = Math.max(0, entry.visitsUsed - 1);
          return {
            ...entry,
            visitsUsed: nextUsed,
            status: deriveStatusFromVisits(entry.status, nextUsed, entry.snapshot.totalVisits),
            updatedAt: nowIso(),
          };
        }),
      );
    },
    [updatePatientList],
  );

  const setStatus = useCallback(
    (patientId: string, packageId: string, status: PatientPackageStatus) => {
      updatePatientList(patientId, (current) =>
        current.map((entry) => {
          if (entry.id !== packageId) return entry;
          return { ...entry, status, updatedAt: nowIso() };
        }),
      );
    },
    [updatePatientList],
  );

  const getPackagesForPatient = useCallback(
    (patientId: string): PatientPackage[] => {
      const normalizedPatientId = patientId.trim();
      if (!normalizedPatientId) return [];
      return packagesByPatient[normalizedPatientId] ?? [];
    },
    [packagesByPatient],
  );

  return {
    packagesByPatient,
    getPackagesForPatient,
    assignPackage,
    updatePackage,
    removePackage,
    incrementVisits,
    decrementVisits,
    setStatus,
  };
}

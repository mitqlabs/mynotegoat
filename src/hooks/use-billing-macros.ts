"use client";

import { useCallback, useState } from "react";
import {
  GENERAL_DIAGNOSIS_FOLDER_ID,
  getDefaultBillingMacroLibrary,
  loadBillingMacroLibrary,
  saveBillingMacroLibrary,
  type BillingMacroLibraryConfig,
  type DiagnosisFolder,
  type DiagnosisMacro,
  type TreatmentPackage,
  type TreatmentMacro,
} from "@/lib/billing-macros";

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useBillingMacros() {
  const [billingMacros, setBillingMacros] = useState<BillingMacroLibraryConfig>(() =>
    loadBillingMacroLibrary(),
  );

  const updateLibrary = useCallback((updater: (current: BillingMacroLibraryConfig) => BillingMacroLibraryConfig) => {
    setBillingMacros((current) => {
      const base = typeof window === "undefined" ? current : loadBillingMacroLibrary();
      const next = updater(base);
      saveBillingMacroLibrary(next);
      return next;
    });
  }, []);

  const addTreatment = useCallback(
    (draft: Omit<TreatmentMacro, "id" | "active">) => {
      const name = draft.name.trim();
      const procedureCode = draft.procedureCode.trim().toUpperCase();
      if (!name || !procedureCode) {
        return false;
      }

      // Check for duplicate names before updating
      const current = loadBillingMacroLibrary();
      const duplicate = current.treatments.some(
        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) {
        return false;
      }

      updateLibrary((base) => ({
        ...base,
        treatments: [
          ...base.treatments,
          {
            id: createId("tx"),
            name,
            procedureCode,
            modifier: (draft.modifier ?? "").trim().toUpperCase(),
            unitPrice: Math.max(0, draft.unitPrice),
            defaultUnits: Math.max(1, Math.round(draft.defaultUnits)),
            active: true,
          },
        ],
      }));

      return true;
    },
    [updateLibrary],
  );

  const updateTreatment = useCallback(
    (id: string, patch: Partial<Omit<TreatmentMacro, "id">>) => {
      updateLibrary((current) => ({
        ...current,
        treatments: current.treatments.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }
          return {
            ...entry,
            ...patch,
            name: patch.name === undefined ? entry.name : patch.name.trim(),
            procedureCode:
              patch.procedureCode === undefined ? entry.procedureCode : patch.procedureCode.trim().toUpperCase(),
            modifier:
              patch.modifier === undefined ? (entry.modifier ?? "") : patch.modifier.trim().toUpperCase(),
            unitPrice: patch.unitPrice === undefined ? entry.unitPrice : Math.max(0, patch.unitPrice),
            defaultUnits:
              patch.defaultUnits === undefined ? entry.defaultUnits : Math.max(1, Math.round(patch.defaultUnits)),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const removeTreatment = useCallback(
    (id: string) => {
      updateLibrary((current) => ({
        ...current,
        treatments: current.treatments.filter((entry) => entry.id !== id),
      }));
    },
    [updateLibrary],
  );

  /**
   * Add (or look up if duplicate) a diagnosis in the master library.
   * Returns the resulting diagnosis id and whether this call inserted
   * a new row, so callers can chain bundle attachments without
   * re-querying state and still distinguish between "newly created"
   * vs "matched an existing code".
   *
   * Returns { id: null, added: false } when input is invalid (missing
   * code or description).
   */
  const addDiagnosis = useCallback(
    (draft: {
      code: string;
      description: string;
      folderId?: string;
    }): { id: string | null; added: boolean } => {
      const code = draft.code.trim().toUpperCase();
      const description = draft.description.trim();
      if (!code || !description) {
        return { id: null, added: false };
      }

      // Resolve the id from the CURRENT snapshot so the caller gets it back
      // synchronously. The updateLibrary updater below runs later (setState),
      // so an id assigned inside it would still be null on return.
      const existing = billingMacros.diagnoses.find(
        (entry) => entry.code.toLowerCase() === code.toLowerCase(),
      );
      if (existing) {
        return { id: existing.id, added: false };
      }
      const newId = createId("dx");
      updateLibrary((current) => {
        // Re-check inside the updater to stay race-safe.
        if (current.diagnoses.some((entry) => entry.code.toLowerCase() === code.toLowerCase())) {
          return current;
        }
        const allowedFolders = new Set(current.diagnosisFolders.map((entry) => entry.id));
        const folderId = allowedFolders.has(draft.folderId?.trim() ?? "")
          ? (draft.folderId?.trim() as string)
          : current.diagnosisFolders[0]?.id ?? GENERAL_DIAGNOSIS_FOLDER_ID;
        return {
          ...current,
          diagnoses: [
            ...current.diagnoses,
            {
              id: newId,
              code,
              description,
              folderId,
              active: true,
            },
          ],
        };
      });

      return { id: newId, added: true };
    },
    [billingMacros, updateLibrary],
  );

  const updateDiagnosis = useCallback(
    (id: string, patch: Partial<Omit<DiagnosisMacro, "id">>) => {
      updateLibrary((current) => {
        const allowedFolders = new Set(current.diagnosisFolders.map((entry) => entry.id));
        const fallbackFolderId = current.diagnosisFolders[0]?.id ?? GENERAL_DIAGNOSIS_FOLDER_ID;
        return {
          ...current,
          diagnoses: current.diagnoses.map((entry) => {
            if (entry.id !== id) {
              return entry;
            }
            return {
              ...entry,
              ...patch,
              code: patch.code === undefined ? entry.code : patch.code.trim().toUpperCase(),
              description:
                patch.description === undefined ? entry.description : patch.description.trim(),
              folderId:
                patch.folderId === undefined
                  ? entry.folderId
                  : allowedFolders.has(patch.folderId)
                    ? patch.folderId
                    : fallbackFolderId,
            };
          }),
        };
      });
    },
    [updateLibrary],
  );

  const addDiagnosisFolder = useCallback(
    (nameDraft: string) => {
      const name = nameDraft.trim();
      if (!name) {
        return false;
      }
      updateLibrary((current) => {
        const duplicate = current.diagnosisFolders.some(
          (entry) => entry.name.toLowerCase() === name.toLowerCase(),
        );
        if (duplicate) {
          return current;
        }
        const nextFolder: DiagnosisFolder = {
          id: createId("dx-folder"),
          name,
        };
        return {
          ...current,
          diagnosisFolders: [...current.diagnosisFolders, nextFolder],
        };
      });
      return true;
    },
    [updateLibrary],
  );

  const updateDiagnosisFolder = useCallback(
    (id: string, nameDraft: string) => {
      const name = nameDraft.trim();
      if (!name) {
        return;
      }
      updateLibrary((current) => ({
        ...current,
        diagnosisFolders: current.diagnosisFolders.map((entry) =>
          entry.id === id ? { ...entry, name } : entry,
        ),
      }));
    },
    [updateLibrary],
  );

  const moveDiagnosisFolder = useCallback(
    (id: string, direction: "up" | "down") => {
      updateLibrary((current) => {
        const index = current.diagnosisFolders.findIndex((entry) => entry.id === id);
        if (index < 0) {
          return current;
        }
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= current.diagnosisFolders.length) {
          return current;
        }
        const nextFolders = [...current.diagnosisFolders];
        const [item] = nextFolders.splice(index, 1);
        nextFolders.splice(targetIndex, 0, item);
        return {
          ...current,
          diagnosisFolders: nextFolders,
        };
      });
    },
    [updateLibrary],
  );

  const removeDiagnosisFolder = useCallback(
    (id: string) => {
      updateLibrary((current) => {
        if (
          id === GENERAL_DIAGNOSIS_FOLDER_ID ||
          current.diagnosisFolders.length <= 1
        ) {
          return current;
        }
        const fallbackFolderId =
          current.diagnosisFolders.find((entry) => entry.id !== id)?.id ??
          GENERAL_DIAGNOSIS_FOLDER_ID;
        return {
          ...current,
          diagnosisFolders: current.diagnosisFolders.filter((entry) => entry.id !== id),
          diagnoses: current.diagnoses.map((entry) =>
            entry.folderId === id ? { ...entry, folderId: fallbackFolderId } : entry,
          ),
        };
      });
    },
    [updateLibrary],
  );

  const removeDiagnosis = useCallback(
    (id: string) => {
      updateLibrary((current) => ({
        ...current,
        diagnoses: current.diagnoses.filter((entry) => entry.id !== id),
        bundles: current.bundles.map((bundle) => ({
          ...bundle,
          diagnosisIds: bundle.diagnosisIds.filter((entry) => entry !== id),
        })),
      }));
    },
    [updateLibrary],
  );

  const addBundle = useCallback(
    (nameDraft: string, diagnosisIds: string[]) => {
      const name = nameDraft.trim();
      if (!name || !diagnosisIds.length) {
        return false;
      }

      updateLibrary((current) => {
        const duplicate = current.bundles.some((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (duplicate) {
          return current;
        }
        const allowed = new Set(current.diagnoses.map((entry) => entry.id));
        const uniqueIds = Array.from(new Set(diagnosisIds.filter((entry) => allowed.has(entry))));
        if (!uniqueIds.length) {
          return current;
        }
        return {
          ...current,
          bundles: [
            ...current.bundles,
            {
              id: createId("bundle"),
              name,
              diagnosisIds: uniqueIds,
              active: true,
            },
          ],
        };
      });

      return true;
    },
    [updateLibrary],
  );

  const updateBundle = useCallback(
    (id: string, patch: { name?: string; active?: boolean; diagnosisIds?: string[] }) => {
      updateLibrary((current) => {
        const allowed = new Set(current.diagnoses.map((entry) => entry.id));
        return {
          ...current,
          bundles: current.bundles.map((bundle) => {
            if (bundle.id !== id) {
              return bundle;
            }
            const nextDiagnosisIds =
              patch.diagnosisIds === undefined
                ? bundle.diagnosisIds
                : Array.from(new Set(patch.diagnosisIds.filter((entry) => allowed.has(entry))));
            return {
              ...bundle,
              name: patch.name === undefined ? bundle.name : patch.name.trim(),
              active: patch.active === undefined ? bundle.active : patch.active,
              diagnosisIds: nextDiagnosisIds,
            };
          }),
        };
      });
    },
    [updateLibrary],
  );

  const removeBundle = useCallback(
    (id: string) => {
      updateLibrary((current) => ({
        ...current,
        bundles: current.bundles.filter((entry) => entry.id !== id),
      }));
    },
    [updateLibrary],
  );

  const addPackage = useCallback(
    (draft: Omit<TreatmentPackage, "id" | "active" | "items">) => {
      const name = draft.name.trim();
      if (!name) {
        return false;
      }
      const family = (draft.family ?? "").trim();

      updateLibrary((current) => {
        // Names must be unique WITHIN a family (so "Gold" can exist in
        // both "Spinal Decompression" and "Massage" without colliding).
        const duplicate = current.packages.some(
          (entry) =>
            entry.name.toLowerCase() === name.toLowerCase() &&
            (entry.family ?? "").trim().toLowerCase() === family.toLowerCase(),
        );
        if (duplicate) {
          return current;
        }
        return {
          ...current,
          packages: [
            ...current.packages,
            {
              id: createId("package"),
              name,
              totalVisits: Math.max(1, Math.round(draft.totalVisits)),
              discountedPrice: Math.max(0, draft.discountedPrice),
              items: [],
              active: true,
              ...(family ? { family } : {}),
            },
          ],
        };
      });

      return true;
    },
    [updateLibrary],
  );

  /**
   * Reorder packages by full ordered list of ids. Used by drag-and-drop
   * in the settings panel — both for moving a tier within a family and
   * for moving a whole family-block when the user drags the family
   * header.
   */
  const reorderPackages = useCallback(
    (orderedIds: string[]) => {
      updateLibrary((current) => {
        const byId = new Map(current.packages.map((entry) => [entry.id, entry]));
        const reordered: TreatmentPackage[] = [];
        const seen = new Set<string>();
        for (const id of orderedIds) {
          const entry = byId.get(id);
          if (entry && !seen.has(id)) {
            reordered.push(entry);
            seen.add(id);
          }
        }
        // Append anything the caller forgot to list (defensive — keeps
        // packages from disappearing if orderedIds is stale).
        for (const entry of current.packages) {
          if (!seen.has(entry.id)) reordered.push(entry);
        }
        return { ...current, packages: reordered };
      });
    },
    [updateLibrary],
  );

  /**
   * Rename a family across every package whose family matches the
   * old value. `null` / "" target moves them all to Uncategorized.
   */
  const renamePackageFamily = useCallback(
    (oldName: string, newName: string) => {
      const oldKey = (oldName ?? "").trim().toLowerCase();
      const next = (newName ?? "").trim();
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.map((entry) => {
          const entryKey = (entry.family ?? "").trim().toLowerCase();
          if (entryKey !== oldKey) return entry;
          if (!next) {
            const { family: _drop, ...rest } = entry;
            return rest;
          }
          return { ...entry, family: next };
        }),
      }));
    },
    [updateLibrary],
  );

  /**
   * Update the family of a single package — used when dragging a tier
   * across families. Empty string moves it to Uncategorized.
   */
  const setPackageFamily = useCallback(
    (packageId: string, family: string) => {
      const next = (family ?? "").trim();
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.map((entry) => {
          if (entry.id !== packageId) return entry;
          if (!next) {
            const { family: _drop, ...rest } = entry;
            return rest;
          }
          return { ...entry, family: next };
        }),
      }));
    },
    [updateLibrary],
  );

  const updatePackage = useCallback(
    (id: string, patch: Partial<Omit<TreatmentPackage, "id" | "items">>) => {
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }
          return {
            ...entry,
            ...patch,
            name: patch.name === undefined ? entry.name : patch.name.trim(),
            totalVisits:
              patch.totalVisits === undefined ? entry.totalVisits : Math.max(1, Math.round(patch.totalVisits)),
            discountedPrice:
              patch.discountedPrice === undefined ? entry.discountedPrice : Math.max(0, patch.discountedPrice),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const removePackage = useCallback(
    (id: string) => {
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.filter((entry) => entry.id !== id),
      }));
    },
    [updateLibrary],
  );

  const addPackageTreatment = useCallback(
    (packageId: string, treatmentId: string, visits: number) => {
      updateLibrary((current) => {
        const treatmentExists = current.treatments.some((entry) => entry.id === treatmentId);
        if (!treatmentExists) {
          return current;
        }
        return {
          ...current,
          packages: current.packages.map((entry) => {
            if (entry.id !== packageId) {
              return entry;
            }
            const safeVisits = Math.max(1, Math.round(visits));
            const existing = entry.items.find((item) => item.treatmentId === treatmentId);
            if (existing) {
              return {
                ...entry,
                items: entry.items.map((item) =>
                  item.treatmentId === treatmentId
                    ? { ...item, visits: safeVisits }
                    : item,
                ),
              };
            }
            return {
              ...entry,
              items: [...entry.items, { treatmentId, visits: safeVisits }],
            };
          }),
        };
      });
    },
    [updateLibrary],
  );

  const updatePackageTreatmentVisits = useCallback(
    (packageId: string, treatmentId: string, visits: number) => {
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.map((entry) => {
          if (entry.id !== packageId) {
            return entry;
          }
          return {
            ...entry,
            items: entry.items.map((item) =>
              item.treatmentId === treatmentId
                ? { ...item, visits: Math.max(1, Math.round(visits)) }
                : item,
            ),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const removePackageTreatment = useCallback(
    (packageId: string, treatmentId: string) => {
      updateLibrary((current) => ({
        ...current,
        packages: current.packages.map((entry) => {
          if (entry.id !== packageId) {
            return entry;
          }
          return {
            ...entry,
            items: entry.items.filter((item) => item.treatmentId !== treatmentId),
          };
        }),
      }));
    },
    [updateLibrary],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultBillingMacroLibrary();
    setBillingMacros(defaults);
    saveBillingMacroLibrary(defaults);
  }, []);

  return {
    billingMacros,
    addTreatment,
    updateTreatment,
    removeTreatment,
    addDiagnosis,
    updateDiagnosis,
    removeDiagnosis,
    addDiagnosisFolder,
    updateDiagnosisFolder,
    moveDiagnosisFolder,
    removeDiagnosisFolder,
    addBundle,
    updateBundle,
    removeBundle,
    addPackage,
    updatePackage,
    removePackage,
    reorderPackages,
    renamePackageFamily,
    setPackageFamily,
    addPackageTreatment,
    updatePackageTreatmentVisits,
    removePackageTreatment,
    resetToDefaults,
  };
}

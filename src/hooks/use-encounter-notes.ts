"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEncounterChargeId,
  createEncounterDiagnosisId,
  createEncounterId,
  createEncounterMacroRunId,
  forceSaveAllEncountersToCloud,
  getNowUsDate,
  loadEncounterNoteRecords,
  loadEncounterNotesFromCloud,
  saveEncounterNoteRecords,
  type EncounterChargeEntry,
  type EncounterMacroRunRecord,
  type EncounterDiagnosisEntry,
  type EncounterNoteRecord,
  type EncounterSection,
} from "@/lib/encounter-notes";
import type { MacroLinkedCharge, MacroTemplate } from "@/lib/macro-templates";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

const SYNC_KEY = "casemate.encounter-notes.v1";

type NewEncounterDraft = {
  patientId: string;
  patientName: string;
  provider: string;
  appointmentType: string;
  encounterDate?: string;
};

type UpdateEncounterPatch = Partial<
  Pick<EncounterNoteRecord, "provider" | "appointmentType" | "encounterDate" | "patientName">
>;

function nowIso() {
  return new Date().toISOString();
}

export function useEncounterNotes() {
  const [encounters, setEncounters] = useState<EncounterNoteRecord[]>(() =>
    loadEncounterNoteRecords(),
  );

  // Counter: skip reloads triggered by our own writes.  Each write
  // increments; each notification decrements.  Only reload from LS
  // when counter hits 0 (meaning a DIFFERENT hook instance wrote).
  const selfWriteCountRef = useRef(0);

  // Merge cloud encounters into state.  localStorage only caches the
  // last 90 days, so we always pull from the cloud to ensure older
  // encounters (needed for billing, reports, etc.) are available.
  useEffect(() => {
    void loadEncounterNotesFromCloud().then((cloud) => {
      if (!cloud || cloud.length === 0) return;
      setEncounters((local) => {
        // Merge: for each record keep the newer copy by updatedAt;
        // include cloud-only records that were pruned from localStorage.
        const byId = new Map(local.map((n) => [n.id, n]));
        let changed = false;
        for (const c of cloud) {
          const existing = byId.get(c.id);
          if (!existing) {
            byId.set(c.id, c);
            changed = true;
          } else {
            const localTime = Date.parse(existing.updatedAt) || 0;
            const cloudTime = Date.parse(c.updatedAt) || 0;
            if (cloudTime > localTime) {
              byId.set(c.id, c);
              changed = true;
            }
          }
        }
        return changed ? Array.from(byId.values()) : local;
      });
    });
  }, []);

  // Listen for changes made by other hook instances on this page
  useEffect(() => {
    return onLocalChange(SYNC_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setEncounters(loadEncounterNoteRecords());
    });
  }, []);

  const updateRecords = useCallback((updater: (current: EncounterNoteRecord[]) => EncounterNoteRecord[]) => {
    setEncounters((current) => {
      const next = updater(current);
      saveEncounterNoteRecords(next);
      selfWriteCountRef.current++;
      notifyChange(SYNC_KEY);
      return next;
    });
  }, []);

  const upsertEncounter = useCallback(
    (encounterId: string, updater: (current: EncounterNoteRecord) => EncounterNoteRecord) => {
      updateRecords((current) =>
        current.map((entry) => {
          if (entry.id !== encounterId) {
            return entry;
          }
          const next = updater(entry);
          return {
            ...next,
            updatedAt: nowIso(),
          };
        }),
      );
    },
    [updateRecords],
  );

  const createEncounter = useCallback(
    (draft: NewEncounterDraft) => {
      const patientId = draft.patientId.trim();
      const patientName = draft.patientName.trim();
      const provider = draft.provider.trim();
      const appointmentType = draft.appointmentType.trim();
      const encounterDate = (draft.encounterDate ?? "").trim() || getNowUsDate();

      if (!patientId || !patientName || !provider || !appointmentType || !encounterDate) {
        return null;
      }

      // ── Duplicate guard ──
      // If an encounter already exists for this patient + date + type,
      // return its id instead of creating a duplicate.
      let existingId: string | null = null;
      setEncounters((current) => {
        const existing = current.find(
          (e) =>
            e.patientId === patientId &&
            e.encounterDate === encounterDate &&
            e.appointmentType.toLowerCase() === appointmentType.toLowerCase(),
        );
        if (existing) {
          existingId = existing.id;
        }
        return current; // no mutation — just a read
      });
      if (existingId) {
        return existingId;
      }

      const timestamp = nowIso();
      const newId = createEncounterId();
      const newRecord: EncounterNoteRecord = {
        id: newId,
        patientId,
        patientName,
        provider,
        appointmentType,
        encounterDate,
        startTime: "",
        soap: {
          subjective: "",
          objective: "",
          assessment: "",
          plan: "",
        },
        macroRuns: [],
        diagnoses: [],
        charges: [],
        signed: false,
        signedAt: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      updateRecords((current) => {
        // Double-check inside updater (fresh state) to prevent race conditions
        const alreadyExists = current.find(
          (e) =>
            e.patientId === patientId &&
            e.encounterDate === encounterDate &&
            e.appointmentType.toLowerCase() === appointmentType.toLowerCase(),
        );
        if (alreadyExists) {
          existingId = alreadyExists.id;
          return current; // no mutation
        }
        return [newRecord, ...current];
      });
      return existingId ?? newId;
    },
    [updateRecords],
  );

  const updateEncounter = useCallback(
    (encounterId: string, patch: UpdateEncounterPatch) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        ...patch,
      }));
    },
    [upsertEncounter],
  );

  const setSoapSection = useCallback(
    (encounterId: string, section: EncounterSection, value: string) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        soap: {
          ...current.soap,
          [section]: value,
        },
      }));
    },
    [upsertEncounter],
  );

  const addMacroRun = useCallback(
    (
      encounterId: string,
      input: Omit<EncounterMacroRunRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
    ) => {
      let createdId: string | null = null;
      upsertEncounter(encounterId, (current) => {
        const timestamp = nowIso();
        createdId = input.id ?? createEncounterMacroRunId();
        return {
          ...current,
          macroRuns: [
            ...current.macroRuns,
            {
              id: createdId,
              section: input.section,
              macroId: input.macroId,
              macroName: input.macroName,
              body: input.body,
              answers: { ...input.answers },
              generatedText: input.generatedText,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        };
      });
      return createdId;
    },
    [upsertEncounter],
  );

  const updateMacroRun = useCallback(
    (
      encounterId: string,
      macroRunId: string,
      patch: Partial<Pick<EncounterMacroRunRecord, "answers" | "generatedText">>,
    ) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        macroRuns: current.macroRuns.map((entry) => {
          if (entry.id !== macroRunId) {
            return entry;
          }
          return {
            ...entry,
            answers: patch.answers ? { ...patch.answers } : entry.answers,
            generatedText: patch.generatedText ?? entry.generatedText,
            updatedAt: nowIso(),
          };
        }),
      }));
    },
    [upsertEncounter],
  );

  const removeMacroRun = useCallback(
    (encounterId: string, macroRunId: string) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        macroRuns: current.macroRuns.filter((entry) => entry.id !== macroRunId),
      }));
    },
    [upsertEncounter],
  );

  const appendSoapSection = useCallback(
    (encounterId: string, section: EncounterSection, snippet: string) => {
      const trimmed = snippet.trim();
      if (!trimmed) {
        return;
      }
      upsertEncounter(encounterId, (current) => {
        const existing = current.soap[section].trim();
        const nextText = existing ? `${existing}<p><br></p>${trimmed}` : trimmed;
        return {
          ...current,
          soap: {
            ...current.soap,
            [section]: nextText,
          },
        };
      });
    },
    [upsertEncounter],
  );

  const addDiagnosis = useCallback(
    (encounterId: string, input: Omit<EncounterDiagnosisEntry, "id">) => {
      const code = input.code.trim().toUpperCase();
      const description = input.description.trim();
      const source = input.source.trim() || "Manual";
      if (!code || !description) {
        return false;
      }
      let added = false;
      upsertEncounter(encounterId, (current) => {
        const duplicate = current.diagnoses.some(
          (entry) =>
            entry.code.toLowerCase() === code.toLowerCase() &&
            entry.description.toLowerCase() === description.toLowerCase(),
        );
        if (duplicate) {
          return current;
        }
        added = true;
        return {
          ...current,
          diagnoses: [
            ...current.diagnoses,
            {
              id: createEncounterDiagnosisId(),
              code,
              description,
              source,
            },
          ],
        };
      });
      return added;
    },
    [upsertEncounter],
  );

  const addDiagnosesBulk = useCallback(
    (encounterId: string, items: Array<Omit<EncounterDiagnosisEntry, "id">>) => {
      if (!items.length) {
        return 0;
      }
      let addedCount = 0;
      upsertEncounter(encounterId, (current) => {
        const nextDiagnoses = [...current.diagnoses];
        items.forEach((item) => {
          const code = item.code.trim().toUpperCase();
          const description = item.description.trim();
          const source = item.source.trim() || "Bundle";
          if (!code || !description) {
            return;
          }
          const duplicate = nextDiagnoses.some(
            (entry) =>
              entry.code.toLowerCase() === code.toLowerCase() &&
              entry.description.toLowerCase() === description.toLowerCase(),
          );
          if (duplicate) {
            return;
          }
          addedCount += 1;
          nextDiagnoses.push({
            id: createEncounterDiagnosisId(),
            code,
            description,
            source,
          });
        });
        return {
          ...current,
          diagnoses: nextDiagnoses,
        };
      });
      return addedCount;
    },
    [upsertEncounter],
  );

  const removeDiagnosis = useCallback(
    (encounterId: string, diagnosisId: string) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        diagnoses: current.diagnoses.filter((entry) => entry.id !== diagnosisId),
      }));
    },
    [upsertEncounter],
  );

  /**
   * Add a charge. Returns "added" | "bumped" | "duplicate" | false.
   * - "added": new charge added
   * - "bumped": existing charge found, units increased
   * - "duplicate": existing charge found but caller should confirm
   * - false: invalid input
   *
   * Pass `bumpIfDuplicate: true` to auto-bump units on duplicates.
   */
  const addCharge = useCallback(
    (encounterId: string, input: Omit<EncounterChargeEntry, "id">, options?: { bumpIfDuplicate?: boolean }): "added" | "bumped" | "duplicate" | false => {
      const name = input.name.trim();
      const procedureCode = input.procedureCode.trim().toUpperCase();
      if (!name || !procedureCode) {
        return false;
      }
      let result: "added" | "bumped" | "duplicate" = "added";
      const unitsToAdd = Math.max(1, Math.round(Number(input.units) || 1));
      upsertEncounter(encounterId, (current) => {
        const existing = current.charges.find(
          (c) => c.procedureCode.toUpperCase() === procedureCode,
        );
        if (existing) {
          if (options?.bumpIfDuplicate) {
            result = "bumped";
            return {
              ...current,
              charges: current.charges.map((c) =>
                c.id === existing.id ? { ...c, units: c.units + unitsToAdd } : c,
              ),
            };
          }
          result = "duplicate";
          return current; // no change — let caller decide
        }
        result = "added";
        return {
          ...current,
          charges: [
            ...current.charges,
            {
              id: createEncounterChargeId(),
              treatmentMacroId: input.treatmentMacroId,
              name,
              procedureCode,
              unitPrice: Math.max(0, Number(input.unitPrice) || 0),
              units: unitsToAdd,
            },
          ],
        };
      });
      return result;
    },
    [upsertEncounter],
  );

  /** Add multiple charges in a single atomic state update (no race conditions). */
  const addChargesBulk = useCallback(
    (encounterId: string, inputs: Omit<EncounterChargeEntry, "id">[]) => {
      const valid = inputs
        .map((input) => {
          const name = input.name.trim();
          const procedureCode = input.procedureCode.trim().toUpperCase();
          if (!name || !procedureCode) return null;
          return {
            id: createEncounterChargeId(),
            treatmentMacroId: input.treatmentMacroId,
            name,
            procedureCode,
            unitPrice: Math.max(0, Number(input.unitPrice) || 0),
            units: Math.max(1, Math.round(Number(input.units) || 1)),
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null) as EncounterChargeEntry[];
      if (valid.length === 0) return 0;
      upsertEncounter(encounterId, (current) => ({
        ...current,
        charges: [...current.charges, ...valid],
      }));
      return valid.length;
    },
    [upsertEncounter],
  );

  const updateCharge = useCallback(
    (encounterId: string, chargeId: string, patch: Partial<Omit<EncounterChargeEntry, "id">>) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        charges: current.charges.map((entry) => {
          if (entry.id !== chargeId) {
            return entry;
          }
          return {
            ...entry,
            ...patch,
            name: patch.name === undefined ? entry.name : patch.name.trim(),
            procedureCode:
              patch.procedureCode === undefined ? entry.procedureCode : patch.procedureCode.trim().toUpperCase(),
            units: patch.units === undefined ? entry.units : Math.max(1, Math.round(Number(patch.units) || 1)),
            unitPrice:
              patch.unitPrice === undefined ? entry.unitPrice : Math.max(0, Number(patch.unitPrice) || 0),
          };
        }),
      }));
    },
    [upsertEncounter],
  );

  const removeCharge = useCallback(
    (encounterId: string, chargeId: string) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        charges: current.charges.filter((entry) => entry.id !== chargeId),
      }));
    },
    [upsertEncounter],
  );

  const moveCharge = useCallback(
    (encounterId: string, chargeId: string, direction: "up" | "down") => {
      upsertEncounter(encounterId, (current) => {
        const charges = [...current.charges];
        const idx = charges.findIndex((e) => e.id === chargeId);
        if (idx < 0) return current;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= charges.length) return current;
        [charges[idx], charges[swapIdx]] = [charges[swapIdx], charges[idx]];
        return { ...current, charges };
      });
    },
    [upsertEncounter],
  );

  /**
   * Reconcile option-linked encounter charges against the current macro-run
   * answers. Call this after:
   *  - adding or editing a macro run (answers changed)
   *  - removing a macro run
   *  - SALT'ing SOAP macro runs from a prior encounter
   *
   * Logic (runs atomically inside a single upsertEncounter):
   *  1. Build the "expected" set of (procedureCode → MacroLinkedCharge)
   *     from every picked answer in every macro run in this encounter.
   *  2. For each expected code:
   *       - If a charge already exists with that code: adopt it by
   *         setting linkedMacroRunId. Leave name/price/units alone so
   *         any manual edits the user made survive.
   *       - Else: insert a new charge with units=1 and the link flag set.
   *  3. Drop any charge that has linkedMacroRunId set but whose code is
   *     no longer expected — that's a picked-and-then-unpicked option.
   *
   * Charges with NO linkedMacroRunId and NO matching expected code are
   * user-owned; the reconciler never removes them.
   *
   * Returns a summary of what changed so the caller can surface a
   * message in the UI.
   */
  const reconcileLinkedCharges = useCallback(
    (
      encounterId: string,
      macroLibraryById: Map<string, MacroTemplate>,
    ): { added: string[]; removed: string[] } => {
      const changed = { added: [] as string[], removed: [] as string[] };
      upsertEncounter(encounterId, (current) => {
        const expected = new Map<
          string,
          { link: MacroLinkedCharge; firstRunId: string }
        >();
        for (const run of current.macroRuns) {
          const macro = macroLibraryById.get(run.macroId);
          if (!macro) continue;
          for (const question of macro.questions) {
            if (!question.optionCharges) continue;
            const answer = run.answers[question.id];
            const picks = Array.isArray(answer) ? answer : answer ? [answer] : [];
            for (const pick of picks) {
              const link = question.optionCharges[pick];
              if (!link?.procedureCode || !link?.name) continue;
              const code = link.procedureCode.toUpperCase();
              if (!expected.has(code)) {
                expected.set(code, {
                  link: { ...link, procedureCode: code },
                  firstRunId: run.id,
                });
              }
            }
          }
        }

        const nextCharges: EncounterChargeEntry[] = [];
        const adopted = new Set<string>();
        for (const charge of current.charges) {
          const code = charge.procedureCode.toUpperCase();
          const match = expected.get(code);
          if (match) {
            adopted.add(code);
            // Adopt if not already linked. Preserve user-edited name/price/units.
            if (!charge.linkedMacroRunId) {
              nextCharges.push({ ...charge, linkedMacroRunId: match.firstRunId });
            } else {
              nextCharges.push(charge);
            }
            continue;
          }
          if (charge.linkedMacroRunId) {
            // Was previously linked; no longer expected → remove.
            changed.removed.push(charge.name);
            continue;
          }
          // User-owned manual / billing-macro charge — keep untouched.
          nextCharges.push(charge);
        }

        for (const [code, { link, firstRunId }] of expected) {
          if (adopted.has(code)) continue;
          nextCharges.push({
            id: createEncounterChargeId(),
            linkedMacroRunId: firstRunId,
            name: link.name,
            procedureCode: code,
            unitPrice: Math.max(0, Number(link.unitPrice) || 0),
            units: 1,
          });
          changed.added.push(link.name);
        }

        if (changed.added.length === 0 && changed.removed.length === 0) {
          // Check for adoption-only changes (newly tagged linkedMacroRunId).
          const adoptionChanged = nextCharges.some((c, i) => {
            const prev = current.charges[i];
            return prev && c.linkedMacroRunId !== prev.linkedMacroRunId;
          });
          if (!adoptionChanged) return current;
        }

        return { ...current, charges: nextCharges };
      });
      return changed;
    },
    [upsertEncounter],
  );

  const setSigned = useCallback(
    (encounterId: string, signed: boolean) => {
      upsertEncounter(encounterId, (current) => ({
        ...current,
        signed,
        signedAt: signed ? nowIso() : "",
      }));
    },
    [upsertEncounter],
  );

  const deleteEncounter = useCallback(
    (encounterId: string) => {
      updateRecords((current) => current.filter((entry) => entry.id !== encounterId));
    },
    [updateRecords],
  );

  const encountersByNewest = useMemo(
    () =>
      [...encounters].sort((left, right) => {
        const leftUpdated = Date.parse(left.updatedAt);
        const rightUpdated = Date.parse(right.updatedAt);
        return (Number.isFinite(rightUpdated) ? rightUpdated : 0) - (Number.isFinite(leftUpdated) ? leftUpdated : 0);
      }),
    [encounters],
  );

  /** Force-save encounters to localStorage + cloud. If patientId is given, only saves that patient's encounters. */
  const forceSaveAll = useCallback(async (patientId?: string): Promise<{ ok: boolean; count: number; error?: string }> => {
    const toSave = patientId ? encounters.filter((e) => e.patientId === patientId) : encounters;
    return forceSaveAllEncountersToCloud(toSave);
  }, [encounters]);

  return {
    encounters,
    encountersByNewest,
    createEncounter,
    updateEncounter,
    setSoapSection,
    addMacroRun,
    updateMacroRun,
    removeMacroRun,
    appendSoapSection,
    addDiagnosis,
    addDiagnosesBulk,
    removeDiagnosis,
    addCharge,
    addChargesBulk,
    updateCharge,
    removeCharge,
    moveCharge,
    reconcileLinkedCharges,
    setSigned,
    deleteEncounter,
    forceSaveAll,
  };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEncounterChargeId,
  createEncounterDiagnosisId,
  createEncounterId,
  createEncounterMacroRunId,
  forceSaveAllEncountersToCloud,
  encounterSections,
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
import {
  formatMacroAnswerValue,
  renderMacroPromptSpan,
  type MacroLinkedCharge,
  type MacroTemplate,
} from "@/lib/macro-templates";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

const SYNC_KEY = "casemate.encounter-notes.v1";

type NewEncounterDraft = {
  patientId: string;
  patientName: string;
  provider: string;
  appointmentType: string;
  encounterDate?: string;
  /** Optional id of the appointment this encounter is being created
   *  from. Stored on the record so the patient-page table can keep
   *  the appointment ↔ encounter link intact even if the appointment
   *  date / type later drifts. */
  appointmentId?: string;
};

type UpdateEncounterPatch = Partial<
  Pick<
    EncounterNoteRecord,
    "provider" | "appointmentType" | "encounterDate" | "patientName" | "appointmentId"
  >
>;

function nowIso() {
  return new Date().toISOString();
}

/**
 * MacroRun prune grace — see the long comment inside setSoapSection.
 * Keyed by "${encounterId}:${runId}" → timestamp (ms) when the run's
 * data-macro-run-id span first went missing from the HTML.
 *
 * Module-level on purpose: survives individual setSoapSection
 * invocations, resets on full reload, and doesn't require plumbing
 * extra state through React. Kept small by deleting entries whenever
 * the id reappears or when the grace expires and the run is actually
 * pruned.
 */
const macroRunPruneGrace = new Map<string, number>();
const MACRO_RUN_PRUNE_GRACE_MS = 5000;

// Block-cleanup helpers moved to src/lib/soap-html-normalize.ts so the
// normalizer can be reused at READ time too — Previous Subjective
// preview, SOAP print export, narrative report — not just at write
// time. Old encounters were saved before the inline-content wrapping
// fix landed; running their stored HTML through normalizeEditorBlocks
// on render fixes the "Shoulder: Left glued onto Lumbar's line"
// without us touching storage.
import { normalizeEditorBlocks } from "@/lib/soap-html-normalize";

/**
 * Rewrite a single macro prompt span inside an HTML string. Used when we
 * programmatically clear an option pick (e.g. via removeCharge unpick) so
 * the rendered SOAP and the run's stored generatedText both reflect the
 * new answer value without a full template re-render.
 *
 * Matches the exact attribute shape emitted by `renderMacroPromptSpan` and
 * replaces with a freshly rendered span for the same run+prompt. If no
 * matching span is found, returns the input unchanged.
 */
function replacePromptSpan(
  html: string,
  runId: string,
  promptId: string,
  newValue: string,
): string {
  // Escape regex metacharacters in ids (they're usually safe, but be
  // defensive — underscores and hyphens are fine, but future id formats
  // could include dots or plus signs).
  const safeRun = runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const safePrompt = promptId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<span class="macro-prompt" contenteditable="false" data-macro-run-id="${safeRun}" data-prompt-id="${safePrompt}">[\\s\\S]*?</span>`,
    "g",
  );
  if (!pattern.test(html)) return html;
  return html.replace(pattern, renderMacroPromptSpan(runId, promptId, newValue));
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

  // Debounced persistence. Before this change, every keystroke in a SOAP
  // editor triggered saveEncounterNoteRecords, which:
  //   - JSON.stringify'd the full encounter-notes blob (up to 1.25 MB)
  //   - ran pruneForLocalStorage (multiple extra serializations)
  //   - called localStorage.setItem (which the storage-sync interceptor
  //     captured and queued a full-workspace cloud push behind)
  //   - kicked off a dual-write to the encounter-notes cloud table
  // Doing all that on every keypress is what pegged the fan and crashed
  // Chrome during long editing sessions. The per-keystroke crash-safety
  // net (draft-recovery.writeDraft) is cheap and still runs inline inside
  // the editor's onInput handler — that's what survives if Chrome dies
  // in the debounce window. The "committed" encounter-notes.v1 blob only
  // needs to be refreshed after the user pauses typing.
  const pendingRecordsRef = useRef<EncounterNoteRecord[] | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingNow = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const pending = pendingRecordsRef.current;
    if (!pending) return;
    pendingRecordsRef.current = null;
    saveEncounterNoteRecords(pending);
    selfWriteCountRef.current++;
    notifyChange(SYNC_KEY);
  }, []);

  // Stable refs to the flush + pending state. The beforeunload /
  // pagehide / visibilitychange listeners below reference these via
  // ref so we can use `[]` deps on the effect — per sanity-check rule,
  // listener-registering effects MUST have stable deps or refs only,
  // otherwise listeners can accumulate on every render.
  const flushRef = useRef(flushPendingNow);
  flushRef.current = flushPendingNow;

  useEffect(() => {
    const flush = () => flushRef.current();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      // Final flush on unmount so a route change doesn't lose pending edits.
      flush();
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const updateRecords = useCallback((updater: (current: EncounterNoteRecord[]) => EncounterNoteRecord[]) => {
    setEncounters((current) => {
      const next = updater(current);
      // React state updates immediately so typing stays responsive and the
      // UI reflects the newest input. Persistence gets debounced so the
      // heavy work (prune + stringify + dual-write) runs once per ~700ms
      // of quiet instead of once per keystroke.
      pendingRecordsRef.current = next;
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
      }
      // Tight debounce (250ms) — long enough to coalesce rapid keystrokes
      // and avoid hammering the cloud table mid-burst, short enough that
      // a Safari OOM-reload that fires before the timer is the rare edge
      // case rather than the norm. The previous 700ms window was losing
      // user data when the tab was killed by the OS before the flush ran.
      commitTimerRef.current = setTimeout(() => {
        flushPendingNow();
      }, 250);
      return next;
    });
  }, [flushPendingNow]);

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
        appointmentId: draft.appointmentId?.trim() || undefined,
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
      // CRITICAL: create is the one operation where we BYPASS the
      // 250ms debounce. The "+ Encounter" flow immediately navigates
      // to /encounters via router.push, and if the user types or
      // navigates again inside that debounce window the encounter
      // can vanish before it's persisted. That race produces orphaned
      // drafts — the per-keystroke draft-recovery key points at an
      // encounter id that doesn't exist anywhere on the next page
      // load, so the recovery banner can't find a parent record and
      // silently drops the user's typed text on "Restore all".
      //
      // We sidestep that by reading the canonical record list from
      // localStorage right here and writing the new encounter back
      // synchronously, then mirroring the same list into React state.
      // setEncounters' updater function is NOT guaranteed to run
      // synchronously under React 18's batching, so we cannot rely on
      // pendingRecordsRef being populated before flushPendingNow.
      const baseRecords = loadEncounterNoteRecords();
      const dupeInLocal = baseRecords.find(
        (e) =>
          e.patientId === patientId &&
          e.encounterDate === encounterDate &&
          e.appointmentType.toLowerCase() === appointmentType.toLowerCase(),
      );
      if (dupeInLocal) {
        existingId = dupeInLocal.id;
      }
      let nextRecords: EncounterNoteRecord[] | null = null;
      if (!existingId) {
        nextRecords = [newRecord, ...baseRecords];
        saveEncounterNoteRecords(nextRecords);
        // Clear any pending debounced write so we don't immediately
        // overwrite the durable list with a stale one.
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        pendingRecordsRef.current = null;
        selfWriteCountRef.current++;
        notifyChange(SYNC_KEY);
      }
      // Now mirror into React state so the current tree renders the
      // new record. We use a functional setState in case other state
      // changes (debounced typing) landed since baseRecords was read.
      setEncounters((current) => {
        const alreadyExists = current.find(
          (e) =>
            e.patientId === patientId &&
            e.encounterDate === encounterDate &&
            e.appointmentType.toLowerCase() === appointmentType.toLowerCase(),
        );
        if (alreadyExists) {
          existingId = alreadyExists.id;
          return current;
        }
        return nextRecords ?? [newRecord, ...current];
      });
      return existingId ?? newId;
    },
    [],
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
      upsertEncounter(encounterId, (current) => {
        // MacroRun pruning with grace period.
        //
        // When a macroRun's data-macro-run-id span is no longer in the
        // HTML we want to prune it (so the linked CPT charge gets
        // removed too) — BUT not instantly. CMD X + CMD V (cut then
        // paste to reorder a pill) temporarily removes the span from
        // the DOM for a few hundred ms before it returns. Eager
        // pruning on the cut keystroke killed the run before the
        // paste arrived; then the pasted pill landed back in the HTML
        // but the run was gone, so the charge didn't come back and
        // clicking the pill no longer opened the picker.
        //
        // Grace window: we keep the run in state for up to
        // PRUNE_GRACE_MS even when its id isn't in the current HTML.
        // Each call either sets a "first missing at" timestamp, clears
        // it when the id reappears, or commits the prune once the
        // window elapses. The timestamp lives in a module-level Map
        // so it survives individual setSoapSection invocations.
        const nowMs = Date.now();
        const nextRuns = current.macroRuns.filter((run) => {
          if (run.section !== section) return true;
          const key = `${current.id}:${run.id}`;
          const present = value.includes(`data-macro-run-id="${run.id}"`);
          if (present) {
            macroRunPruneGrace.delete(key);
            return true;
          }
          const firstMissingAt = macroRunPruneGrace.get(key);
          if (firstMissingAt === undefined) {
            // Just went missing — mark and keep for the grace period.
            macroRunPruneGrace.set(key, nowMs);
            return true;
          }
          if (nowMs - firstMissingAt < MACRO_RUN_PRUNE_GRACE_MS) {
            return true; // still inside the grace window
          }
          // Grace expired — commit the prune.
          macroRunPruneGrace.delete(key);
          return false;
        });
        // If any run was actually pruned (grace expired), drop every
        // charge whose linkedMacroRunId now points to a missing run.
        // User-owned manual charges (no linkedMacroRunId) are left
        // alone. Charges whose run is still in its grace window are
        // also preserved so a quick cut+paste doesn't orphan them.
        let nextCharges = current.charges;
        if (nextRuns.length !== current.macroRuns.length) {
          const liveRunIds = new Set(nextRuns.map((r) => r.id));
          nextCharges = current.charges.filter((charge) =>
            charge.linkedMacroRunId ? liveRunIds.has(charge.linkedMacroRunId) : true,
          );
        }
        return {
          ...current,
          soap: {
            ...current.soap,
            [section]: value,
          },
          macroRuns: nextRuns,
          charges: nextCharges,
        };
      });
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
      const trimmedSnippet = normalizeEditorBlocks(snippet);
      if (!trimmedSnippet) {
        return;
      }
      upsertEncounter(encounterId, (current) => {
        const existing = normalizeEditorBlocks(current.soap[section]);
        // Use exactly one blank-paragraph separator between existing content
        // and the new snippet. Both sides are fully normalized first, and
        // the composed result is normalized again so any run of empty
        // blocks (from contentEditable quirks or macro bodies that end in
        // their own trailing paragraph) collapses to a single canonical
        // <p><br></p>.
        const composed = existing
          ? `${existing}<p><br></p>${trimmedSnippet}`
          : trimmedSnippet;
        const nextText = normalizeEditorBlocks(composed);
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

  /**
   * Add multiple charges in a single atomic state update (no race conditions).
   * Skips any input whose CPT already exists on the encounter so SALT +
   * reconcile can't create duplicate rows.
   */
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
      let addedCount = 0;
      upsertEncounter(encounterId, (current) => {
        // Build a set of CPTs already on the encounter so we skip duplicates.
        const existingCodes = new Set(
          current.charges.map((c) => c.procedureCode.toUpperCase()),
        );
        const toAdd: EncounterChargeEntry[] = [];
        for (const entry of valid) {
          if (existingCodes.has(entry.procedureCode)) continue;
          existingCodes.add(entry.procedureCode); // also dedup within batch
          toAdd.push(entry);
        }
        addedCount = toAdd.length;
        if (toAdd.length === 0) return current;
        return {
          ...current,
          charges: [...current.charges, ...toAdd],
        };
      });
      return addedCount;
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

  /**
   * Remove a charge row. If the charge was auto-added by the option-linked
   * pipeline (has `linkedMacroRunId`), also unpick every matching option
   * across every macro run on this encounter — identified by CPT match.
   *
   * This keeps SOAP and billing in sync: if the user removes "LLLT" from
   * billing, the "Treatments Performed:" question no longer claims LLLT
   * was done, so the next reconciliation won't re-add it.
   *
   * Dedup note: several regions may all pick the same CPT (Head + Cervical
   * both picking LLLT). Since the dedup keeps only one charge row, removing
   * that one row unpicks the option in every region that contributed it.
   * That is intentional — the user is saying "I didn't do this at all."
   *
   * If macroLibraryById isn't provided we fall back to the old behavior
   * (remove charge only, no unpick). Callers that want SOAP/billing sync
   * should pass it.
   */
  const removeCharge = useCallback(
    (
      encounterId: string,
      chargeId: string,
      macroLibraryById?: Map<string, MacroTemplate>,
    ) => {
      upsertEncounter(encounterId, (current) => {
        const target = current.charges.find((c) => c.id === chargeId);
        if (!target) return current;

        const filteredCharges = current.charges.filter((c) => c.id !== chargeId);

        // Fast path: no unpick logic needed.
        if (!target.linkedMacroRunId || !macroLibraryById) {
          return { ...current, charges: filteredCharges };
        }

        const targetCode = target.procedureCode.toUpperCase();
        // Collect the (runId, questionId, newValueStr) tuples we need to
        // rewrite in the SOAP section HTML so the visible prompt span
        // matches the new answer. Without this, the SOAP would keep
        // showing the old pick text until the user re-opens the picker.
        const soapRewrites: Array<{
          runId: string;
          questionId: string;
          newValue: string;
        }> = [];

        const updatedRuns = current.macroRuns.map((run) => {
          const macro = macroLibraryById.get(run.macroId);
          if (!macro) return run;
          let touched = false;
          const nextAnswers: typeof run.answers = { ...run.answers };
          let nextGeneratedText = run.generatedText;
          for (const question of macro.questions) {
            if (!question.linksCharges || !question.optionCharges) continue;
            const answer = run.answers[question.id];
            if (answer === undefined) continue;
            const isMultiCandidate = Array.isArray(answer);
            const picks = isMultiCandidate ? answer : [answer];
            const nextPicks = picks.filter((pick) => {
              const link = question.optionCharges?.[pick];
              return !link || link.procedureCode.toUpperCase() !== targetCode;
            });
            if (nextPicks.length !== picks.length) {
              touched = true;
              const nextAnswer = isMultiCandidate
                ? nextPicks
                : nextPicks[0] ?? "";
              nextAnswers[question.id] = nextAnswer;
              const newValueStr = formatMacroAnswerValue(nextAnswer);
              // Rewrite the prompt span inside the run's own generatedText
              // so re-salting or prompt-level editing starts from the
              // correct baseline.
              nextGeneratedText = replacePromptSpan(
                nextGeneratedText,
                run.id,
                question.id,
                newValueStr,
              );
              soapRewrites.push({
                runId: run.id,
                questionId: question.id,
                newValue: newValueStr,
              });
            }
          }
          return touched
            ? { ...run, answers: nextAnswers, generatedText: nextGeneratedText }
            : run;
        });

        // Apply the same prompt-span rewrites to every SOAP section so the
        // rendered HTML matches the new picks.
        let nextSoap = current.soap;
        if (soapRewrites.length > 0) {
          nextSoap = { ...current.soap };
          for (const section of encounterSections) {
            let sectionText = nextSoap[section];
            for (const rewrite of soapRewrites) {
              sectionText = replacePromptSpan(
                sectionText,
                rewrite.runId,
                rewrite.questionId,
                rewrite.newValue,
              );
            }
            nextSoap[section] = sectionText;
          }
        }

        return {
          ...current,
          charges: filteredCharges,
          macroRuns: updatedRuns,
          soap: nextSoap,
        };
      });
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
            // Respect the question-level opt-in flag. If the user turned
            // `linksCharges` off, ignore any stale optionCharges data so
            // their encounter charges aren't silently mutated.
            if (!question.linksCharges) continue;
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
        // Track all CPTs already emitted so we never produce duplicate rows.
        // This is the safety net for any code path that inadvertently added
        // the same CPT twice (e.g. addChargesBulk running right after
        // reconcile in the same render cycle).
        const emittedCodes = new Set<string>();
        for (const charge of current.charges) {
          const code = charge.procedureCode.toUpperCase();
          const match = expected.get(code);
          if (match) {
            if (adopted.has(code)) {
              // Duplicate CPT row — drop the extra. This happens when
              // auto-salt charges runs after auto-salt SOAP reconcile added
              // the same CPT in the same render cycle.
              continue;
            }
            adopted.add(code);
            emittedCodes.add(code);
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
          // User-owned manual / billing-macro charge — keep untouched,
          // but skip if we already have a row with this CPT.
          if (emittedCodes.has(code)) continue;
          emittedCodes.add(code);
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
      // The auto-delete diff inside dualWriteEncounterNotesToCloud was
      // removed because it was wiping rows that were merely missing from
      // a pruned localStorage cache. User-initiated deletes go through
      // this explicit cloud-delete instead so the row actually leaves
      // the encounter_notes table.
      void import("@/lib/encounter-notes-cloud").then(
        ({ deleteEncounterNoteFromTable }) =>
          deleteEncounterNoteFromTable(encounterId).catch((err) => {
            console.error(
              `[use-encounter-notes] cloud delete(${encounterId}) failed:`,
              err,
            );
          }),
      );
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

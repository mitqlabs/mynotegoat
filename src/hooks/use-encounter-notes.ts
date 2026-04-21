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
};

type UpdateEncounterPatch = Partial<
  Pick<EncounterNoteRecord, "provider" | "appointmentType" | "encounterDate" | "patientName">
>;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Strip empty block wrappers from the leading AND trailing edge of an HTML
 * string. Covers every empty-paragraph variant a contentEditable or our
 * template renderer might emit:
 *   - <p></p>, <p><br></p>, <p><br/></p>
 *   - <p>&nbsp;</p>, <p> </p>
 *   - <div></div>, <div><br></div>
 * Run against both the existing SOAP text and the incoming snippet inside
 * `appendSoapSection` so that inserting after an editor that left behind
 * trailing empty paragraphs doesn't compound into 2–3 blank lines.
 */
// Shared pattern for "visually empty paragraph" shapes a
// contentEditable / macro-template pipeline can emit:
//   <p></p>                      — no content
//   <p><br></p>  <p><br/></p>    — single break, both self-closed variants
//   <p>&nbsp;</p>                — non-breaking space placeholder
//   <p><br><br></p>              — multiple breaks (several Enter presses)
//   <p class="..."></p>          — attribute-carrying empty paragraphs
//   <p><span></span></p>         — empty inline wrappers left by contentEditable
//   <div>…same variants…</div>   — some browsers emit div instead of p
//   <h1></h1> … <h6></h6>        — empty headings (format-block then backspace)
//   <br>                         — a stray <br> between blocks
//
// The `emptyInlineFiller` piece covers the inline-but-invisible
// residue (spans/fonts/strong/em/etc) that contentEditable often
// leaves inside a "cleared" paragraph.
const emptyInlineFiller =
  "(?:&nbsp;|<br\\s*\\/?\\s*>|<(?:span|font|strong|em|u|b|i)(?:\\s[^>]*)?>\\s*(?:&nbsp;)?\\s*<\\/(?:span|font|strong|em|u|b|i)>)\\s*";
const emptyBlockPatternSource =
  `(?:<(?:p|div|h[1-6])(?:\\s[^>]*)?>\\s*(?:${emptyInlineFiller})*<\\/(?:p|div|h[1-6])>\\s*|<br\\s*\\/?\\s*>\\s*)`;

function stripEdgeEmptyBlocks(html: string): string {
  const leading = new RegExp(`^(?:${emptyBlockPatternSource})+`, "gi");
  const trailing = new RegExp(`(?:${emptyBlockPatternSource})+$`, "gi");
  // Loop once to catch nesting cases — e.g. stripping a <br> can
  // reveal a preceding empty <p>, which the next pass will catch.
  let next = html;
  for (let i = 0; i < 4; i++) {
    const before = next;
    next = next.replace(leading, "").replace(trailing, "");
    if (before === next) break;
  }
  return next;
}

/**
 * DOM-based HTML normalizer for SOAP section content. Much more
 * reliable than the regex-only `stripEdgeEmptyBlocks` +
 * `collapseConsecutiveEmptyBlocks` combo because the browser sometimes
 * emits obscure empty-block shapes (e.g. <p style="..."><span><br></span></p>)
 * that regexes miss.
 *
 * Behavior:
 *   - Strips any leading/trailing "visually empty" blocks.
 *   - Reduces runs of 2+ consecutive empty blocks anywhere in the HTML
 *     down to exactly one canonical <p><br></p> separator.
 *   - Non-block whitespace-only text nodes between blocks are dropped.
 *
 * "Visually empty" = tagName is a block element (p, div, h1-h6,
 * blockquote, pre), and after stripping whitespace there's no text
 * content AND no interactive / atomic descendant (images, inputs,
 * macro-prompt spans).
 *
 * Falls back to the regex strippers if DOMParser isn't available
 * (SSR safety net — this code path only runs from user actions in
 * the browser, but guard anyway).
 */
function normalizeEditorBlocks(html: string): string {
  const source = html.trim();
  if (!source) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // SSR fallback — shouldn't be hit in practice, but return a safe
    // reduction using the existing regex strippers.
    return collapseConsecutiveEmptyBlocksRegex(stripEdgeEmptyBlocks(source));
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!doctype html><body>${source}</body>`, "text/html");
  const body = doc.body;

  const isVisuallyEmpty = (el: Element): boolean => {
    // Text must be entirely whitespace (including &nbsp; which is
    // a non-breaking space char).
    const text = (el.textContent ?? "").replace(/[\s\u00A0]/g, "");
    if (text) return false;
    // Any atomic/interactive content keeps the block alive.
    if (el.querySelector("img, video, iframe, input, canvas, [data-macro-run-id], [data-prompt-id]")) {
      return false;
    }
    return true;
  };

  const isBlockTag = (tag: string) =>
    /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/i.test(tag);

  // Walk top-level children, rebuilding into a cleaned list.
  const nodes = Array.from(body.childNodes);
  const cleaned: Node[] = [];
  let lastWasEmpty = false;

  const pushCanonicalEmpty = () => {
    if (lastWasEmpty || cleaned.length === 0) return;
    const p = doc.createElement("p");
    p.appendChild(doc.createElement("br"));
    cleaned.push(p);
    lastWasEmpty = true;
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) continue; // whitespace-only text between blocks — drop
      cleaned.push(node);
      lastWasEmpty = false;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName;

    // Stray <br> at the top level acts as a single blank line.
    if (tag === "BR") {
      pushCanonicalEmpty();
      continue;
    }

    if (isBlockTag(tag) && isVisuallyEmpty(el)) {
      pushCanonicalEmpty();
      continue;
    }

    cleaned.push(node);
    lastWasEmpty = false;
  }

  // Strip any trailing empties (pushCanonicalEmpty only skips them
  // when they're the first node, not when content ended on an empty).
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if (last.nodeType === Node.ELEMENT_NODE) {
      const el = last as Element;
      if (isBlockTag(el.tagName) && isVisuallyEmpty(el)) {
        cleaned.pop();
        continue;
      }
    }
    break;
  }

  const wrapper = doc.createElement("div");
  cleaned.forEach((n) => wrapper.appendChild(n));
  return wrapper.innerHTML;
}

/** Regex fallback used by the SSR branch of normalizeEditorBlocks. */
function collapseConsecutiveEmptyBlocksRegex(html: string): string {
  const run = new RegExp(`(?:${emptyBlockPatternSource}){2,}`, "gi");
  return html.replace(run, "<p><br></p>");
}

/**
 * @deprecated kept as a thin wrapper so older call sites keep working;
 * all new code should call normalizeEditorBlocks which also handles
 * leading/trailing stripping in the same pass.
 */
function collapseConsecutiveEmptyBlocks(html: string): string {
  return collapseConsecutiveEmptyBlocksRegex(html);
}

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
      upsertEncounter(encounterId, (current) => {
        // Prune macroRuns whose rendered text (marked by
        // data-macro-run-id="…" spans) no longer exists in the updated
        // HTML for this section. When the user backspaces a macro
        // block out of the SOAP editor, the span is removed from the
        // HTML but the macroRun entry survived — which kept
        // reconcileLinkedCharges seeing the run as "present" and
        // kept its linked CPT charges on the encounter.
        const nextRuns = current.macroRuns.filter((run) => {
          if (run.section !== section) return true;
          return value.includes(`data-macro-run-id="${run.id}"`);
        });
        // If any run was pruned, drop every charge whose
        // linkedMacroRunId points to a now-missing run. User-owned
        // manual charges (no linkedMacroRunId) are left alone.
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

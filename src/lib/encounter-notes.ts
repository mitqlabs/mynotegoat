import { encounters as seedEncounters } from "@/lib/mock-data";
import { type MacroAnswerMap } from "@/lib/macro-templates";

export const encounterSections = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;

export type EncounterSection = (typeof encounterSections)[number];

export interface EncounterDiagnosisEntry {
  id: string;
  code: string;
  description: string;
  source: string;
}

export interface EncounterChargeEntry {
  id: string;
  treatmentMacroId?: string;
  /**
   * If set, this charge was adopted or created by the option-linked charge
   * pipeline for the referenced macro run. Reconciliation uses this as the
   * signal that it is allowed to delete or update the row when macro-run
   * answers change. Charges without this field are considered "user-owned"
   * (manually added or billing-macro-added) and left untouched by the
   * reconciler. Once reconciliation adopts a charge, the field remains set
   * until the charge is removed.
   */
  linkedMacroRunId?: string;
  name: string;
  procedureCode: string;
  unitPrice: number;
  units: number;
}

export interface EncounterMacroRunRecord {
  id: string;
  section: EncounterSection;
  macroId: string;
  macroName: string;
  body: string;
  answers: MacroAnswerMap;
  generatedText: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncounterNoteRecord {
  id: string;
  patientId: string;
  patientName: string;
  provider: string;
  appointmentType: string;
  encounterDate: string;
  startTime: string;
  /** Stable id of the appointment this encounter was created from
   *  (when applicable). The patient page used to join encounters to
   *  appointments purely by date + type, which orphaned the link any
   *  time the appointment date drifted or got rebuilt. With this set,
   *  the join can match by id first and only fall back to date+type
   *  for legacy encounters (created before this field existed). */
  appointmentId?: string;
  soap: Record<EncounterSection, string>;
  macroRuns: EncounterMacroRunRecord[];
  diagnoses: EncounterDiagnosisEntry[];
  charges: EncounterChargeEntry[];
  signed: boolean;
  signedAt: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "casemate.encounter-notes.v1";

function toUsDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split("/");
    return `${month}/${day}/20${year}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    return `${month}/${day}/${year}`;
  }
  return "";
}

function splitLegacyEncounterDate(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))$/i);
  if (!match) {
    return {
      encounterDate: toUsDate(trimmed) || "",
      startTime: "",
    };
  }
  return {
    encounterDate: toUsDate(match[1]) || "",
    startTime: "",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function defaultSoapBySection(): Record<EncounterSection, string> {
  return {
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  };
}

function createSeedRecords(): EncounterNoteRecord[] {
  return seedEncounters.map((entry) => {
    const { encounterDate, startTime } = splitLegacyEncounterDate(entry.encounterDate);
    const timestamp = nowIso();
    return {
      id: entry.id,
      patientId: entry.patientId,
      patientName: entry.patientName,
      provider: entry.provider,
      appointmentType: entry.appointmentType,
      encounterDate,
      startTime,
      soap: defaultSoapBySection(),
      macroRuns: [],
      diagnoses: [],
      charges: [],
      signed: entry.signed,
      signedAt: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

function normalizeDiagnosis(value: unknown): EncounterDiagnosisEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<EncounterDiagnosisEntry>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const source = typeof row.source === "string" ? row.source.trim() : "Manual";
  if (!id || !code || !description) {
    return null;
  }
  return {
    id,
    code,
    description,
    source,
  };
}

function normalizeCharge(value: unknown): EncounterChargeEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<EncounterChargeEntry>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const procedureCode = typeof row.procedureCode === "string" ? row.procedureCode.trim().toUpperCase() : "";
  if (!id || !name || !procedureCode) {
    return null;
  }
  const unitPrice = typeof row.unitPrice === "number" && Number.isFinite(row.unitPrice) ? Math.max(0, row.unitPrice) : 0;
  const units =
    typeof row.units === "number" && Number.isFinite(row.units)
      ? Math.max(1, Math.round(row.units))
      : 1;
  return {
    id,
    treatmentMacroId: typeof row.treatmentMacroId === "string" ? row.treatmentMacroId : undefined,
    linkedMacroRunId: typeof row.linkedMacroRunId === "string" ? row.linkedMacroRunId : undefined,
    name,
    procedureCode,
    unitPrice,
    units,
  };
}

function normalizeSoap(value: unknown) {
  const defaults = defaultSoapBySection();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const row = value as Partial<Record<EncounterSection, unknown>>;
  return {
    subjective: typeof row.subjective === "string" ? row.subjective : defaults.subjective,
    objective: typeof row.objective === "string" ? row.objective : defaults.objective,
    assessment: typeof row.assessment === "string" ? row.assessment : defaults.assessment,
    plan: typeof row.plan === "string" ? row.plan : defaults.plan,
  };
}

function normalizeMacroRun(value: unknown): EncounterMacroRunRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<EncounterMacroRunRecord>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const section = row.section;
  const macroId = typeof row.macroId === "string" ? row.macroId.trim() : "";
  const macroName = typeof row.macroName === "string" ? row.macroName.trim() : "";
  const body = typeof row.body === "string" ? row.body : "";
  const generatedText = typeof row.generatedText === "string" ? row.generatedText : "";
  const answers =
    row.answers && typeof row.answers === "object"
      ? Object.entries(row.answers).reduce<MacroAnswerMap>((accumulator, [key, rawValue]) => {
          if (typeof rawValue === "string") {
            accumulator[key] = rawValue;
            return accumulator;
          }
          if (Array.isArray(rawValue)) {
            const normalizedValues = rawValue
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter((entry) => entry.length > 0);
            accumulator[key] = normalizedValues;
          }
          return accumulator;
        }, {})
      : {};
  if (
    !id ||
    !macroId ||
    !macroName ||
    !generatedText ||
    !section ||
    !encounterSections.includes(section)
  ) {
    return null;
  }
  return {
    id,
    section,
    macroId,
    macroName,
    body,
    answers,
    generatedText,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : nowIso(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
  };
}

function normalizeRecord(value: unknown): EncounterNoteRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<EncounterNoteRecord>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const patientId = typeof row.patientId === "string" ? row.patientId.trim() : "";
  const patientName = typeof row.patientName === "string" ? row.patientName.trim() : "";
  const provider = typeof row.provider === "string" ? row.provider.trim() : "";
  const appointmentType = typeof row.appointmentType === "string" ? row.appointmentType.trim() : "";
  const encounterDate = typeof row.encounterDate === "string" ? toUsDate(row.encounterDate) : "";
  if (!id || !patientId || !patientName || !provider || !appointmentType || !encounterDate) {
    return null;
  }

  const appointmentId =
    typeof row.appointmentId === "string" ? row.appointmentId.trim() : "";
  return {
    id,
    patientId,
    patientName,
    provider,
    appointmentType,
    encounterDate,
    startTime: "",
    appointmentId: appointmentId || undefined,
    soap: normalizeSoap(row.soap),
    macroRuns: Array.isArray(row.macroRuns)
      ? row.macroRuns.map(normalizeMacroRun).filter((entry): entry is EncounterMacroRunRecord => Boolean(entry))
      : [],
    diagnoses: Array.isArray(row.diagnoses)
      ? row.diagnoses.map(normalizeDiagnosis).filter((entry): entry is EncounterDiagnosisEntry => Boolean(entry))
      : [],
    charges: Array.isArray(row.charges)
      ? row.charges.map(normalizeCharge).filter((entry): entry is EncounterChargeEntry => Boolean(entry))
      : [],
    signed: row.signed === true,
    signedAt: typeof row.signedAt === "string" ? row.signedAt : "",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : nowIso(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
  };
}

export function loadEncounterNoteRecords() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeRecord)
      .filter((entry): entry is EncounterNoteRecord => Boolean(entry));
  } catch {
    return [];
  }
}

let previousNotesById: Map<string, EncounterNoteRecord> = new Map();

/**
 * Max number of days to keep encounters cached in localStorage.
 * Older encounters are still safe in the cloud — they just won't
 * take up localStorage space.  This prevents the 5 MB quota from
 * filling up as the encounter list grows over months/years.
 */
const LOCAL_CACHE_DAYS = 90;
// Hard byte ceiling on the encounter-notes localStorage blob. The full
// localStorage quota is ~5 MB; we need to leave room for patients,
// appointments, macros, templates, draft-recovery keys, the safety
// backup, and every other casemate.* key. 1.25 MB is generous for
// encounter notes specifically.
const LOCAL_CACHE_MAX_BYTES = 1_250_000;
// Hard ceiling on encounter count regardless of date. Above this we
// keep only the most-recent N. Everything else still lives in the
// cloud table and can be fetched on demand.
const LOCAL_CACHE_MAX_RECORDS = 100;

function encounterDateStamp(r: EncounterNoteRecord): number {
  const match = r.encounterDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  return new Date(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
  ).getTime();
}

/**
 * Return only the encounters that are safe to cache locally. Three
 * trimming passes so we never hit QuotaExceededError on a SOAP save:
 *   1. Drop records older than LOCAL_CACHE_DAYS
 *   2. If still more than LOCAL_CACHE_MAX_RECORDS, keep the most
 *      recent LOCAL_CACHE_MAX_RECORDS by encounter date
 *   3. If the serialized size still exceeds LOCAL_CACHE_MAX_BYTES,
 *      trim off the oldest records one-by-one until it fits
 * Dropped records remain in the cloud — only the local cache shrinks.
 */
function pruneForLocalStorage(records: EncounterNoteRecord[]): EncounterNoteRecord[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOCAL_CACHE_DAYS);
  const cutoffStamp = cutoff.getTime();

  // Pass 1: age-based prune.
  let kept = records.filter((r) => {
    const stamp = encounterDateStamp(r);
    if (stamp === 0) return true; // unparseable dates pass through
    return stamp >= cutoffStamp;
  });

  // Pass 2: count-based prune (most-recent wins).
  if (kept.length > LOCAL_CACHE_MAX_RECORDS) {
    kept = [...kept]
      .sort((a, b) => encounterDateStamp(b) - encounterDateStamp(a))
      .slice(0, LOCAL_CACHE_MAX_RECORDS);
  }

  // Pass 3: byte-budget prune. Serialize; if over budget, strip the
  // oldest record and retry until we fit. Guarantees we never exceed
  // LOCAL_CACHE_MAX_BYTES which means localStorage.setItem won't throw.
  let serialized = JSON.stringify(kept);
  if (serialized.length <= LOCAL_CACHE_MAX_BYTES) return kept;
  kept = [...kept].sort((a, b) => encounterDateStamp(b) - encounterDateStamp(a));
  while (kept.length > 1 && JSON.stringify(kept).length > LOCAL_CACHE_MAX_BYTES) {
    kept.pop(); // drop oldest
  }
  serialized = JSON.stringify(kept);
  if (serialized.length > LOCAL_CACHE_MAX_BYTES) {
    // Single record is somehow over budget. Keep it anyway — the caller
    // will see a quota error on setItem, but dropping it entirely means
    // the user can't see their current encounter. Better to fail the
    // write than silently hide their data.
    console.warn(
      `[encounter-notes] Single encounter exceeds localStorage budget (${serialized.length} bytes). ` +
        "The cloud copy is still safe; localStorage write may fail.",
    );
  }
  return kept;
}

export function saveEncounterNoteRecords(records: EncounterNoteRecord[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // Only cache recent encounters in localStorage to stay under 5 MB.
  // ALL records still go to the cloud via dual-write below.
  const localSubset = pruneForLocalStorage(records);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(localSubset));
  } catch (err) {
    // localStorage can throw QuotaExceededError — log but don't crash the app.
    console.error("[encounter-notes] localStorage write failed:", err);
    return false;
  }

  // Committed successfully → clear the crash-safe drafts for each
  // encounter/section whose current content matches what we just
  // wrote. Drafts only exist to recover work that hadn't been
  // committed yet, so keeping them after a successful commit is noise.
  // We lazy-import draft-recovery because encounter-notes.ts is a
  // shared module and draft-recovery is browser-only.
  // Clear every pending draft for every encounter we just saved,
  // SYNCHRONOUSLY — no dynamic import, no async gap. The previous
  // version used `void import("@/lib/draft-recovery").then(...)`,
  // which left a ~10ms window after commit during which a fresh
  // keystroke could write a new draft before the old drafts were
  // cleared, re-inventing the exact "banner on every reload"
  // problem the wider fix was meant to solve. Do the removeItem
  // calls inline against the same prefix shape that draft-recovery
  // uses so there's no cross-module ordering race.
  try {
    for (const record of records) {
      for (const section of encounterSections) {
        // Matches draftKeyFor(record.id, section) — keep in sync with
        // src/lib/draft-recovery.ts DRAFT_KEY_PREFIX.
        const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, "");
        const safeSection = section.replace(/[^a-zA-Z0-9_-]/g, "");
        window.localStorage.removeItem(`casemate.draft.v1.${safeId}.${safeSection}`);
      }
    }
  } catch {
    // Non-fatal — scanDrafts GC will clean up on next app load.
  }
  // Always dual-write the FULL set to cloud (not the pruned subset).
  // We don't await here because saveEncounterNoteRecords is sync for
  // backwards compatibility, but the inner function reports failures
  // through the sync status system via reportCloudWriteError. The
  // `.catch` below does NOT silently swallow — it routes any error
  // that somehow ESCAPED dualWrite's own error reporting (e.g. the
  // dynamic import throwing before dualWrite runs) into the same
  // reportCloudWriteError pipeline so the user sees the red pill.
  dualWriteEncounterNotesToCloud(records, previousNotesById).catch((err) => {
    // Lazy-import to avoid a circular dep between encounter-notes and
    // storage-sync-interceptor. The reportCloudWriteError helper flips
    // the sync-status indicator to "error" and logs the message.
    void import("@/lib/storage-sync-interceptor").then(({ reportCloudWriteError }) => {
      reportCloudWriteError("encounter-notes dual-write (pre-run)", err);
    });
  });
  previousNotesById = new Map(records.map((n) => [n.id, n]));
  return true;
}

/**
 * Force-save ALL encounters to both localStorage and cloud (bulk upsert).
 * Used by the "Save All Encounters" button — bypasses the diff-based
 * dual-write and pushes everything unconditionally.
 */
export async function forceSaveAllEncountersToCloud(
  records: EncounterNoteRecord[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  // 1. Save to localStorage first
  const lsOk = saveEncounterNoteRecords(records);
  if (!lsOk) {
    return { ok: false, count: 0, error: "localStorage write failed (storage may be full)" };
  }

  // 2. Bulk-upsert everything to cloud, WITH visible status signals so the
  // user gets the familiar blue "Saving to cloud..." pill during the
  // write and the green "Cloud Saved ✓" pill when it succeeds. Without
  // these signals the Save Encounters button looked silent even when
  // the save was working — terrifying for a user who's worried their
  // data isn't persisting.
  const { reportCloudWriteStart, reportCloudWriteSuccess, reportCloudWriteError } =
    await import("@/lib/storage-sync-interceptor");
  try {
    const { isCloudEntityEnabled } = await import("@/lib/feature-flags");
    if (!isCloudEntityEnabled("encounterNotes")) {
      return { ok: true, count: records.length, error: "Cloud sync is disabled" };
    }
    reportCloudWriteStart("Save Encounters");
    const { bulkUpsertEncounterNotesToTable } = await import("@/lib/encounter-notes-cloud");
    const result = await bulkUpsertEncounterNotesToTable(records);
    if (result.ok) {
      reportCloudWriteSuccess("Save Encounters");
    } else {
      reportCloudWriteError("Save Encounters", new Error(result.error ?? "Unknown error"));
    }
    return result;
  } catch (error) {
    console.error("[encounter-notes] force cloud save failed:", error);
    reportCloudWriteError("Save Encounters", error);
    return {
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : "Unknown cloud save error",
    };
  }
}

// ── Single-writer queue for the encounter dual-write ──
// Before this guard, rapid SOAP edits triggered overlapping cloud
// pushes that contested the navigator.locks auth lock used by
// supabase-js's getUser(). The losing op died with
//   "Lock broken by another request with the 'steal' option"
// and the user saw the blue "saving" pill stuck forever while
// nothing actually persisted. We collapse concurrent writes here:
// at most one push runs at a time; if a new one comes in mid-flight,
// it replaces any earlier queued args (since the latest snapshot
// supersedes anything in the middle), and runs as soon as the in-
// flight one settles. End result: same data ends up in the cloud,
// no lock contention, no stuck pill.
let dualWriteInFlight: Promise<void> | null = null;
let dualWritePending: {
  records: EncounterNoteRecord[];
  prevById: Map<string, EncounterNoteRecord>;
} | null = null;

async function runDualWriteSerialized(
  records: EncounterNoteRecord[],
  prevById: Map<string, EncounterNoteRecord>,
): Promise<void> {
  if (dualWriteInFlight) {
    // Replace any previously queued args with the latest snapshot.
    dualWritePending = { records, prevById };
    return dualWriteInFlight;
  }
  const startNext = (
    args: { records: EncounterNoteRecord[]; prevById: Map<string, EncounterNoteRecord> },
  ): Promise<void> => {
    return runDualWriteUnserialized(args.records, args.prevById).finally(() => {
      const next = dualWritePending;
      dualWritePending = null;
      if (next) {
        // Chain the queued run after the current one finishes.
        dualWriteInFlight = startNext(next);
      } else {
        dualWriteInFlight = null;
      }
    });
  };
  dualWriteInFlight = startNext({ records, prevById });
  return dualWriteInFlight;
}

/**
 * Dual-write changed encounters to the cloud table. Returns a promise that
 * resolves when every upsert/delete has settled. Failures are surfaced via
 * the sync status system AND re-thrown as an aggregate error so the caller
 * can choose to react (e.g., the "Save All Encounters" button can show a
 * toast). Previous behavior was fire-and-forget with silent `console.error`
 * — that's the exact pattern that lost 94 encounters.
 *
 * Public entry point routes through `runDualWriteSerialized` so concurrent
 * callers from rapid SOAP edits don't lock-steal each other.
 */
function dualWriteEncounterNotesToCloud(
  nextRecords: EncounterNoteRecord[],
  prevById: Map<string, EncounterNoteRecord>,
): Promise<void> {
  return runDualWriteSerialized(nextRecords, prevById);
}

async function runDualWriteUnserialized(
  nextRecords: EncounterNoteRecord[],
  prevById: Map<string, EncounterNoteRecord>,
): Promise<void> {
  const [
    { isCloudEntityEnabled },
    { upsertEncounterNoteToTable, deleteEncounterNoteFromTable },
    { reportCloudWriteError, reportCloudWriteStart, reportCloudWriteSuccess },
    { runBatched },
  ] = await Promise.all([
    import("@/lib/feature-flags"),
    import("@/lib/encounter-notes-cloud"),
    import("@/lib/storage-sync-interceptor"),
    import("@/lib/cloud-auth"),
  ]);
  if (!isCloudEntityEnabled("encounterNotes")) return;

  const nextById = new Map(nextRecords.map((n) => [n.id, n]));
  // Build TASK FACTORIES (thunks) instead of already-running Promises so
  // the batched runner can pace them. Firing all 21+ at once is what
  // caused the "21 of 21 failed / Failed to fetch" bug report — a single
  // transient network blip took them all down together because each
  // in-flight call hit the same momentary network drop.
  const tasks: Array<() => Promise<unknown>> = [];
  for (const note of nextRecords) {
    const prev = prevById.get(note.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(note)) {
      tasks.push(() => upsertEncounterNoteToTable(note));
    }
  }
  // ── Auto-delete REMOVED ──
  // Previously we issued deletes for any prevById key not in nextRecords.
  // That assumed nextRecords was always the canonical full set. It isn't:
  //  - The localStorage cache prunes to the most recent 100 records / 90
  //    days, so a fresh page load can produce a "next" set that's missing
  //    older encounters — and the diff would queue deletes for them.
  //  - forceSaveAll(patientId) intentionally passes a patient-scoped subset.
  // Either way, an auto-delete here can wipe real data. The user just
  // got rescued by a network "Failed to fetch" that aborted 22 deletes
  // mid-flight; without that we'd have lost 22 encounters from cloud.
  // Real deletions go through the explicit deleteEncounter() user action,
  // which is wired separately. Leaving stale rows in the cloud is a far
  // smaller harm than ever auto-deleting one.
  // ──────────────────────────
  if (tasks.length === 0) return;

  // Flip UI to "syncing" (blue pill) so the user sees their auto-save
  // kick off. Every macro click / SOAP edit that triggers a cloud push
  // shows the pill instead of silently happening in the background.
  reportCloudWriteStart("encounter-notes auto-save");
  const results = await runBatched(tasks, 4);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === 0) {
    // All ops succeeded — flash the green "Cloud Saved ✓" pill so the
    // user gets positive confirmation that their work made it to cloud.
    reportCloudWriteSuccess("encounter-notes auto-save");
    return;
  }

  // Every individual op already called reportCloudWriteError — this is the
  // aggregate signal for any caller that wants a single pass/fail answer.
  const aggregate = new Error(
    `[encounter-notes] ${failures.length} of ${tasks.length} cloud op(s) failed — ` +
      `first reason: ${failures[0].reason instanceof Error ? failures[0].reason.message : String(failures[0].reason)}`,
  );
  reportCloudWriteError("encounter-notes dual-write", aggregate);
  throw aggregate;
}

/**
 * Score how "full" an encounter is — used to pick the best copy
 * when deduplicating records that share patient + date + type.
 */
function encounterContentScore(r: EncounterNoteRecord): number {
  let score = 0;
  if (r.soap.subjective.trim()) score += 1;
  if (r.soap.objective.trim()) score += 1;
  if (r.soap.assessment.trim()) score += 1;
  if (r.soap.plan.trim()) score += 1;
  score += r.charges.length;
  score += r.diagnoses.length;
  score += r.macroRuns.length;
  return score;
}

/**
 * Remove duplicate encounters that share the same patient + date + type.
 * Keeps the copy with more SOAP/charges/diagnoses content; on tie keeps
 * the newer `updatedAt`.
 */
function deduplicateEncounters(records: EncounterNoteRecord[]): EncounterNoteRecord[] {
  const seen = new Map<string, EncounterNoteRecord>();
  for (const rec of records) {
    const key = `${rec.patientId}||${rec.encounterDate}||${rec.appointmentType.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, rec);
      continue;
    }
    // Keep the one with more content; tie-break by updatedAt
    const existingScore = encounterContentScore(existing);
    const newScore = encounterContentScore(rec);
    if (newScore > existingScore || (newScore === existingScore && rec.updatedAt > existing.updatedAt)) {
      seen.set(key, rec);
    }
  }
  return Array.from(seen.values());
}

/**
 * Merge cloud encounter notes with local ones.  For each record keep
 * whichever version has the newer `updatedAt`.  Records that exist
 * only locally are KEPT (cloud may not have them yet because
 * dual-write is async/fire-and-forget).
 */
export function replaceEncounterNotesFromCloud(cloudRecords: EncounterNoteRecord[]) {
  if (typeof window === "undefined") return;

  const localRecords = loadEncounterNoteRecords();
  const cloudById = new Map(cloudRecords.map((n) => [n.id, n]));
  const mergedById = new Map<string, EncounterNoteRecord>();

  // Start with all cloud records
  for (const note of cloudRecords) {
    mergedById.set(note.id, note);
  }

  // Merge local records — keep local if newer or missing from cloud
  for (const local of localRecords) {
    const cloud = cloudById.get(local.id);
    if (!cloud) {
      // Only exists locally (cloud write may still be in flight) — keep it
      mergedById.set(local.id, local);
    } else {
      // Both exist — keep whichever is newer
      const localTime = Date.parse(local.updatedAt) || 0;
      const cloudTime = Date.parse(cloud.updatedAt) || 0;
      if (localTime > cloudTime) {
        mergedById.set(local.id, local);
      }
      // else cloud version is already in mergedById
    }
  }

  // ── Deduplicate by patient + date + type ──
  // When the same encounter was created independently on two devices
  // (e.g. tablet + desktop), the cloud merge can end up with two records
  // that represent the same visit.  Keep the one with more content.
  const deduped = deduplicateEncounters(Array.from(mergedById.values()));

  // Only cache recent encounters locally to avoid filling the 5 MB quota
  const localSubset = pruneForLocalStorage(deduped);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(localSubset));
  } catch {
    // Quota exceeded — localStorage can't hold this, but we still update
    // the in-memory previousNotesById so dual-write diffs work correctly.
    console.warn("[encounter-notes] localStorage quota exceeded during cloud merge");
  }
  previousNotesById = new Map(deduped.map((n) => [n.id, n]));
}

/**
 * Async fallback: fetch encounters from the cloud table when localStorage
 * is empty (e.g. quota exceeded). Returns the records or null.
 */
export async function loadEncounterNotesFromCloud(): Promise<EncounterNoteRecord[] | null> {
  try {
    const { isCloudEntityEnabled } = await import("@/lib/feature-flags");
    if (!isCloudEntityEnabled("encounterNotes")) return null;
    const { fetchAllEncounterNotesFromTable } = await import("@/lib/encounter-notes-cloud");
    return await fetchAllEncounterNotesFromTable();
  } catch (err) {
    console.warn("[encounter-notes] cloud fallback failed:", err);
    return null;
  }
}

export function createEncounterId() {
  return `enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEncounterDiagnosisId() {
  return `edx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEncounterChargeId() {
  return `ech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEncounterMacroRunId() {
  return `emr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNowUsDate() {
  const date = new Date();
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

export function normalizeEncounterDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (!digits) {
    return "";
  }
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

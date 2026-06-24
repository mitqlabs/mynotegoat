"use client";

/**
 * Encounter Notes Cloud — Phase 3 table-backed CRUD.
 * SOAP sections, macro runs, diagnoses, and charges stored as JSONB.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { reportCloudWriteError } from "@/lib/storage-sync-interceptor";
import {
  resolveValidatedWorkspaceId as resolveValidatedWorkspaceIdShared,
  withLockStealRetry,
} from "@/lib/cloud-auth";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";

interface EncounterNoteRow {
  id: string;
  workspace_id: string;
  patient_id: string;
  patient_name: string;
  provider: string;
  appointment_type: string;
  encounter_date: string;
  start_time: string;
  soap: Record<string, string>;
  macro_runs: unknown[];
  diagnoses: unknown[];
  charges: unknown[];
  signed: boolean;
  signed_at: string;
  created_at_record: string;
  updated_at_record: string;
}

function noteToRow(note: EncounterNoteRecord, workspaceId: string): EncounterNoteRow {
  return {
    id: note.id,
    workspace_id: workspaceId,
    patient_id: note.patientId ?? "",
    patient_name: note.patientName ?? "",
    provider: note.provider ?? "",
    appointment_type: note.appointmentType ?? "",
    encounter_date: note.encounterDate ?? "",
    start_time: note.startTime ?? "",
    soap: note.soap ?? { subjective: "", objective: "", assessment: "", plan: "" },
    macro_runs: note.macroRuns ?? [],
    diagnoses: note.diagnoses ?? [],
    charges: note.charges ?? [],
    signed: note.signed ?? false,
    signed_at: note.signedAt ?? "",
    created_at_record: note.createdAt ?? "",
    updated_at_record: note.updatedAt ?? "",
  };
}

function rowToNote(row: EncounterNoteRow): EncounterNoteRecord {
  const soap = (row.soap && typeof row.soap === "object")
    ? row.soap as Record<string, string>
    : { subjective: "", objective: "", assessment: "", plan: "" };
  return {
    id: row.id,
    patientId: row.patient_id ?? "",
    patientName: row.patient_name ?? "",
    provider: row.provider ?? "",
    appointmentType: row.appointment_type ?? "",
    encounterDate: row.encounter_date ?? "",
    startTime: row.start_time ?? "",
    soap: {
      subjective: soap.subjective ?? "",
      objective: soap.objective ?? "",
      assessment: soap.assessment ?? "",
      plan: soap.plan ?? "",
    },
    macroRuns: Array.isArray(row.macro_runs) ? row.macro_runs as EncounterNoteRecord["macroRuns"] : [],
    diagnoses: Array.isArray(row.diagnoses) ? row.diagnoses as EncounterNoteRecord["diagnoses"] : [],
    charges: Array.isArray(row.charges) ? row.charges as EncounterNoteRecord["charges"] : [],
    signed: row.signed ?? false,
    signedAt: row.signed_at ?? "",
    createdAt: row.created_at_record ?? "",
    updatedAt: row.updated_at_record ?? "",
  };
}

/**
 * Public wrapper used by useEncounterNotes' realtime subscription.
 * Supabase Realtime delivers `payload.new` as the raw row (same
 * shape as a SELECT, with snake_case columns). Run it through the
 * shared rowToNote so the React-side type matches what the SELECT
 * path produces — avoids the subscriber holding a slightly-
 * different object shape than the rest of the hook expects.
 *
 * Returns null when the payload isn't a recognisable row (e.g. an
 * empty event, a row without an `id`). The caller skips on null.
 */
export function realtimePayloadToNote(payload: unknown): EncounterNoteRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Partial<EncounterNoteRow>;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  return rowToNote(row as EncounterNoteRow);
}

function getActiveWorkspaceOrNull(): string | null {
  const id = getActiveWorkspaceIdSync();
  return id || null;
}

/**
 * Validate workspace_id prefix matches auth.uid() BEFORE writing. Uses the
 * shared cloud-auth helper so validations are deduped across every
 * *-cloud module (prevents navigator.locks auth-lock contention during
 * bulk write bursts — the same lock-steal AbortError that caused the
 * "cm-patient-597 upsert failed" report).
 */
async function resolveValidatedWorkspaceId(source: string): Promise<string> {
  return resolveValidatedWorkspaceIdShared("[encounter-notes-cloud]", source);
}

export async function fetchAllEncounterNotesFromTable(): Promise<EncounterNoteRecord[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return null;

  // Paginate. Supabase PostgREST caps a single response at 1000 rows.
  // Without pagination, any workspace with >1000 encounters returns
  // only the first 1000 — and the "Loaded 1000 encounter note(s) from
  // table." console line is a giveaway that cloud actually has more.
  // Same shape as the fix in fetchAllAppointmentsFromTable: loop
  // with .range() until a short page comes back.
  const pageSize = 1000;
  const all: EncounterNoteRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("encounter_notes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("[encounter-notes-cloud] fetchAll failed:", error.message);
      return null;
    }
    const rows = (data ?? []) as EncounterNoteRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all.map(rowToNote);
}

export async function bulkUpsertEncounterNotesToTable(
  notes: EncounterNoteRecord[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (notes.length === 0) return { ok: true, count: 0 };

  // Wrap the whole bulk upsert in the lock-steal / network retry helper.
  // SAVE ENCOUNTERS used to fail outright on a single transient
  // navigator-lock contention or WiFi blip — now it retries up to 4
  // times (1 lock-steal + 3 network) before surfacing the error.
  try {
    const result = await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`bulk-upsert(${notes.length})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error("[encounter-notes-cloud] bulk upsert: supabase client not configured");
      }
      const rows = notes.map((n) => noteToRow(n, workspaceId));
      const { error } = await supabase
        .from("encounter_notes")
        .upsert(rows, { onConflict: "workspace_id,id" });
      if (error) {
        throw new Error(`[encounter-notes-cloud] bulk upsert failed: ${error.message}`);
      }
      return rows.length;
    });
    return { ok: true, count: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[encounter-notes-cloud] bulk upsert failed:", message);
    return { ok: false, count: 0, error: message };
  }
}

/**
 * Upsert one encounter to the cloud table. Throws on failure — callers MUST
 * handle errors. Previous behavior (silent console.error and return void) is
 * the exact bug that caused 94 encounters to vanish: fire-and-forget callers
 * never learned the write failed, users never knew, and the data was only
 * safe in localStorage until a device switch or flag flip.
 */
export async function upsertEncounterNoteToTable(note: EncounterNoteRecord): Promise<void> {
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`upsert(${note.id})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error(`[encounter-notes-cloud] upsert(${note.id}): supabase client not configured`);
      }
      const row = noteToRow(note, workspaceId);
      const { error } = await supabase
        .from("encounter_notes")
        .upsert(row, { onConflict: "workspace_id,id" });
      if (error) {
        throw new Error(
          `[encounter-notes-cloud] upsert(${note.id}) failed: ${error.message}`,
        );
      }
    });
  } catch (err) {
    const wrapped =
      err instanceof Error
        ? err
        : new Error(`[encounter-notes-cloud] upsert(${note.id}) failed: ${String(err)}`);
    reportCloudWriteError("encounter-notes upsert", wrapped);
    throw wrapped;
  }
}

export async function deleteEncounterNoteFromTable(noteId: string): Promise<void> {
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`delete(${noteId})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error(`[encounter-notes-cloud] delete(${noteId}): supabase client not configured`);
      }
      const { error } = await supabase
        .from("encounter_notes")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", noteId);
      if (error) {
        throw new Error(
          `[encounter-notes-cloud] delete(${noteId}) failed: ${error.message}`,
        );
      }
    });
  } catch (err) {
    const wrapped =
      err instanceof Error
        ? err
        : new Error(`[encounter-notes-cloud] delete(${noteId}) failed: ${String(err)}`);
    reportCloudWriteError("encounter-notes delete", wrapped);
    throw wrapped;
  }
}

export async function isEncounterNotesTableReady(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return false;

  const { error } = await supabase
    .from("encounter_notes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    console.warn("[encounter-notes-cloud] table not ready:", error.message);
    return false;
  }
  return true;
}

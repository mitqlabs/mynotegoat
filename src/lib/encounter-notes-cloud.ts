"use client";

/**
 * Encounter Notes Cloud — Phase 3 table-backed CRUD.
 * SOAP sections, macro runs, diagnoses, and charges stored as JSONB.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { reportCloudWriteError } from "@/lib/storage-sync-interceptor";
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

function getActiveWorkspaceOrNull(): string | null {
  const id = getActiveWorkspaceIdSync();
  return id || null;
}

/**
 * Assert that the workspace_id we're about to write under actually belongs
 * to the currently-authenticated user. If it doesn't, the RLS policy on
 * encounter_notes would silently reject the insert (policy checks
 * split_part(workspace_id, ':', 1) = auth.uid()). A silent rejection is
 * how we lost 94 encounters — this guard makes that impossible going
 * forward by throwing loudly BEFORE the write goes out.
 *
 * Returns the (validated) workspace id. Throws if anything's wrong.
 */
async function resolveValidatedWorkspaceId(source: string): Promise<string> {
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) {
    throw new Error(`[encounter-notes-cloud] ${source}: no active workspace id in localStorage`);
  }
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error(`[encounter-notes-cloud] ${source}: supabase client not configured`);
  }
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error(`[encounter-notes-cloud] ${source}: auth.getUser failed: ${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new Error(`[encounter-notes-cloud] ${source}: no authenticated user`);
  }
  const prefix = workspaceId.split(":")[0];
  if (prefix !== userId) {
    throw new Error(
      `[encounter-notes-cloud] ${source}: workspace/user mismatch — ` +
        `workspace_id prefix="${prefix}" does not match auth.uid="${userId}". ` +
        `Refusing to write (would be silently rejected by RLS).`,
    );
  }
  return workspaceId;
}

export async function fetchAllEncounterNotesFromTable(): Promise<EncounterNoteRecord[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return null;

  const { data, error } = await supabase
    .from("encounter_notes")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[encounter-notes-cloud] fetchAll failed:", error.message);
    return null;
  }
  return ((data ?? []) as EncounterNoteRow[]).map(rowToNote);
}

export async function bulkUpsertEncounterNotesToTable(
  notes: EncounterNoteRecord[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, count: 0, error: "supabase not configured" };
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return { ok: false, count: 0, error: "no active workspace" };

  if (notes.length === 0) return { ok: true, count: 0 };

  const rows = notes.map((n) => noteToRow(n, workspaceId));
  const { error } = await supabase
    .from("encounter_notes")
    .upsert(rows, { onConflict: "workspace_id,id" });

  if (error) {
    console.error("[encounter-notes-cloud] bulk upsert failed:", error.message);
    return { ok: false, count: 0, error: error.message };
  }
  return { ok: true, count: rows.length };
}

/**
 * Upsert one encounter to the cloud table. Throws on failure — callers MUST
 * handle errors. Previous behavior (silent console.error and return void) is
 * the exact bug that caused 94 encounters to vanish: fire-and-forget callers
 * never learned the write failed, users never knew, and the data was only
 * safe in localStorage until a device switch or flag flip.
 */
export async function upsertEncounterNoteToTable(note: EncounterNoteRecord): Promise<void> {
  const workspaceId = await resolveValidatedWorkspaceId(`upsert(${note.id})`);
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    const err = new Error(`[encounter-notes-cloud] upsert(${note.id}): supabase client not configured`);
    reportCloudWriteError("encounter-notes upsert", err);
    throw err;
  }

  const row = noteToRow(note, workspaceId);
  const { error } = await supabase
    .from("encounter_notes")
    .upsert(row, { onConflict: "workspace_id,id" });

  if (error) {
    const wrapped = new Error(
      `[encounter-notes-cloud] upsert(${note.id}) failed: ${error.message}`,
    );
    reportCloudWriteError("encounter-notes upsert", wrapped);
    throw wrapped;
  }
}

export async function deleteEncounterNoteFromTable(noteId: string): Promise<void> {
  const workspaceId = await resolveValidatedWorkspaceId(`delete(${noteId})`);
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    const err = new Error(`[encounter-notes-cloud] delete(${noteId}): supabase client not configured`);
    reportCloudWriteError("encounter-notes delete", err);
    throw err;
  }

  const { error } = await supabase
    .from("encounter_notes")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", noteId);

  if (error) {
    const wrapped = new Error(
      `[encounter-notes-cloud] delete(${noteId}) failed: ${error.message}`,
    );
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

"use client";

/**
 * Patient Files Cloud — table-backed CRUD, one row per file.
 *
 * Replaces the single-blob file index (casemate.files.v1) that orphaned
 * uploads: with one row per file, a concurrent write can never clobber
 * another file's record. Mirrors patients-cloud / encounter-notes-cloud.
 *
 * Gated by the `patientFiles` feature flag — nothing here runs until that
 * flag is enabled AND the patient_files table exists.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { reportCloudWriteError } from "@/lib/storage-sync-interceptor";
import {
  resolveValidatedWorkspaceId as resolveValidatedWorkspaceIdShared,
  withLockStealRetry,
} from "@/lib/cloud-auth";
import type { FileRecord } from "@/lib/file-manager";

interface PatientFileRow {
  id: string;
  workspace_id: string;
  folder_id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  deleted: boolean;
  deleted_at: string;
  created_at_record: string;
  updated_at_record: string;
}

function fileToRow(file: FileRecord, workspaceId: string): PatientFileRow {
  return {
    id: file.id,
    workspace_id: workspaceId,
    folder_id: file.folderId ?? "",
    name: file.name ?? "",
    storage_path: file.storagePath ?? "",
    mime_type: file.mimeType ?? "application/octet-stream",
    size_bytes: Number.isFinite(file.sizeBytes) ? Math.trunc(file.sizeBytes) : 0,
    deleted: file.deleted ?? false,
    deleted_at: file.deletedAt ?? "",
    created_at_record: file.createdAt ?? "",
    updated_at_record: file.updatedAt ?? "",
  };
}

function rowToFile(row: PatientFileRow): FileRecord {
  return {
    id: row.id,
    folderId: row.folder_id ?? "",
    name: row.name ?? "",
    storagePath: row.storage_path ?? "",
    mimeType: row.mime_type ?? "application/octet-stream",
    sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes) || 0,
    createdAt: row.created_at_record ?? "",
    updatedAt: row.updated_at_record ?? "",
    ...(row.deleted ? { deleted: true } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

function getActiveWorkspaceOrNull(): string | null {
  const id = getActiveWorkspaceIdSync();
  return id || null;
}

async function resolveValidatedWorkspaceId(source: string): Promise<string> {
  return resolveValidatedWorkspaceIdShared("[files-cloud]", source);
}

/** Whether the patient_files table exists and is reachable for this workspace. */
export async function isPatientFilesTableReady(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return false;

  const { error } = await supabase
    .from("patient_files")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    console.warn("[files-cloud] table not ready:", error.message);
    return false;
  }
  return true;
}

/** Fetch every file row for this workspace (paginated). Null on hard failure. */
export async function fetchAllFilesFromTable(): Promise<FileRecord[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return null;

  const pageSize = 1000;
  const all: PatientFileRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("patient_files")
      .select("*")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("[files-cloud] fetchAll failed:", error.message);
      return null;
    }
    const rows = (data ?? []) as PatientFileRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all.map(rowToFile);
}

/** Bulk upsert (insert/update only — never deletes rows it doesn't list, so a
 *  stale client can't drop another user's file). Used for backfill + saves. */
export async function bulkUpsertFilesToTable(
  files: FileRecord[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (files.length === 0) return { ok: true, count: 0 };
  try {
    const result = await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`bulk-upsert(${files.length})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("[files-cloud] bulk upsert: supabase client not configured");
      const rows = files.map((f) => fileToRow(f, workspaceId));
      // Upsert in chunks to stay well under any payload cap.
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("patient_files")
          .upsert(chunk, { onConflict: "workspace_id,id" });
        if (error) throw new Error(`[files-cloud] bulk upsert failed: ${error.message}`);
      }
      return rows.length;
    });
    return { ok: true, count: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[files-cloud] bulk upsert failed:", message);
    return { ok: false, count: 0, error: message };
  }
}

/** Hard-delete rows by id (used only for "permanently delete" from Trash —
 *  normal deletes are soft tombstones that flow through the upsert). */
export async function deleteFilesFromTable(ids: string[]): Promise<void> {
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return;
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`delete(${clean.length})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("[files-cloud] delete: supabase client not configured");
      const { error } = await supabase
        .from("patient_files")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("id", clean);
      if (error) throw new Error(`[files-cloud] delete failed: ${error.message}`);
    });
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(`[files-cloud] delete failed: ${String(err)}`);
    reportCloudWriteError("patient-files delete", wrapped);
    throw wrapped;
  }
}

/** Upsert one file row. Throws on failure so callers can react. */
export async function upsertFileToTable(file: FileRecord): Promise<void> {
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`upsert(${file.id})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error(`[files-cloud] upsert(${file.id}): supabase client not configured`);
      const { error } = await supabase
        .from("patient_files")
        .upsert(fileToRow(file, workspaceId), { onConflict: "workspace_id,id" });
      if (error) throw new Error(`[files-cloud] upsert(${file.id}) failed: ${error.message}`);
    });
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(`[files-cloud] upsert(${file.id}) failed: ${String(err)}`);
    reportCloudWriteError("patient-files upsert", wrapped);
    throw wrapped;
  }
}

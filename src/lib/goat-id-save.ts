"use client";
/**
 * Save an ID picture G.O.A.T. read into the patient's Patient Files — the same
 * cloud storage (Supabase "user-files") and file index the patient page's
 * upload uses, so it's on every device. Named "ID (front|back) - Last, First".
 */
import { uploadFileToStorage } from "@/lib/file-storage";
import { addFileRecord, loadFileManagerState, saveFileManagerState } from "@/lib/file-manager";
import { notifyChange } from "@/lib/local-sync";

/** "ID (back) - Smith, John.jpg" — the "ID" label the Patient Files list shows. */
export function idFileName(fullName: string, side: "front" | "back" | undefined, original: string): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(original)?.[1] ?? "jpg").toLowerCase();
  return `ID${side ? ` (${side})` : ""} - ${fullName}.${ext}`;
}

export async function saveIdToPatientFile(patientId: string, fullName: string, file: File, side?: "front" | "back"): Promise<{ ok: boolean; error?: string; name: string }> {
  const name = idFileName(fullName, side, file.name);
  const state = loadFileManagerState();
  const folder = state.folders.find((f) => f.patientId === patientId && f.isSystemFolder && !f.deleted);
  const folderId = folder?.id ?? `SYSTEM-PATIENT-${patientId}`;
  const named = new File([file], name, { type: file.type || "image/jpeg" });
  const { storagePath, error } = await uploadFileToStorage(folderId, named);
  if (error || !storagePath) return { ok: false, error: error ?? "Upload failed", name };
  // Re-read right before writing so a file added elsewhere meanwhile isn't dropped (cloud merge keeps both too).
  const next = addFileRecord(loadFileManagerState(), { folderId, name, storagePath, mimeType: named.type, sizeBytes: named.size });
  saveFileManagerState(next);
  try { notifyChange("casemate.files.v1"); } catch { /* views refresh on next load */ }
  return { ok: true, name };
}

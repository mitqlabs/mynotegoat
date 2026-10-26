"use client";

import { getSupabaseBrowserClient, getSessionUser } from "@/lib/supabase-browser";
import { forgetGoatText, goatSidecarPath, readUploadedFile } from "@/lib/goat-files";
import { patientIdForFolder, splitCaseNumberPrefix, withCaseNumberPrefix } from "@/lib/file-naming";
import { loadFileManagerState } from "@/lib/file-manager";
import { getPatientById } from "@/lib/mock-data";
import { buildCaseNumber } from "@/lib/follow-up-queue";

/** "<CASE#> <Last>, <First> <name>" for a file going into a patient's folder (or its subfolders). */
export function caseNamedUpload(folderId: string, name: string): string {
  try {
    const pid = patientIdForFolder(loadFileManagerState().folders, folderId);
    const patient = pid ? getPatientById(pid) : null;
    if (!patient) return name;
    return withCaseNumberPrefix(name, buildCaseNumber(patient.dateOfLoss, patient.fullName), patient.fullName);
  } catch {
    return name;
  }
}

/** The locked "<CASE#> <Last>, <First>" part of a patient file's name, if it has one. */
export function caseNamePrefixFor(folderId: string, name: string): { prefix: string; label: string } | null {
  try {
    const pid = patientIdForFolder(loadFileManagerState().folders, folderId);
    const patient = pid ? getPatientById(pid) : null;
    if (!patient) return null;
    return splitCaseNumberPrefix(name, buildCaseNumber(patient.dateOfLoss, patient.fullName), patient.fullName);
  } catch {
    return null;
  }
}

const BUCKET_NAME = "user-files";

// ---------------------------------------------------------------------------
// Get the authenticated user's ID
// ---------------------------------------------------------------------------

async function getAuthUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await getSessionUser(supabase);
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Upload a file to Supabase Storage
// ---------------------------------------------------------------------------

export async function uploadFileToStorage(
  folderId: string,
  original: File,
): Promise<{ storagePath: string; name: string; error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { storagePath: "", name: original.name, error: "Supabase not configured" };

  const userId = await getAuthUserId();
  if (!userId) return { storagePath: "", name: original.name, error: "Not authenticated" };

  // Patient/case uploads get the case # in front of the name.
  const name = caseNamedUpload(folderId, original.name);
  const file =
    name === original.name ? original : new File([original], name, { type: original.type, lastModified: original.lastModified });

  // Prefix with timestamp to avoid name collisions
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${folderId}/${timestamp}-${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    return { storagePath: "", name, error: error.message };
  }

  // G.O.A.T.: read the new file's text in the background, in this browser,
  // from the bytes we already have (PDF text layer, OCR for scans/images).
  readUploadedFile(file, storagePath);

  return { storagePath, name, error: null };
}

// ---------------------------------------------------------------------------
// Get a signed URL for preview/download (1 hour expiry)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  storagePath: string,
): Promise<{ url: string; error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { url: "", error: "Supabase not configured" };

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    return { url: "", error: error?.message ?? "Could not generate URL" };
  }

  return { url: data.signedUrl, error: null };
}

// ---------------------------------------------------------------------------
// Delete a file from Supabase Storage
// ---------------------------------------------------------------------------

/**
 * The file plus G.O.A.T.'s extracted-text sidecar (if one was ever written).
 * Removing a sidecar that doesn't exist is a no-op for Storage.
 */
function withGoatSidecars(paths: string[]): string[] {
  const out = [...paths];
  for (const p of paths) {
    const side = goatSidecarPath(p);
    if (side) out.push(side);
  }
  return out;
}

export async function deleteFileFromStorage(
  storagePath: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { error: "Supabase not configured" };

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove(withGoatSidecars([storagePath]));
  void forgetGoatText([storagePath]);

  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Delete multiple files from Supabase Storage
// ---------------------------------------------------------------------------

export async function deleteFilesFromStorage(
  storagePaths: string[],
): Promise<{ error: string | null }> {
  if (storagePaths.length === 0) return { error: null };

  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { error: "Supabase not configured" };

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove(withGoatSidecars(storagePaths));
  void forgetGoatText(storagePaths);

  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Trigger browser download
// ---------------------------------------------------------------------------

export async function downloadFile(storagePath: string, fileName: string) {
  const { url, error } = await getSignedUrl(storagePath);
  if (error || !url) return;

  try {
    // Fetch as blob so the download attribute works (cross-origin signed URLs
    // cause browsers to ignore the download attribute on plain anchor clicks).
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a short delay to allow the download to start
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch {
    // Fallback: open the signed URL in a new tab
    window.open(url, "_blank");
  }
}

// ---------------------------------------------------------------------------
// Format file size for display
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { forgetGoatText, goatSidecarPath, readUploadedFile } from "@/lib/goat-files";

const BUCKET_NAME = "user-files";

// ---------------------------------------------------------------------------
// Get the authenticated user's ID
// ---------------------------------------------------------------------------

async function getAuthUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Upload a file to Supabase Storage
// ---------------------------------------------------------------------------

export async function uploadFileToStorage(
  folderId: string,
  file: File,
): Promise<{ storagePath: string; error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { storagePath: "", error: "Supabase not configured" };

  const userId = await getAuthUserId();
  if (!userId) return { storagePath: "", error: "Not authenticated" };

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
    return { storagePath: "", error: error.message };
  }

  // G.O.A.T.: read the new file's text in the background, in this browser,
  // from the bytes we already have (PDF text layer, OCR for scans/images).
  readUploadedFile(file, storagePath);

  return { storagePath, error: null };
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

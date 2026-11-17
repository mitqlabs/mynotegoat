"use client";

/**
 * Optional binary copy of a patient photo. The office-shared copy is the
 * person record in workspace_kv. This upload runs only when the folder
 * switch is on. If the bucket has not been created, the upload fails and
 * the person record still holds the photo.
 *
 * The bucket SQL is supabase/patient_photos_bucket.sql. Do not apply it to
 * the production project.
 */
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { isPatientPhotoDataUrl } from "@/lib/patient-photo";

export const PATIENT_PHOTO_BUCKET = "patient-photos";

export async function uploadPatientPhoto(folderId: string, dataUrl: string): Promise<string> {
  if (!patientFoldersEnabled() || !isPatientPhotoDataUrl(dataUrl)) return "";
  try {
    const { getSupabaseBrowserClient, getSessionUser } = await import("@/lib/supabase-browser");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return "";
    const { data } = await getSessionUser(supabase);
    const userId = data.user?.id;
    if (!userId) return "";
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const safeId = folderId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath = `${userId}/patient-photos/${safeId}.jpg`;
    const { error } = await supabase.storage.from(PATIENT_PHOTO_BUCKET).upload(storagePath, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });
    if (error) return "";
    return storagePath;
  } catch {
    return "";
  }
}

"use client";

import { useEffect, useState } from "react";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { loadFolderCloud, subscribeFolderCloud } from "@/lib/patient-folder-store";
import { signedUrlForPatientPhoto } from "@/lib/patient-photo-storage";

/**
 * The folder photo for this case. Prefers a signed URL from the private
 * patient-photos bucket. Falls back to the shared person-record copy when
 * the bucket object cannot be signed, so the same photo still shows.
 * Empty when this patient has no photo.
 */
export function useCasePatientPhoto(folderId: string | null): string {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!folderId || !patientFoldersEnabled()) {
      setSrc("");
      return;
    }
    let cancelled = false;
    const load = () => {
      const person = loadFolderCloud().people[folderId];
      const dataUrl = person?.photoDataUrl?.trim() ?? "";
      const path = person?.photoPath?.trim() ?? "";
      if (!path && !dataUrl) {
        if (!cancelled) setSrc("");
        return;
      }
      if (!path) {
        if (!cancelled) setSrc(dataUrl);
        return;
      }
      void signedUrlForPatientPhoto(path).then((signed) => {
        if (!cancelled) setSrc(signed || dataUrl);
      });
    };
    load();
    const stop = subscribeFolderCloud(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [folderId]);

  return src;
}

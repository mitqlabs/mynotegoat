"use client";

/**
 * Patient Files Preview Panel
 *
 * Drops into the encounter workspace sidebar underneath the encounter list so
 * the provider can quickly peek at the current patient's uploaded files —
 * MRIs, X-rays, PDFs, etc. — without leaving the encounter. Intentionally
 * preview-ONLY: no rename, no delete, no email, no download. The provider
 * goes to the full My Files page for any of that.
 *
 * Each file gets a magnifying-glass button that opens a modal rendering the
 * file inline via a short-lived Supabase signed URL (1 hr). PDFs open in an
 * iframe; images render in an <img>; anything else falls back to a link.
 */

import { useMemo } from "react";
import {
  getFilesInFolder,
  getFoldersInParent,
  type FileFolder,
  type FileRecord,
} from "@/lib/file-manager";
import { formatFileSize, getSignedUrl } from "@/lib/file-storage";
import { useFileManager } from "@/hooks/use-file-manager";
import { patients } from "@/lib/mock-data";

export function PatientFilesPreviewPanel({ patientId }: { patientId: string }) {
  // We reuse the same file-manager hook the full /my-files page uses so the
  // inline panel automatically picks up system-folder sync, soft-deletes, and
  // any future state changes without a separate loader.
  const { state } = useFileManager(patients);

  // Preview opens the file in a NEW TAB (same as the patient page), not a
  // popup modal — signs a fresh URL then opens it.
  const handlePreview = async (file: FileRecord) => {
    const { url, error } = await getSignedUrl(file.storagePath);
    if (!error && url) window.open(url, "_blank");
  };

  // The patient's system folder is the one tagged with this patientId on
  // creation. Any files uploaded for this patient live there or in one of
  // its subfolders.
  const rootFolder = useMemo<FileFolder | null>(() => {
    return (
      state.folders.find(
        (f) => f.patientId === patientId && f.isSystemFolder && !f.deleted,
      ) ?? null
    );
  }, [state.folders, patientId]);

  // Collect every live file under the patient's folder tree (root + nested
  // subfolders). Users commonly drop imaging into a "MRIs" or "X-Rays"
  // subfolder — we want those surfaced inline too.
  const allPatientFiles = useMemo<Array<{ file: FileRecord; folderName: string }>>(() => {
    if (!rootFolder) return [];
    const folderIds = new Set<string>([rootFolder.id]);
    const folderNameById = new Map<string, string>([[rootFolder.id, rootFolder.name]]);
    // BFS through subfolders.
    const queue: string[] = [rootFolder.id];
    while (queue.length) {
      const parentId = queue.shift()!;
      for (const child of getFoldersInParent(state, parentId)) {
        if (!folderIds.has(child.id)) {
          folderIds.add(child.id);
          folderNameById.set(child.id, child.name);
          queue.push(child.id);
        }
      }
    }
    const result: Array<{ file: FileRecord; folderName: string }> = [];
    for (const folderId of folderIds) {
      for (const file of getFilesInFolder(state, folderId)) {
        result.push({ file, folderName: folderNameById.get(folderId) ?? "" });
      }
    }
    // Newest-first so recently uploaded imaging is at the top.
    result.sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt));
    return result;
  }, [state, rootFolder]);

  return (
    <section className="mt-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Patient Files</h4>
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          {allPatientFiles.length} file{allPatientFiles.length === 1 ? "" : "s"}
        </span>
      </div>

      {!rootFolder && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No patient folder yet — upload from the My Files page.
        </p>
      )}

      {rootFolder && allPatientFiles.length === 0 && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No files uploaded for this patient yet.
        </p>
      )}

      {allPatientFiles.length > 0 && (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {allPatientFiles.map(({ file, folderName }) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[var(--text-heading)]">
                  {file.name}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>{folderName}</span>
                  <span>{formatFileSize(file.sizeBytes)}</span>
                </div>
              </div>
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-[var(--text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]"
                onClick={() => handlePreview(file)}
                title="Preview (opens in a new tab)"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="7" strokeLinecap="round" strokeLinejoin="round" />
                  <path
                    d="m20 20-3.5-3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

    </section>
  );
}

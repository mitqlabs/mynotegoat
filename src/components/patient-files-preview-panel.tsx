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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getFilesInFolder,
  getFoldersInParent,
  type FileFolder,
  type FileRecord,
} from "@/lib/file-manager";
import { formatFileSize, getSignedUrl } from "@/lib/file-storage";
import { useFileManager } from "@/hooks/use-file-manager";
import { patients } from "@/lib/mock-data";
import { ScrollLock } from "@/components/scroll-lock";

type PreviewTarget = { file: FileRecord } | null;

export function PatientFilesPreviewPanel({ patientId }: { patientId: string }) {
  // We reuse the same file-manager hook the full /my-files page uses so the
  // inline panel automatically picks up system-folder sync, soft-deletes, and
  // any future state changes without a separate loader.
  const { state } = useFileManager(patients);
  const [preview, setPreview] = useState<PreviewTarget>(null);

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
                onClick={() => setPreview({ file })}
                title="Preview"
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

      {preview && (
        <FilePreviewModal file={preview.file} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// FilePreviewModal — inline popup within the window.
// Signs a fresh URL on open (1 hr TTL). Renders PDFs in an iframe and images
// in an <img>. Unknown types fall back to a "open in new tab" link because
// we don't want to try to inline-render arbitrary binaries.
// ---------------------------------------------------------------------------

function FilePreviewModal({
  file,
  onClose,
}: {
  file: FileRecord;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fresh mount per preview target — the modal is unmounted and remounted
    // for each file, so state defaults (loading=true, error=null, url="")
    // are correct on entry. No need to reset them here.
    let active = true;
    void (async () => {
      const result = await getSignedUrl(file.storagePath);
      if (!active) return;
      if (result.error || !result.url) {
        setError(result.error ?? "Could not load file.");
        setLoading(false);
        return;
      }
      setUrl(result.url);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [file.storagePath]);

  // Escape to close for keyboard users. Pull onClose through a ref so
  // this effect can stay mounted with `[]` deps — if the parent passes
  // a new onClose identity on every render (common when the parent
  // doesn't memoize), we don't want to thrash listener registration.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const mime = file.mimeType.toLowerCase();
  const isPdf = mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = mime.startsWith("image/");

  return (
    <div
      aria-label="File preview"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
    >
      <ScrollLock />
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-[var(--bg-soft)] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-heading)]">
              {file.name}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {file.mimeType || "Unknown type"} · {formatFileSize(file.sizeBytes)}
            </div>
          </div>
          <button
            className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-hidden bg-[var(--bg-soft)]">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
              Loading preview...
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-red-600">
              {error}
            </div>
          )}
          {!loading && !error && url && isPdf && (
            <iframe
              className="h-full w-full border-0"
              src={url}
              title={file.name}
            />
          )}
          {!loading && !error && url && isImage && (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={file.name}
                className="max-h-full max-w-full object-contain"
                src={url}
              />
            </div>
          )}
          {!loading && !error && url && !isPdf && !isImage && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[var(--text-muted)]">
              <p>This file type cannot be previewed inline.</p>
              <a
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 font-semibold text-[var(--brand-primary)] hover:border-[var(--brand-primary)]"
                href={url}
                rel="noreferrer"
                target="_blank"
              >
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

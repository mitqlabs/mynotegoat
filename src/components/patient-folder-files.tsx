"use client";

import { useEffect, useMemo, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import {
  getFilesInFolder,
  getFoldersInParent,
  loadFileManagerState,
  type FileManagerState,
  type FileRecord,
} from "@/lib/file-manager";
import { formatFileSize, getSignedUrl } from "@/lib/file-storage";

type CaseGroup = {
  id: string;
  label: string;
};

const FILES_KEY = "casemate.files.v1";

function filesInTree(state: FileManagerState, rootId: string): FileRecord[] {
  const seen = new Set<string>();
  const out: FileRecord[] = [];
  const walk = (folderId: string) => {
    if (seen.has(folderId)) return;
    seen.add(folderId);
    out.push(...getFilesInFolder(state, folderId));
    for (const child of getFoldersInParent(state, folderId)) walk(child.id);
  };
  walk(rootId);
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
  return out;
}

/** Read-only Patient Files, grouped by case. Opening a file uses the same signed-link preview as the case page. */
export function PatientFolderFiles({ cases }: { cases: CaseGroup[] }) {
  const [state, setState] = useState<FileManagerState>({ folders: [], files: [] });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const reload = () => setState(loadFileManagerState());
    reload();
    return onLocalChange(FILES_KEY, reload);
  }, []);

  const groups = useMemo(() => {
    return cases.map((item) => {
      const root = state.folders.find(
        (folder) => folder.patientId === item.id && folder.isSystemFolder && !folder.deleted,
      );
      return { ...item, folderId: root?.id ?? "", files: root ? filesInTree(state, root.id) : [] };
    });
  }, [cases, state]);

  const total = groups.reduce((sum, group) => sum + group.files.length, 0);

  const openFile = async (file: FileRecord) => {
    const { url, error } = await getSignedUrl(file.storagePath);
    if (!error && url) window.open(url, "_blank");
  };

  return (
    <section className="panel-card p-4">
      <button
        className="flex w-full items-center justify-between rounded-2xl bg-[#6db5c8] px-3 py-2 text-center text-3xl font-semibold tracking-[-0.01em] text-white"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>
          Patient Files
          {total > 0 && (
            <span className="ml-2 rounded-full bg-white/25 px-2.5 py-0.5 text-base">{total}</span>
          )}
        </span>
        <span className="text-xl">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{group.label}</h4>
                {group.folderId ? (
                  <a
                    className="text-sm font-semibold text-[var(--brand-primary)] hover:underline"
                    href={`/my-files?folder=${encodeURIComponent(group.folderId)}`}
                  >
                    View in My Files &rarr;
                  </a>
                ) : null}
              </div>
              {group.files.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">No files for this case.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line-soft)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="pb-2 pr-3">Name</th>
                        <th className="pb-2 pr-3">Size</th>
                        <th className="pb-2 pr-3">Uploaded</th>
                        <th className="pb-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.files.map((file) => (
                        <tr className="border-b border-[var(--line-soft)] last:border-0" key={file.id}>
                          <td className="max-w-[260px] py-2.5 pr-3 font-medium">
                            <span className="block break-words line-clamp-2" title={file.name}>{file.name}</span>
                          </td>
                          <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--text-muted)]">{formatFileSize(file.sizeBytes)}</td>
                          <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--text-muted)]">{new Date(file.createdAt).toLocaleDateString()}</td>
                          <td className="py-2.5 text-right">
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => void openFile(file)}
                              title="Preview"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
import { getSignedUrl } from "@/lib/file-storage";

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
      return { ...item, files: root ? filesInTree(state, root.id) : [] };
    });
  }, [cases, state]);

  const openFile = async (file: FileRecord) => {
    const { url, error } = await getSignedUrl(file.storagePath);
    if (!error && url) window.open(url, "_blank");
  };

  return (
    <section className="panel-card min-w-0 p-3">
      <h3 className="mb-1 font-semibold">Patient Files</h3>
      <div className="max-h-36 overflow-y-auto text-sm">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="pt-1 text-xs font-semibold text-[var(--text-muted)]">{group.label}</p>
            {group.files.length === 0 ? (
              <p className="py-1 text-[var(--text-muted)]">No files.</p>
            ) : (
              <ul>
                {group.files.map((file) => (
                  <li className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] py-1 last:border-0" key={file.id}>
                    <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
                    <button
                      className="shrink-0 rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                      onClick={() => void openFile(file)}
                      title="Preview"
                      type="button"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

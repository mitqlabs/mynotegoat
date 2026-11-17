"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { onLocalChange } from "@/lib/local-sync";
import { caseNumberOf } from "@/lib/follow-up-queue";
import { getPatientById } from "@/lib/mock-data";
import {
  PATIENT_FOLDERS_ROOT_ID,
  addFileRecord,
  getFilesInFolder,
  getFoldersInParent,
  loadFileManagerState,
  saveFileManagerState,
  type FileFolder,
  type FileManagerState,
  type FileRecord,
} from "@/lib/file-manager";
import { downloadFile, formatFileSize, getSignedUrl, uploadFileToStorage } from "@/lib/file-storage";

const DocumentScannerModal = dynamic(
  () => import("@/components/document-scanner-modal").then((mod) => ({ default: mod.DocumentScannerModal })),
  { ssr: false },
);

type CaseGroup = {
  id: string;
  label: string;
  /** ISO day. The newest one is the default and receives uploads while All is selected. */
  sortAt?: string;
};

function latestCaseId(cases: CaseGroup[]): string {
  const ranked = [...cases].sort((a, b) => (b.sortAt || "").localeCompare(a.sortAt || "") || b.id.localeCompare(a.id));
  return ranked[0]?.id ?? "";
}

const FILES_KEY = "casemate.files.v1";
const FILE_ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

function systemFolder(state: FileManagerState, caseId: string): FileFolder | null {
  return (
    state.folders.find((folder) => folder.patientId === caseId && folder.isSystemFolder && !folder.deleted) ?? null
  );
}

function folderTitle(state: FileManagerState, folderId: string, rootId: string): string {
  const names: string[] = [];
  let current: string | null = folderId;
  while (current && current !== rootId) {
    const folder = state.folders.find((item) => item.id === current);
    if (!folder) break;
    names.unshift(folder.name);
    current = folder.parentId;
  }
  return names.join(" / ");
}

function childFolders(state: FileManagerState, parentId: string): { id: string; name: string; files: FileRecord[] }[] {
  const out: { id: string; name: string; files: FileRecord[] }[] = [];
  const walk = (id: string) => {
    for (const child of getFoldersInParent(state, id)) {
      out.push({ id: child.id, name: folderTitle(state, child.id, parentId), files: getFilesInFolder(state, child.id) });
      walk(child.id);
    }
  };
  walk(parentId);
  return out;
}

/**
 * Case-page Patient Files for every case on this person. Uploads use the same
 * storage path as uploading on that case. Existing files stay where they are:
 * this view can open and download them, and it does not move, rename, or delete them.
 */
export function PatientFolderFiles({ cases }: { cases: CaseGroup[] }) {
  const [state, setState] = useState<FileManagerState>({ folders: [], files: [] });
  const [filter, setFilter] = useState(() => latestCaseId(cases));
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const reload = () => setState(loadFileManagerState());
    reload();
    return onLocalChange(FILES_KEY, reload);
  }, []);

  useEffect(() => {
    if (filter !== "all" && !cases.some((item) => item.id === filter)) setFilter(latestCaseId(cases));
  }, [cases, filter]);
  const uploadCaseId = filter === "all" ? latestCaseId(cases) : filter;
  const latestLabel = cases.find((item) => item.id === latestCaseId(cases))?.label ?? "";

  const groups = useMemo(() => {
    return cases.map((item) => {
      const root = systemFolder(state, item.id);
      return {
        ...item,
        rootFiles: root ? getFilesInFolder(state, root.id) : [],
        folders: root ? childFolders(state, root.id) : [],
      };
    });
  }, [cases, state]);

  const openFile = async (file: FileRecord) => {
    const { url, error } = await getSignedUrl(file.storagePath);
    if (!error && url) window.open(url, "_blank");
  };

  const ensureFolder = (patientId: string): string | null => {
    const current = loadFileManagerState();
    const existing = systemFolder(current, patientId);
    if (existing) return existing.id;
    const patient = getPatientById(patientId);
    if (!patient) return null;
    const [lastName = "", firstName = ""] = patient.fullName.split(",").map((part) => part.trim());
    const now = new Date().toISOString();
    const folder: FileFolder = {
      id: `SYSTEM-PATIENT-${patient.id}`,
      name: `${caseNumberOf(patient)} ${lastName}, ${firstName}`.trim(),
      parentId: current.folders.some((item) => item.id === PATIENT_FOLDERS_ROOT_ID) ? PATIENT_FOLDERS_ROOT_ID : null,
      isSystemFolder: true,
      patientId: patient.id,
      createdAt: now,
      updatedAt: now,
    };
    saveFileManagerState({ ...current, folders: [...current.folders, folder] });
    return folder.id;
  };

  const uploadFiles = async (list: FileList | File[] | null) => {
    const files = list ? Array.from(list) : [];
    if (!uploadCaseId || files.length === 0) return;
    setUploading(true);
    setMessage("");
    const folderId = ensureFolder(uploadCaseId);
    if (!folderId) {
      setMessage("That case has no file folder yet.");
      setUploading(false);
      return;
    }
    let failed = 0;
    for (const file of files) {
      const { storagePath, name, error } = await uploadFileToStorage(folderId, file);
      if (error || !storagePath) {
        failed += 1;
        continue;
      }
      const next = addFileRecord(loadFileManagerState(), {
        folderId,
        name,
        storagePath,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      saveFileManagerState(next);
      setState(next);
    }
    if (failed > 0) setMessage(failed === files.length ? "Upload failed." : `${failed} file${failed === 1 ? "" : "s"} did not upload.`);
    setUploading(false);
  };

  const pickFiles = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = FILE_ACCEPT;
    input.onchange = () => void uploadFiles(input.files);
    input.click();
  };

  return (
    <section
      className={`panel-card min-w-0 p-3 ${dragOver ? "ring-2 ring-[var(--brand-primary)] ring-inset" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void uploadFiles(event.dataTransfer.files);
      }}
    >
      <h3 className="font-semibold">Patient Files</h3>
      <label className="mt-2 grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Show</span>
        <select
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setFilter(event.target.value)}
          value={filter}
        >
          <option value="all">All</option>
          {cases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" disabled={uploading || !uploadCaseId} onClick={pickFiles} type="button">
          {uploading ? "Uploading..." : "Upload"}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={uploading || !uploadCaseId} onClick={() => setScannerOpen(true)} type="button">
          Scan
        </button>
      </div>
      <p className={`mt-2 rounded-xl border-2 border-dashed px-2 py-2 text-center text-xs ${dragOver ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-[var(--line-soft)] text-[var(--text-muted)]"}`}>
        {dragOver
          ? "Drop files here to upload"
          : filter === "all"
            ? `Drag and drop files here. They go into the latest case${latestLabel ? ` (${latestLabel})` : ""}.`
            : "Drag and drop files here. They go into the case selected above."}
      </p>
      {message && <p className="mt-1 text-xs font-semibold text-[#b43b34]">{message}</p>}
      <div className="mt-2 max-h-64 overflow-y-auto text-sm">
        {(filter === "all" ? groups : groups.filter((group) => group.id === filter)).map((group) => (
          <div className="border-t border-[var(--line-soft)] pt-1" key={group.id}>
            <p className="text-xs font-semibold text-[var(--text-muted)]">{group.label}</p>
            {group.rootFiles.length === 0 && group.folders.length === 0 && (
              <p className="py-1 text-[var(--text-muted)]">No files.</p>
            )}
            <FileList files={group.rootFiles} onDownload={(file) => void downloadFile(file.storagePath, file.name)} onOpen={(file) => void openFile(file)} />
            {group.folders.map((folder) => (
              <div className="pl-2" key={folder.id}>
                <p className="pt-1 text-xs font-semibold">{folder.name}</p>
                {folder.files.length === 0 ? (
                  <p className="py-1 text-[var(--text-muted)]">No files.</p>
                ) : (
                  <FileList files={folder.files} onDownload={(file) => void downloadFile(file.storagePath, file.name)} onOpen={(file) => void openFile(file)} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {scannerOpen && (
        <DocumentScannerModal
          onCapture={(file) => void uploadFiles([file])}
          onClose={() => setScannerOpen(false)}
          open={scannerOpen}
        />
      )}
    </section>
  );
}

function FileList({
  files,
  onOpen,
  onDownload,
}: {
  files: FileRecord[];
  onOpen: (file: FileRecord) => void;
  onDownload: (file: FileRecord) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul>
      {files.map((file) => (
        <li className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] py-1 last:border-0" key={file.id}>
          <span className="min-w-0">
            <span className="block truncate" title={file.name}>{file.name}</span>
            <span className="text-xs text-[var(--text-muted)]">{formatFileSize(file.sizeBytes)}</span>
          </span>
          <span className="inline-flex shrink-0 gap-1">
            <button className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50" onClick={() => onOpen(file)} title="Preview" type="button">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
            </button>
            <button className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50" onClick={() => onDownload(file)} title="Download" type="button">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

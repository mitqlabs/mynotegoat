"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useFileManager } from "@/hooks/use-file-manager";
import {
  type FileFolder,
  type FileRecord,
  getFoldersInParent,
  getFilesInFolder,
  getFolderPath,
  getFolderById,
  PATIENT_FOLDERS_ROOT_ID,
} from "@/lib/file-manager";
import {
  formatFileSize,
  getSignedUrl,
  downloadFile,
} from "@/lib/file-storage";
import { loadEmailSettings, renderEmailTemplate, type EmailRenderContext } from "@/lib/email-settings";
import { loadCaseStatuses } from "@/lib/case-statuses";
import { loadOfficeSettings } from "@/lib/office-settings";
import { patients as patientRecords } from "@/lib/mock-data";
import { ScrollLock } from "@/components/scroll-lock";

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

type FolderViewMode = "grid" | "list";
const VIEW_MODE_KEY = "casemate.files-view-mode";

function loadViewMode(): FolderViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(VIEW_MODE_KEY);
  return stored === "grid" ? "grid" : "list";
}

function saveViewMode(mode: FolderViewMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VIEW_MODE_KEY, mode);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return "\uD83D\uDDBC\uFE0F";
  if (mimeType === "application/pdf") return "\uD83D\uDCC4";
  if (mimeType.includes("word") || mimeType.includes("document")) return "\uD83D\uDDD2\uFE0F";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "\uD83D\uDCCA";
  return "\uD83D\uDCC1";
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortColumn = "name" | "date";
type SortDirection = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDirection };

function toggleSort(current: SortState, column: SortColumn): SortState {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: "asc" };
}

function SortArrow({ column, sort }: { column: SortColumn; sort: SortState }) {
  if (sort.column !== column) {
    return <svg className="ml-1 inline h-3 w-3 opacity-30" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M7 10l5-5 5 5M7 14l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return sort.direction === "asc"
    ? <svg className="ml-1 inline h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M7 14l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg className="ml-1 inline h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string) {
  return mime === "application/pdf";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MyFilesPage() {
  const searchParams = useSearchParams();
  const patients = patientRecords;
  const [caseStatuses] = useState(() => loadCaseStatuses());
  const {
    state,
    createFolder,
    updateFolderName,
    deleteUserFolder,
    uploadFile,
    renameFile,
    deleteFile,
    restoreFile,
    restoreFolder,
    permanentlyDeleteFile,
    permanentlyDeleteFolder,
    deletedFiles,
    deletedFolders,
  } = useFileManager(patients, caseStatuses);

  const [showTrash, setShowTrash] = useState(false);
  const trashCount = deletedFiles.length + deletedFolders.length;

  // Navigation state — open to specific folder if ?folder= param is present
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    const folderParam = searchParams.get("folder");
    return folderParam || null;
  });
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [message, setMessage] = useState("");
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState<FolderViewMode>(() => loadViewMode());
  const [folderSort, setFolderSort] = useState<SortState>({ column: "name", direction: "asc" });
  const [fileSort, setFileSort] = useState<SortState>({ column: "name", direction: "asc" });
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleViewMode = (mode: FolderViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  // Derived data
  const isSearching = searchQuery.trim().length > 0;
  const searchLower = searchQuery.trim().toLowerCase();

  // When searching, find all matching folders and files across the entire tree
  const searchMatchFolders = useMemo(() => {
    if (!isSearching) return [];
    return state.folders.filter((f) => !f.deleted && f.name.toLowerCase().includes(searchLower));
  }, [state.folders, isSearching, searchLower]);

  const searchMatchFiles = useMemo(() => {
    if (!isSearching) return [];
    return state.files.filter((f) => !f.deleted && f.name.toLowerCase().includes(searchLower));
  }, [state.files, isSearching, searchLower]);

  const subfoldersRaw = useMemo(
    () => (isSearching ? searchMatchFolders : getFoldersInParent(state, currentFolderId)),
    [state, currentFolderId, isSearching, searchMatchFolders],
  );
  const subfolders = useMemo(() => {
    const sorted = [...subfoldersRaw];
    const dir = folderSort.direction === "asc" ? 1 : -1;
    if (folderSort.column === "name") {
      sorted.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } else {
      sorted.sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    }
    return sorted;
  }, [subfoldersRaw, folderSort]);

  const filesRaw = useMemo(
    () => (isSearching ? searchMatchFiles : currentFolderId ? getFilesInFolder(state, currentFolderId) : []),
    [state, currentFolderId, isSearching, searchMatchFiles],
  );
  const filesInFolder = useMemo(() => {
    const sorted = [...filesRaw];
    const dir = fileSort.direction === "asc" ? 1 : -1;
    if (fileSort.column === "name") {
      sorted.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } else {
      sorted.sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    }
    return sorted;
  }, [filesRaw, fileSort]);
  const breadcrumb = useMemo(
    () => (currentFolderId ? getFolderPath(state, currentFolderId) : []),
    [state, currentFolderId],
  );
  const currentFolder = currentFolderId ? getFolderById(state, currentFolderId) : null;
  const canUploadHere = !isSearching && currentFolderId !== null;
  const isSystemFolder = currentFolder?.isSystemFolder ?? false;

  const navigateToFolder = (folderId: string | null) => {
    setSearchQuery("");
    setCurrentFolderId(folderId);
  };

  // ---------------------------------------------------------------------------
  // Folder actions
  // ---------------------------------------------------------------------------

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder(name, currentFolderId);
    setNewFolderName("");
    setShowNewFolderInput(false);
    setMessage(`Folder "${name}" created.`);
  };

  const handleRenameFolder = (folderId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    updateFolderName(folderId, name);
    setRenamingFolderId(null);
    setRenameValue("");
    setMessage("Folder renamed.");
  };

  const handleDeleteFolder = async (folderId: string) => {
    setDeletingFolderId(folderId);
    await deleteUserFolder(folderId);
    setDeletingFolderId(null);
    setMessage("Folder moved to trash.");
  };

  // ---------------------------------------------------------------------------
  // File actions
  // ---------------------------------------------------------------------------

  const handleFileSelect = async (files: FileList | File[]) => {
    if (!currentFolderId || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    let successCount = 0;
    let lastError = "";

    for (const file of Array.from(files)) {
      const result = await uploadFile(currentFolderId, file);
      if (result.success) {
        successCount++;
      } else {
        lastError = result.error ?? "Upload failed";
      }
    }

    setUploading(false);
    if (successCount > 0) {
      setMessage(`${successCount} file${successCount > 1 ? "s" : ""} uploaded.`);
    }
    if (lastError) {
      setUploadError(lastError);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileSelect(e.target.files);
      e.target.value = "";
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setDeletingFileId(fileId);
    await deleteFile(fileId);
    setDeletingFileId(null);
    setMessage("File moved to trash.");
  };

  const handleDownload = (file: FileRecord) => {
    downloadFile(file.storagePath, file.name);
  };

  // ---------------------------------------------------------------------------
  // Rename file
  // ---------------------------------------------------------------------------

  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRenameFile = (file: FileRecord) => {
    setRenamingFileId(file.id);
    setRenameDraft(file.name);
  };

  const commitRenameFile = () => {
    const trimmed = renameDraft.trim();
    if (!renamingFileId || !trimmed) {
      setRenamingFileId(null);
      return;
    }
    renameFile(renamingFileId, trimmed);
    setRenamingFileId(null);
  };

  // Email file (download + open mailto) — desktop approach
  // ---------------------------------------------------------------------------

  const [emailingFileId, setEmailingFileId] = useState<string | null>(null);
  const [emailToast, setEmailToast] = useState("");

  /** Build email context with patient info when file is inside a patient folder */
  const buildEmailContext = (file: FileRecord): EmailRenderContext => {
    const today = new Date();
    const ctx: EmailRenderContext = {
      FILE_NAME: file.name,
      TODAY: today.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
      OFFICE_NAME: loadOfficeSettings().officeName || "",
    };

    // Walk up the folder tree to find a patient folder
    let folderId: string | null = file.folderId;
    while (folderId) {
      const folder = getFolderById(state, folderId);
      if (!folder) break;
      if (folder.patientId) {
        const patient = patients.find((p) => p.id === folder.patientId);
        if (patient) {
          const [lastName = "", firstName = ""] = patient.fullName.split(",").map((s) => s.trim());
          ctx.FIRST_NAME = firstName;
          ctx.LAST_NAME = lastName;
          ctx.FULL_NAME = `${firstName} ${lastName}`.trim();

          // Mr./Mrs./Ms. logic
          const sex = patient.sex;
          const married = patient.maritalStatus === "Married";
          let prefix = "";
          if (sex === "Male") prefix = "Mr.";
          else if (sex === "Female") prefix = married ? "Mrs." : "Ms.";
          else prefix = "Mr./Ms.";
          ctx.MR_MRS_MS_LAST_NAME = `${prefix} ${lastName}`;

          if (patient.dob) {
            const [y, m, d] = patient.dob.split("-");
            ctx.DOB = `${m}/${d}/${y}`;
          }
          if (patient.dateOfLoss) {
            const [y, m, d] = patient.dateOfLoss.split("-");
            ctx.INJURY_DATE = `${m}/${d}/${y}`;
          }
        }
        break;
      }
      folderId = folder.parentId;
    }
    return ctx;
  };

  const handleEmailFile = async (file: FileRecord) => {
    setEmailingFileId(file.id);
    try {
      const settings = loadEmailSettings();
      const ctx = buildEmailContext(file);
      const subject = encodeURIComponent(renderEmailTemplate(settings.subjectTemplate, ctx));
      const body = encodeURIComponent(renderEmailTemplate(settings.bodyTemplate, ctx));

      // Wait for the download to actually complete before opening mailto
      await downloadFile(file.storagePath, file.name);

      // Show toast pointing to downloads
      setEmailToast(`"${file.name}" downloaded — check your Downloads folder to attach it.`);
      setTimeout(() => setEmailToast(""), 6000);

      // Give the browser a moment to register the download, then open email
      setTimeout(() => {
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      }, 600);
    } finally {
      setTimeout(() => setEmailingFileId(null), 1500);
    }
  };

  // ---------------------------------------------------------------------------
  // Share file (Web Share API) — mobile/tablet native share sheet
  // ---------------------------------------------------------------------------

  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // Detect Web Share API with file support
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function");
  }, []);

  const handleShareFile = async (file: FileRecord) => {
    setSharingFileId(file.id);
    try {
      const { url, error } = await getSignedUrl(file.storagePath);
      if (error || !url) {
        setMessage("Could not prepare file for sharing.");
        return;
      }

      // Fetch the file as a blob so we can share it natively
      const response = await fetch(url);
      const blob = await response.blob();
      const shareFile = new File([blob], file.name, { type: file.mimeType });

      const shareData: ShareData = {
        title: file.name,
        files: [shareFile],
      };

      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback: just share the URL
        await navigator.share({
          title: file.name,
          text: `File: ${file.name}`,
          url,
        });
      }
    } catch (err: unknown) {
      // User cancelled the share sheet — not an error
      if (err instanceof Error && err.name === "AbortError") return;
      setMessage("Share failed. Try downloading instead.");
    } finally {
      setSharingFileId(null);
    }
  };

  const handlePreview = async (file: FileRecord) => {
    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewUrl("");
    const { url, error } = await getSignedUrl(file.storagePath);
    if (error || !url) {
      setPreviewUrl("");
      setPreviewLoading(false);
      return;
    }
    setPreviewUrl(url);
    setPreviewLoading(false);
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewUrl("");
  };

  // ---------------------------------------------------------------------------
  // Drag and drop
  // ---------------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0 && canUploadHere) {
        handleFileSelect(e.dataTransfer.files);
      }
    },
    [canUploadHere, currentFolderId],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--text-heading)]">My Files</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Upload and organize documents, imaging reports, attorney letters, and more.
      </p>

      {/* Search bar */}
      <div className="mt-4 relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg className="h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" /></svg>
        </div>
        <input
          className="w-full rounded-xl border border-[var(--line-soft)] bg-white py-2 pl-9 pr-8 text-sm placeholder:text-[var(--text-muted)] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search folders and files..."
          type="text"
          value={searchQuery}
        />
        {searchQuery && (
          <button
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-muted)] hover:text-[var(--text-heading)]"
            onClick={() => setSearchQuery("")}
            type="button"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>

      {/* Breadcrumb — hidden during search */}
      {!isSearching && (
        <div className="mt-3 flex items-center gap-1 text-sm">
          <button
            className={`font-medium ${currentFolderId ? "text-blue-600 hover:underline" : "text-[var(--text-heading)]"}`}
            onClick={() => navigateToFolder(null)}
            type="button"
          >
            My Files
          </button>
          {breadcrumb.map((folder) => (
            <span key={folder.id} className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">/</span>
              <button
                className={`font-medium ${folder.id === currentFolderId ? "text-[var(--text-heading)]" : "text-blue-600 hover:underline"}`}
                onClick={() => navigateToFolder(folder.id)}
                type="button"
              >
                {folder.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search result count */}
      {isSearching && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Found {subfolders.length} folder{subfolders.length !== 1 ? "s" : ""} and {filesInFolder.length} file{filesInFolder.length !== 1 ? "s" : ""} matching &ldquo;{searchQuery.trim()}&rdquo;
        </p>
      )}

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {currentFolderId && (
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg-soft)]"
            onClick={() => {
              const parent = currentFolder?.parentId ?? null;
              navigateToFolder(parent);
            }}
            type="button"
          >
            &larr; Back
          </button>
        )}

        {!isSystemFolder && (
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg-soft)]"
            onClick={() => {
              setShowNewFolderInput(true);
              setNewFolderName("");
            }}
            type="button"
          >
            + New Folder
          </button>
        )}

        {canUploadHere && (
          <>
            <button
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {uploading ? "Uploading..." : "Upload File"}
            </button>
            <input
              ref={fileInputRef}
              accept="*/*"
              className="hidden"
              multiple
              onChange={handleFileInputChange}
              type="file"
            />
          </>
        )}

        {/* Trash toggle */}
        <button
          className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
            showTrash
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-[var(--line-soft)] bg-white text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
          }`}
          onClick={() => setShowTrash((prev) => !prev)}
          type="button"
        >
          🗑️ Trash{trashCount > 0 ? ` (${trashCount})` : ""}
        </button>

        {/* View mode toggle */}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-[var(--line-soft)] bg-white p-0.5">
          <button
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-blue-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--text-heading)]"}`}
            onClick={() => toggleViewMode("list")}
            title="List view"
            type="button"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
          </button>
          <button
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--text-heading)]"}`}
            onClick={() => toggleViewMode("grid")}
            title="Grid view"
            type="button"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect height="7" rx="1" width="7" x="3" y="3" /><rect height="7" rx="1" width="7" x="14" y="3" /><rect height="7" rx="1" width="7" x="3" y="14" /><rect height="7" rx="1" width="7" x="14" y="14" /></svg>
          </button>
        </div>

        {message && (
          <span className="text-sm text-green-700">{message}</span>
        )}
        {uploadError && (
          <span className="text-sm text-red-600">{uploadError}</span>
        )}
      </div>

      {/* Email download toast */}
      {emailToast && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800 shadow-sm">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {emailToast}
          <button className="ml-auto text-blue-600 hover:text-blue-800" onClick={() => setEmailToast("")} type="button">&times;</button>
        </div>
      )}

      {/* New folder input */}
      {showNewFolderInput && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateFolder();
          }}
        >
          <input
            autoFocus
            className="w-64 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            value={newFolderName}
          />
          <button
            className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            type="submit"
          >
            Create
          </button>
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg-soft)]"
            onClick={() => setShowNewFolderInput(false)}
            type="button"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Drop zone wrapper */}
      <div
        className={`mt-4 min-h-[300px] rounded-2xl border-2 transition-colors ${
          dragOver && canUploadHere
            ? "border-blue-400 bg-blue-50"
            : "border-transparent"
        }`}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Folders — Grid view */}
        {subfolders.length > 0 && viewMode === "grid" && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Folders
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {subfolders.map((folder) => (
                <div key={folder.id} className="group relative">
                  {renamingFolderId === folder.id ? (
                    <form
                      className="flex flex-col gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenameFolder(folder.id);
                      }}
                    >
                      <input
                        autoFocus
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                        onChange={(e) => setRenameValue(e.target.value)}
                        value={renameValue}
                      />
                      <div className="flex gap-1">
                        <button className="text-xs text-blue-600 hover:underline" type="submit">
                          Save
                        </button>
                        <button
                          className="text-xs text-[var(--text-muted)] hover:underline"
                          onClick={() => setRenamingFolderId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      className="flex w-full flex-col items-center gap-1 rounded-xl border border-[var(--line-soft)] bg-white p-3 text-center hover:bg-[var(--bg-soft)] hover:shadow-sm transition-all"
                      onClick={() => navigateToFolder(folder.id)}
                      type="button"
                    >
                      <span className="text-3xl">
                        {folder.isSystemFolder ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}
                      </span>
                      <span className="text-xs font-medium leading-tight text-[var(--text-heading)] line-clamp-2">
                        {folder.name}
                      </span>
                    </button>
                  )}

                  {/* Context actions for non-system folders */}
                  {!folder.isSystemFolder && renamingFolderId !== folder.id && (
                    <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                      <button
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 shadow-sm hover:bg-blue-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingFolderId(folder.id);
                          setRenameValue(folder.name);
                        }}
                        title="Rename"
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-red-600 shadow-sm hover:bg-red-50"
                        disabled={deletingFolderId === folder.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete folder "${folder.name}" and all files inside?`)) {
                            handleDeleteFolder(folder.id);
                          }
                        }}
                        title="Delete"
                        type="button"
                      >
                        {deletingFolderId === folder.id ? "..." : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Folders — List view */}
        {subfolders.length > 0 && viewMode === "list" && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Folders
            </p>
            <div className="overflow-hidden rounded-xl border border-[var(--line-soft)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] bg-[var(--bg-soft)]">
                    <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)]">
                      <button className="inline-flex items-center hover:text-[var(--text-heading)]" onClick={() => setFolderSort((s) => toggleSort(s, "name"))} type="button">
                        Name<SortArrow column="name" sort={folderSort} />
                      </button>
                    </th>
                    <th className="hidden px-3 py-2 text-left font-semibold text-[var(--text-muted)] sm:table-cell">Items</th>
                    <th className="hidden px-3 py-2 text-left font-semibold text-[var(--text-muted)] md:table-cell">
                      <button className="inline-flex items-center hover:text-[var(--text-heading)]" onClick={() => setFolderSort((s) => toggleSort(s, "date"))} type="button">
                        Created<SortArrow column="date" sort={folderSort} />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subfolders.map((folder) => {
                    const childFolderCount = state.folders.filter((f) => f.parentId === folder.id && !f.deleted).length;
                    const childFileCount = state.files.filter((f) => f.folderId === folder.id && !f.deleted).length;
                    const itemCount = childFolderCount + childFileCount;

                    return (
                      <tr
                        key={folder.id}
                        className="group border-b border-[var(--line-soft)] last:border-b-0 hover:bg-[var(--bg-soft)] cursor-pointer"
                        onClick={() => {
                          if (renamingFolderId !== folder.id) navigateToFolder(folder.id);
                        }}
                      >
                        <td className="px-3 py-2">
                          {renamingFolderId === folder.id ? (
                            <form
                              className="flex items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleRenameFolder(folder.id);
                              }}
                            >
                              <input
                                autoFocus
                                className="w-48 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                                onChange={(e) => setRenameValue(e.target.value)}
                                value={renameValue}
                              />
                              <button className="text-xs text-blue-600 hover:underline" type="submit">Save</button>
                              <button
                                className="text-xs text-[var(--text-muted)] hover:underline"
                                onClick={() => setRenamingFolderId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-lg">
                                {folder.isSystemFolder ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}
                              </span>
                              <div className="min-w-0">
                                <span className="block font-medium text-[var(--text-heading)]">
                                  {folder.name}
                                </span>
                                {isSearching && folder.parentId && (() => {
                                  const path = getFolderPath(state, folder.id).slice(0, -1).map((f) => f.name).join(" / ");
                                  return path ? <span className="block text-[10px] text-[var(--text-muted)] truncate">{path}</span> : null;
                                })()}
                              </div>
                              {folder.isSystemFolder && (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">System</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 text-[var(--text-muted)] sm:table-cell">
                          {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "Empty"}
                        </td>
                        <td className="hidden px-3 py-2 text-[var(--text-muted)] md:table-cell">
                          {formatDate(folder.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {!folder.isSystemFolder && renamingFolderId !== folder.id && (
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                                onClick={() => {
                                  setRenamingFolderId(folder.id);
                                  setRenameValue(folder.name);
                                }}
                                type="button"
                              >
                                Rename
                              </button>
                              <button
                                className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                disabled={deletingFolderId === folder.id}
                                onClick={() => {
                                  if (confirm(`Delete folder "${folder.name}" and all files inside?`)) {
                                    handleDeleteFolder(folder.id);
                                  }
                                }}
                                type="button"
                              >
                                {deletingFolderId === folder.id ? "..." : "Delete"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Files list */}
        {(currentFolderId || isSearching) && filesInFolder.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Files
            </p>
            <div className="overflow-hidden rounded-xl border border-[var(--line-soft)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] bg-[var(--bg-soft)]">
                    <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)]">
                      <button className="inline-flex items-center hover:text-[var(--text-heading)]" onClick={() => setFileSort((s) => toggleSort(s, "name"))} type="button">
                        Name<SortArrow column="name" sort={fileSort} />
                      </button>
                    </th>
                    <th className="hidden px-3 py-2 text-left font-semibold text-[var(--text-muted)] sm:table-cell">Size</th>
                    <th className="hidden px-3 py-2 text-left font-semibold text-[var(--text-muted)] md:table-cell">
                      <button className="inline-flex items-center hover:text-[var(--text-heading)]" onClick={() => setFileSort((s) => toggleSort(s, "date"))} type="button">
                        Uploaded<SortArrow column="date" sort={fileSort} />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filesInFolder.map((file) => (
                    <tr
                      key={file.id}
                      className="border-b border-[var(--line-soft)] last:border-b-0 hover:bg-[var(--bg-soft)]"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>{getFileIcon(file.mimeType)}</span>
                          <div className="min-w-0">
                            {renamingFileId === file.id ? (
                              <input
                                autoFocus
                                className="w-full rounded border border-[var(--brand-primary)] px-1.5 py-0.5 text-sm font-medium focus:outline-none"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onBlur={commitRenameFile}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRenameFile();
                                  if (e.key === "Escape") setRenamingFileId(null);
                                }}
                              />
                            ) : (
                              <span className="block font-medium text-[var(--text-heading)] truncate max-w-[200px] sm:max-w-[300px]">
                                {file.name}
                              </span>
                            )}
                            {isSearching && (() => {
                              const parentFolder = state.folders.find((f) => f.id === file.folderId);
                              const path = parentFolder ? getFolderPath(state, parentFolder.id).map((f) => f.name).join(" / ") : "";
                              return path ? (
                                <button
                                  className="block text-[10px] text-blue-500 hover:underline truncate max-w-[200px] sm:max-w-[300px]"
                                  onClick={() => navigateToFolder(file.folderId)}
                                  type="button"
                                >
                                  {path}
                                </button>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-2 text-[var(--text-muted)] sm:table-cell">
                        {formatFileSize(file.sizeBytes)}
                      </td>
                      <td className="hidden px-3 py-2 text-[var(--text-muted)] md:table-cell">
                        {formatDate(file.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Preview — magnifying glass */}
                          {(isImageMime(file.mimeType) || isPdfMime(file.mimeType)) && (
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => handlePreview(file)}
                              title="Preview"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" /></svg>
                            </button>
                          )}
                          {/* Rename — pencil */}
                          <button
                            className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                            onClick={() => startRenameFile(file)}
                            title="Rename"
                            type="button"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          {/* Download — arrow-down-tray */}
                          <button
                            className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                            onClick={() => handleDownload(file)}
                            title="Download"
                            type="button"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          {/* Email — envelope */}
                          <button
                            className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
                            disabled={emailingFileId === file.id}
                            onClick={() => handleEmailFile(file)}
                            title="Email (download + open email)"
                            type="button"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect height="16" rx="2" width="20" x="2" y="4" /><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                          {/* Share — share icon (mobile/tablet only) */}
                          {canShare && (
                            <button
                              className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-40"
                              disabled={sharingFileId === file.id}
                              onClick={() => handleShareFile(file)}
                              title="Share"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" strokeLinecap="round" /></svg>
                            </button>
                          )}
                          {/* Delete — trash can */}
                          <button
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                            disabled={deletingFileId === file.id}
                            onClick={() => {
                              if (confirm(`Delete "${file.name}"?`)) {
                                handleDeleteFile(file.id);
                              }
                            }}
                            title="Delete"
                            type="button"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isSearching && currentFolderId && filesInFolder.length === 0 && subfolders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl">
              {canUploadHere ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">
              {canUploadHere
                ? "This folder is empty. Upload files or drag and drop them here."
                : "This folder is empty."}
            </p>
          </div>
        )}

        {isSearching && subfolders.length === 0 && filesInFolder.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl">
              <svg className="mx-auto h-10 w-10 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" /></svg>
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">
              No results for &ldquo;{searchQuery.trim()}&rdquo;
            </p>
          </div>
        )}

        {!isSearching && !currentFolderId && subfolders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl">{"\uD83D\uDCC1"}</p>
            <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">
              No folders yet. Create a folder to get started.
            </p>
          </div>
        )}

        {/* Drag and drop hint when dragging */}
        {dragOver && canUploadHere && (
          <div className="pointer-events-none flex items-center justify-center py-8">
            <p className="text-sm font-medium text-blue-600">
              Drop files here to upload
            </p>
          </div>
        )}
      </div>

      {/* Trash View */}
      {showTrash && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/50 p-4">
          <h2 className="text-lg font-semibold text-red-800 mb-3">🗑️ Trash</h2>
          {deletedFolders.length === 0 && deletedFiles.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Trash is empty.</p>
          )}

          {/* Deleted Folders */}
          {deletedFolders.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-red-600">
                Deleted Folders
              </p>
              <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-red-100 bg-red-50">
                      <th className="px-3 py-2 text-left font-semibold text-red-700">Name</th>
                      <th className="hidden px-3 py-2 text-left font-semibold text-red-700 md:table-cell">Deleted</th>
                      <th className="px-3 py-2 text-right font-semibold text-red-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedFolders.map((folder) => (
                      <tr key={folder.id} className="border-b border-red-100 last:border-b-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg opacity-50">📁</span>
                            <span className="font-medium text-[var(--text-heading)]">{folder.name}</span>
                          </div>
                        </td>
                        <td className="hidden px-3 py-2 text-[var(--text-muted)] md:table-cell">
                          {folder.deletedAt ? formatDate(folder.deletedAt) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                              onClick={() => {
                                restoreFolder(folder.id);
                                setMessage(`Folder "${folder.name}" restored.`);
                              }}
                              type="button"
                            >
                              Restore
                            </button>
                            <button
                              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Permanently delete folder "${folder.name}" and EVERY file inside it (across nested subfolders)?\n\nThis removes the file metadata AND deletes the actual files from cloud storage. There's no undo.`,
                                  )
                                ) {
                                  void permanentlyDeleteFolder(folder.id).then(() => {
                                    setMessage(`Folder "${folder.name}" permanently deleted.`);
                                  });
                                }
                              }}
                              title="Permanently delete folder + every file inside (no undo)"
                              type="button"
                            >
                              Delete Forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Deleted Files */}
          {deletedFiles.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-red-600">
                Deleted Files
              </p>
              <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-red-100 bg-red-50">
                      <th className="px-3 py-2 text-left font-semibold text-red-700">Name</th>
                      <th className="hidden px-3 py-2 text-left font-semibold text-red-700 sm:table-cell">Size</th>
                      <th className="hidden px-3 py-2 text-left font-semibold text-red-700 md:table-cell">Deleted</th>
                      <th className="px-3 py-2 text-right font-semibold text-red-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedFiles.map((file) => (
                      <tr key={file.id} className="border-b border-red-100 last:border-b-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="opacity-50">{getFileIcon(file.mimeType)}</span>
                            <span className="font-medium text-[var(--text-heading)] truncate max-w-[200px] sm:max-w-[300px]">
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-3 py-2 text-[var(--text-muted)] sm:table-cell">
                          {formatFileSize(file.sizeBytes)}
                        </td>
                        <td className="hidden px-3 py-2 text-[var(--text-muted)] md:table-cell">
                          {file.deletedAt ? formatDate(file.deletedAt) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                              onClick={() => {
                                restoreFile(file.id);
                                setMessage(`File "${file.name}" restored.`);
                              }}
                              type="button"
                            >
                              Restore
                            </button>
                            <button
                              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Permanently delete "${file.name}"?\n\nThis removes the file metadata AND deletes the underlying file from cloud storage. There's no undo.`,
                                  )
                                ) {
                                  void permanentlyDeleteFile(file.id).then(() => {
                                    setMessage(`File "${file.name}" permanently deleted.`);
                                  });
                                }
                              }}
                              title="Permanently delete file from cloud storage (no undo)"
                              type="button"
                            >
                              Delete Forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <ScrollLock />
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span>{getFileIcon(previewFile.mimeType)}</span>
                <span className="font-medium text-[var(--text-heading)] truncate">
                  {previewFile.name}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {formatFileSize(previewFile.sizeBytes)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {/* Download */}
                <button
                  className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                  onClick={() => handleDownload(previewFile)}
                  title="Download"
                  type="button"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {/* Email */}
                <button
                  className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
                  disabled={emailingFileId === previewFile.id}
                  onClick={() => handleEmailFile(previewFile)}
                  title="Email (download + open email)"
                  type="button"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect height="16" rx="2" width="20" x="2" y="4" /><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {/* Share */}
                {canShare && (
                  <button
                    className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-40"
                    disabled={sharingFileId === previewFile.id}
                    onClick={() => handleShareFile(previewFile)}
                    title="Share"
                    type="button"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" strokeLinecap="round" /></svg>
                  </button>
                )}
                {/* Close */}
                <button
                  className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-soft)] transition-colors"
                  onClick={closePreview}
                  title="Close"
                  type="button"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {previewLoading && (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-[var(--text-muted)]">Loading preview...</p>
                </div>
              )}
              {!previewLoading && !previewUrl && (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-red-600">Could not load preview.</p>
                </div>
              )}
              {!previewLoading && previewUrl && isImageMime(previewFile.mimeType) && (
                <div className="flex items-center justify-center">
                  <img
                    alt={previewFile.name}
                    className="max-h-[70vh] max-w-full rounded-lg object-contain"
                    src={previewUrl}
                  />
                </div>
              )}
              {!previewLoading && previewUrl && isPdfMime(previewFile.mimeType) && (
                <iframe
                  className="h-[70vh] w-full rounded-lg border border-[var(--line-soft)]"
                  src={previewUrl}
                  title={previewFile.name}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

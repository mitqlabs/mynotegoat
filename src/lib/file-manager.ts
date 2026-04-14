"use client";

import type { CaseStatusConfig } from "@/lib/case-statuses";
import type { PatientRecord } from "@/lib/mock-data";
import { buildCaseNumber, toUsDateCanonical } from "@/lib/follow-up-queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileFolder = {
  id: string;
  name: string;
  parentId: string | null;
  isSystemFolder: boolean;
  patientId?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  deletedAt?: string;
};

export type FileRecord = {
  id: string;
  folderId: string;
  name: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  deletedAt?: string;
};

export type FileManagerState = {
  folders: FileFolder[];
  files: FileRecord[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "casemate.files.v1";
const PATIENT_FOLDERS_ROOT_ID = "SYSTEM-PATIENT-FOLDERS-ROOT";
const PATIENT_FOLDERS_ROOT_NAME = "Patient Folders";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function createFolderId() {
  return `FOLDER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFileId() {
  return `FILE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadFileManagerState(): FileManagerState {
  if (typeof window === "undefined") {
    return { folders: [], files: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { folders: [], files: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
    };
  } catch {
    return { folders: [], files: [] };
  }
}

export function saveFileManagerState(state: FileManagerState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------------

export function addFolder(
  state: FileManagerState,
  name: string,
  parentId: string | null,
): FileManagerState {
  const now = new Date().toISOString();
  const folder: FileFolder = {
    id: createFolderId(),
    name: name.trim(),
    parentId,
    isSystemFolder: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, folders: [...state.folders, folder] };
}

export function renameFolder(
  state: FileManagerState,
  folderId: string,
  newName: string,
): FileManagerState {
  return {
    ...state,
    folders: state.folders.map((f) =>
      f.id === folderId && !f.isSystemFolder
        ? { ...f, name: newName.trim(), updatedAt: new Date().toISOString() }
        : f,
    ),
  };
}

function collectDescendantFolderIds(folders: FileFolder[], parentId: string): Set<string> {
  const ids = new Set<string>();
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const f of folders) {
      if (f.parentId === current && !ids.has(f.id)) {
        ids.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return ids;
}

export function deleteFolder(
  state: FileManagerState,
  folderId: string,
): { state: FileManagerState; deletedStoragePaths: string[] } {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder || folder.isSystemFolder) {
    return { state, deletedStoragePaths: [] };
  }

  const now = new Date().toISOString();
  const descendantIds = collectDescendantFolderIds(state.folders, folderId);
  descendantIds.add(folderId);

  // Soft-delete: mark folders and files as deleted instead of removing
  return {
    state: {
      folders: state.folders.map((f) =>
        descendantIds.has(f.id) || f.id === folderId
          ? { ...f, deleted: true, deletedAt: now }
          : f,
      ),
      files: state.files.map((f) =>
        descendantIds.has(f.folderId)
          ? { ...f, deleted: true, deletedAt: now }
          : f,
      ),
    },
    deletedStoragePaths: [], // Don't delete storage — keep for recovery
  };
}

// ---------------------------------------------------------------------------
// File CRUD (metadata only — actual upload/delete handled by file-storage.ts)
// ---------------------------------------------------------------------------

export function addFileRecord(
  state: FileManagerState,
  record: Omit<FileRecord, "id" | "createdAt" | "updatedAt">,
): FileManagerState {
  const now = new Date().toISOString();
  const file: FileRecord = {
    ...record,
    id: createFileId(),
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, files: [...state.files, file] };
}

export function removeFileRecord(
  state: FileManagerState,
  fileId: string,
): { state: FileManagerState; storagePath: string | null } {
  const now = new Date().toISOString();
  const file = state.files.find((f) => f.id === fileId);
  // Soft-delete: mark as deleted instead of removing
  return {
    state: {
      ...state,
      files: state.files.map((f) =>
        f.id === fileId ? { ...f, deleted: true, deletedAt: now } : f,
      ),
    },
    storagePath: null, // Don't delete storage — keep for recovery
  };
}

export function restoreFileRecord(
  state: FileManagerState,
  fileId: string,
): FileManagerState {
  return {
    ...state,
    files: state.files.map((f) =>
      f.id === fileId ? { ...f, deleted: undefined, deletedAt: undefined } : f,
    ),
  };
}

export function restoreFolderRecord(
  state: FileManagerState,
  folderId: string,
): FileManagerState {
  // Restore folder and all its files
  return {
    ...state,
    folders: state.folders.map((f) =>
      f.id === folderId ? { ...f, deleted: undefined, deletedAt: undefined } : f,
    ),
    files: state.files.map((f) =>
      f.folderId === folderId && f.deleted ? { ...f, deleted: undefined, deletedAt: undefined } : f,
    ),
  };
}

export function getDeletedFiles(state: FileManagerState): FileRecord[] {
  return state.files.filter((f) => f.deleted === true);
}

export function getDeletedFolders(state: FileManagerState): FileFolder[] {
  return state.folders.filter((f) => f.deleted === true);
}

export function renameFileRecord(
  state: FileManagerState,
  fileId: string,
  newName: string,
): FileManagerState {
  return {
    ...state,
    files: state.files.map((f) =>
      f.id === fileId ? { ...f, name: newName, updatedAt: new Date().toISOString() } : f,
    ),
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getFoldersInParent(state: FileManagerState, parentId: string | null) {
  return state.folders
    .filter((f) => f.parentId === parentId && !f.deleted)
    .sort((a, b) => {
      // System folders first, then alphabetical
      if (a.isSystemFolder !== b.isSystemFolder) return a.isSystemFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function getFilesInFolder(state: FileManagerState, folderId: string) {
  return state.files
    .filter((f) => f.folderId === folderId && !f.deleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getFolderPath(state: FileManagerState, folderId: string | null): FileFolder[] {
  const path: FileFolder[] = [];
  let current = folderId;
  while (current) {
    const folder = state.folders.find((f) => f.id === current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

export function getFolderById(state: FileManagerState, folderId: string) {
  return state.folders.find((f) => f.id === folderId) ?? null;
}

// ---------------------------------------------------------------------------
// Patient folder sync
// ---------------------------------------------------------------------------

function extractYearFromDate(dateStr: string): string {
  // Try ISO format YYYY-MM-DD
  const isoMatch = dateStr.match(/^(\d{4})-\d{2}-\d{2}$/);
  if (isoMatch) return isoMatch[1];

  // Try US format MM/DD/YYYY
  const usMatch = dateStr.match(/\d{1,2}\/\d{1,2}\/(\d{4})$/);
  if (usMatch) return usMatch[1];

  // Try US short format MM/DD/YY
  const usShortMatch = dateStr.match(/\d{1,2}\/\d{1,2}\/(\d{2})$/);
  if (usShortMatch) return `20${usShortMatch[1]}`;

  return "";
}

function buildPatientFolderName(patient: PatientRecord): string {
  const caseNumber = buildCaseNumber(patient.dateOfLoss, patient.fullName);
  // fullName is "LASTNAME, FIRSTNAME"
  const [lastName = "", firstName = ""] = patient.fullName.split(",").map((s) => s.trim());
  return `${caseNumber} ${lastName}, ${firstName}`.trim();
}

export function syncPatientFolders(
  state: FileManagerState,
  patients: PatientRecord[],
  caseStatuses: CaseStatusConfig[] = [],
): FileManagerState {
  let folders = [...state.folders];
  let files = [...state.files];
  const now = new Date().toISOString();

  // Build a lookup of status names that have autoFolder enabled
  const autoFolderStatuses = caseStatuses.filter((s) => s.autoFolder);
  const autoFolderStatusNames = new Set(
    autoFolderStatuses.map((s) => s.name.toLowerCase()),
  );

  // 1. Ensure root "Patient Folders" system folder exists
  let root = folders.find((f) => f.id === PATIENT_FOLDERS_ROOT_ID);
  if (!root) {
    root = {
      id: PATIENT_FOLDERS_ROOT_ID,
      name: PATIENT_FOLDERS_ROOT_NAME,
      parentId: null,
      isSystemFolder: true,
      createdAt: now,
      updatedAt: now,
    };
    folders.push(root);
  }

  // 2. Migration: remove old root-level status folders (now nested under years)
  // Old IDs look like "SYSTEM-STATUS-DROPPED"; new IDs look like "SYSTEM-STATUS-2026-DROPPED"
  folders = folders.filter(
    (f) =>
      !(
        f.isSystemFolder &&
        f.id.startsWith("SYSTEM-STATUS-") &&
        !/^SYSTEM-STATUS-\d{4}-/.test(f.id)
      ),
  );

  // Helper: ensure year folder exists
  const ensureYearFolder = (year: string): string => {
    const yearFolderId = `SYSTEM-YEAR-${year}`;
    if (!folders.find((f) => f.id === yearFolderId)) {
      folders.push({
        id: yearFolderId,
        name: year,
        parentId: PATIENT_FOLDERS_ROOT_ID,
        isSystemFolder: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    return yearFolderId;
  };

  // Helper: ensure status folder nested under a year folder
  const ensureStatusFolder = (year: string, statusName: string): string => {
    const yearFolderId = ensureYearFolder(year);
    const statusFolderId = `SYSTEM-STATUS-${year}-${statusName
      .toUpperCase()
      .replace(/\s+/g, "-")}`;
    const existing = folders.find((f) => f.id === statusFolderId);
    if (!existing) {
      folders.push({
        id: statusFolderId,
        name: statusName,
        parentId: yearFolderId,
        isSystemFolder: true,
        createdAt: now,
        updatedAt: now,
      });
    } else if (existing.name !== statusName || existing.parentId !== yearFolderId) {
      folders = folders.map((f) =>
        f.id === statusFolderId
          ? { ...f, name: statusName, parentId: yearFolderId, updatedAt: now }
          : f,
      );
    }
    return statusFolderId;
  };

  // 3. For each patient, determine the correct parent folder
  for (const patient of patients) {
    // Skip soft-deleted patients — their folders stay intact for recovery
    if (patient.deleted) continue;
    const initialExamDate = patient.matrix?.initialExam ?? "";
    const year =
      extractYearFromDate(initialExamDate) ||
      extractYearFromDate(patient.dateOfLoss) ||
      new Date().getFullYear().toString();
    const dolCanonical = toUsDateCanonical(patient.dateOfLoss);
    if (!dolCanonical) continue; // skip patients with invalid DOL

    // Determine target parent: status folder under year, or year itself for ACTIVE
    const patientStatusLower = (patient.caseStatus ?? "").toLowerCase();
    const useStatusFolder = autoFolderStatusNames.has(patientStatusLower);

    let targetParentId: string;
    if (useStatusFolder) {
      const matchedStatus = autoFolderStatuses.find(
        (s) => s.name.toLowerCase() === patientStatusLower,
      )!;
      targetParentId = ensureStatusFolder(year, matchedStatus.name);
    } else {
      targetParentId = ensureYearFolder(year);
    }

    const expectedName = buildPatientFolderName(patient);
    const expectedCaseNumber = buildCaseNumber(patient.dateOfLoss, patient.fullName);

    // 3a. Look for existing folder by patientId metadata (handles rename/restore)
    let patientFolder = folders.find(
      (f) => f.patientId === patient.id && f.isSystemFolder && !f.deleted,
    );

    // 3b. If none, look for an orphan folder with the same case number (deleted or
    //     attached to a no-longer-existing patient) — auto-merge it.
    if (!patientFolder && expectedCaseNumber) {
      const livingPatientIds = new Set(
        patients.filter((p) => !p.deleted).map((p) => p.id),
      );
      const orphan = folders.find(
        (f) =>
          f.isSystemFolder &&
          f.id.startsWith("SYSTEM-PATIENT-") &&
          (f.deleted || (f.patientId && !livingPatientIds.has(f.patientId))) &&
          f.name.startsWith(`${expectedCaseNumber} `),
      );
      if (orphan) {
        const oldFolderId = orphan.id;
        // Restore the orphan folder + all its descendants and their files,
        // and reattach to the new patient.
        folders = folders.map((f) =>
          f.id === oldFolderId
            ? {
                ...f,
                deleted: undefined,
                deletedAt: undefined,
                patientId: patient.id,
                name: expectedName,
                parentId: targetParentId,
                updatedAt: now,
              }
            : f,
        );
        const descendantIds = collectDescendantFolderIds(folders, oldFolderId);
        if (descendantIds.size > 0) {
          folders = folders.map((f) =>
            descendantIds.has(f.id) && f.deleted
              ? { ...f, deleted: undefined, deletedAt: undefined, updatedAt: now }
              : f,
          );
        }
        const restoredFolderIds = new Set<string>([oldFolderId, ...descendantIds]);
        files = files.map((f) =>
          restoredFolderIds.has(f.folderId) && f.deleted
            ? { ...f, deleted: undefined, deletedAt: undefined }
            : f,
        );
        continue; // patient handled
      }
    }

    // 3c. Create new folder if still none
    if (!patientFolder) {
      folders.push({
        id: `SYSTEM-PATIENT-${patient.id}`,
        name: expectedName,
        parentId: targetParentId,
        isSystemFolder: true,
        patientId: patient.id,
        createdAt: now,
        updatedAt: now,
      });
    } else if (
      patientFolder.name !== expectedName ||
      patientFolder.parentId !== targetParentId
    ) {
      // 3d. Update name and/or move folder to new parent (status changed, etc.)
      const targetId = patientFolder.id;
      folders = folders.map((f) =>
        f.id === targetId
          ? { ...f, name: expectedName, parentId: targetParentId, updatedAt: now }
          : f,
      );
    }
  }

  return { ...state, folders, files };
}

// ---------------------------------------------------------------------------
// Exports for system constants
// ---------------------------------------------------------------------------

export { PATIENT_FOLDERS_ROOT_ID, PATIENT_FOLDERS_ROOT_NAME };

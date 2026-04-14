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
  const now = new Date().toISOString();

  // Build a lookup of status names that have autoFolder enabled
  const autoFolderStatusNames = new Set(
    caseStatuses.filter((s) => s.autoFolder).map((s) => s.name.toLowerCase()),
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

  // 2. Ensure status folders exist for every autoFolder status
  for (const s of caseStatuses) {
    if (!s.autoFolder) continue;
    const statusFolderId = `SYSTEM-STATUS-${s.name.toUpperCase().replace(/\s+/g, "-")}`;
    let statusFolder = folders.find((f) => f.id === statusFolderId);
    if (!statusFolder) {
      statusFolder = {
        id: statusFolderId,
        name: s.name,
        parentId: PATIENT_FOLDERS_ROOT_ID,
        isSystemFolder: true,
        createdAt: now,
        updatedAt: now,
      };
      folders.push(statusFolder);
    } else if (statusFolder.name !== s.name) {
      // Update name if status was renamed
      folders = folders.map((f) =>
        f.id === statusFolderId ? { ...f, name: s.name, updatedAt: now } : f,
      );
    }
  }

  // 3. For each patient, determine the correct parent folder
  for (const patient of patients) {
    // Skip soft-deleted patients — their folders stay intact for recovery
    if (patient.deleted) continue;
    const initialExamDate = patient.matrix?.initialExam ?? "";
    const year = extractYearFromDate(initialExamDate) || extractYearFromDate(patient.dateOfLoss) || new Date().getFullYear().toString();
    const dolCanonical = toUsDateCanonical(patient.dateOfLoss);
    if (!dolCanonical) continue; // skip patients with invalid DOL

    // Determine if this patient should go in a status folder or year folder
    const patientStatusLower = (patient.caseStatus ?? "").toLowerCase();
    const useStatusFolder = autoFolderStatusNames.has(patientStatusLower);

    let targetParentId: string;

    if (useStatusFolder) {
      // Find the matching status to get its exact name for the folder ID
      const matchedStatus = caseStatuses.find(
        (s) => s.autoFolder && s.name.toLowerCase() === patientStatusLower,
      );
      targetParentId = matchedStatus
        ? `SYSTEM-STATUS-${matchedStatus.name.toUpperCase().replace(/\s+/g, "-")}`
        : `SYSTEM-YEAR-${year}`;
    } else {
      // Year folder
      const yearFolderId = `SYSTEM-YEAR-${year}`;
      let yearFolder = folders.find((f) => f.id === yearFolderId);
      if (!yearFolder) {
        yearFolder = {
          id: yearFolderId,
          name: year,
          parentId: PATIENT_FOLDERS_ROOT_ID,
          isSystemFolder: true,
          createdAt: now,
          updatedAt: now,
        };
        folders.push(yearFolder);
      }
      targetParentId = yearFolderId;
    }

    // Patient folder
    const patientFolderId = `SYSTEM-PATIENT-${patient.id}`;
    const expectedName = buildPatientFolderName(patient);
    let patientFolder = folders.find((f) => f.id === patientFolderId);

    if (!patientFolder) {
      patientFolder = {
        id: patientFolderId,
        name: expectedName,
        parentId: targetParentId,
        isSystemFolder: true,
        patientId: patient.id,
        createdAt: now,
        updatedAt: now,
      };
      folders.push(patientFolder);
    } else {
      // Update name if patient was renamed, or move to correct parent folder
      if (patientFolder.name !== expectedName || patientFolder.parentId !== targetParentId) {
        folders = folders.map((f) =>
          f.id === patientFolderId
            ? { ...f, name: expectedName, parentId: targetParentId, updatedAt: now }
            : f,
        );
      }
    }
  }

  return { ...state, folders };
}

// ---------------------------------------------------------------------------
// Exports for system constants
// ---------------------------------------------------------------------------

export { PATIENT_FOLDERS_ROOT_ID, PATIENT_FOLDERS_ROOT_NAME };

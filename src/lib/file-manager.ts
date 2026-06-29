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
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", state));
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

/**
 * Move a file to a different folder.
 *
 * Returns `{ ok: false, error }` for invalid moves:
 *   - file id doesn't exist
 *   - target folder id doesn't exist (other than null = root, which
 *     is allowed for files moved to the top level if the caller
 *     wants that — though the UI currently always targets a folder)
 *   - file is already in the target folder (no-op, returns ok)
 */
export function moveFile(
  state: FileManagerState,
  fileId: string,
  newFolderId: string,
): { ok: true; state: FileManagerState } | { ok: false; error: string } {
  const file = state.files.find((f) => f.id === fileId);
  if (!file) return { ok: false, error: "File not found." };
  if (file.folderId === newFolderId) {
    // No-op move; tell the caller it's fine without churning state.
    return { ok: true, state };
  }
  const targetFolder = state.folders.find((f) => f.id === newFolderId);
  if (!targetFolder) return { ok: false, error: "Target folder not found." };
  const nextState: FileManagerState = {
    ...state,
    files: state.files.map((f) =>
      f.id === fileId
        ? { ...f, folderId: newFolderId, updatedAt: new Date().toISOString() }
        : f,
    ),
  };
  return { ok: true, state: nextState };
}

/**
 * Move a folder under a new parent.
 *
 * Returns `{ ok: false, error }` for invalid moves:
 *   - folder id doesn't exist
 *   - folder is a system folder (those have fixed hierarchy)
 *   - target parent doesn't exist (other than null = root)
 *   - target parent is the folder itself (would orphan it)
 *   - target parent is a descendant of the folder (would create a
 *     cycle — A → B → A loops the tree)
 *   - already in that parent (no-op, returns ok)
 */
export function moveFolder(
  state: FileManagerState,
  folderId: string,
  newParentId: string | null,
): { ok: true; state: FileManagerState } | { ok: false; error: string } {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return { ok: false, error: "Folder not found." };
  if (folder.isSystemFolder) {
    return { ok: false, error: "System folders cannot be moved." };
  }
  if (folder.parentId === newParentId) {
    return { ok: true, state };
  }
  if (newParentId === folderId) {
    return { ok: false, error: "A folder cannot be moved into itself." };
  }
  if (newParentId !== null) {
    const targetParent = state.folders.find((f) => f.id === newParentId);
    if (!targetParent) {
      return { ok: false, error: "Target parent folder not found." };
    }
    // Cycle check: target can't be a descendant of the folder
    // we're moving. Walk up from the target — if we hit our own
    // id before hitting root, it's a cycle.
    const descendants = collectDescendantFolderIds(state.folders, folderId);
    if (descendants.has(newParentId)) {
      return {
        ok: false,
        error: "Cannot move a folder into one of its own subfolders.",
      };
    }
  }
  const nextState: FileManagerState = {
    ...state,
    folders: state.folders.map((f) =>
      f.id === folderId
        ? { ...f, parentId: newParentId, updatedAt: new Date().toISOString() }
        : f,
    ),
  };
  return { ok: true, state: nextState };
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

/**
 * Permanently remove a file record from the manifest. Returns the storage
 * path of the deleted file so the caller can clean it up from Supabase
 * Storage in the same operation. Returns `null` if the file wasn't found
 * or was never soft-deleted (we only allow permanent-delete from the
 * trash so the user can't accidentally nuke an active file).
 */
export function permanentlyDeleteFileRecord(
  state: FileManagerState,
  fileId: string,
): { state: FileManagerState; storagePath: string | null } {
  const file = state.files.find((f) => f.id === fileId);
  if (!file || !file.deleted) {
    return { state, storagePath: null };
  }
  return {
    state: {
      ...state,
      files: state.files.filter((f) => f.id !== fileId),
    },
    storagePath: file.storagePath,
  };
}

/**
 * Permanently remove a folder + every nested folder + every file under
 * that subtree. Returns the list of storage paths that should be cleaned
 * out of Supabase Storage by the caller. Refuses to act on system folders
 * (those are auto-managed and a permanent delete would just spawn them
 * back on the next sync).
 */
export function permanentlyDeleteFolderRecord(
  state: FileManagerState,
  folderId: string,
): { state: FileManagerState; storagePaths: string[] } {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder || !folder.deleted || folder.isSystemFolder) {
    return { state, storagePaths: [] };
  }
  const descendantIds = collectDescendantFolderIds(state.folders, folderId);
  descendantIds.add(folderId);
  const storagePaths = state.files
    .filter((f) => descendantIds.has(f.folderId))
    .map((f) => f.storagePath)
    .filter((p): p is string => Boolean(p));
  return {
    state: {
      folders: state.folders.filter((f) => !descendantIds.has(f.id)),
      files: state.files.filter((f) => !descendantIds.has(f.folderId)),
    },
    storagePaths,
  };
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

  // Set of patient ids that still exist — used to recognise folders that are
  // orphaned (attached to a patient id that no longer exists).
  const livingPatientIds = new Set(
    patients.filter((p) => !p.deleted).map((p) => p.id),
  );

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

    // 3a. Gather EVERY system folder that belongs to this patient. The April
    //     re-import re-created many patients under brand-new ids while their
    //     old-id folders lingered, so a single patient can end up owning several
    //     duplicate system folders. Match by patientId metadata, plus any folder
    //     whose FULL name equals this patient's expected folder name but is
    //     attached to a dead/empty patientId (an orphaned old-id folder).
    //     Matching the full name — case number AND formatted name — means we
    //     never merge two different people who merely share initials and a DOL.
    const canonicalId = `SYSTEM-PATIENT-${patient.id}`;
    const belonging = folders.filter(
      (f) =>
        f.isSystemFolder &&
        !f.deleted &&
        f.id.startsWith("SYSTEM-PATIENT-") &&
        (f.patientId === patient.id ||
          (f.name === expectedName &&
            (!f.patientId || !livingPatientIds.has(f.patientId)))),
    );

    // 3b. No live folder yet: restore a soft-deleted / orphaned folder with the
    //     same case number (a re-created patient regaining its old files), or
    //     create a fresh one.
    if (belonging.length === 0) {
      const orphan = expectedCaseNumber
        ? folders.find(
            (f) =>
              f.isSystemFolder &&
              f.id.startsWith("SYSTEM-PATIENT-") &&
              (f.deleted || (f.patientId && !livingPatientIds.has(f.patientId))) &&
              f.name.startsWith(`${expectedCaseNumber} `),
          )
        : undefined;
      if (orphan) {
        const oldFolderId = orphan.id;
        // Restore the orphan + descendants and reattach to this patient,
        // migrating the folder id so SYSTEM-PATIENT-<id> lookups resolve.
        folders = folders.map((f) => {
          if (f.id === oldFolderId) {
            return {
              ...f,
              id: canonicalId,
              deleted: undefined,
              deletedAt: undefined,
              patientId: patient.id,
              name: expectedName,
              parentId: targetParentId,
              updatedAt: now,
            };
          }
          if (f.parentId === oldFolderId) {
            return { ...f, parentId: canonicalId };
          }
          return f;
        });
        const descendantIds = collectDescendantFolderIds(folders, canonicalId);
        if (descendantIds.size > 0) {
          folders = folders.map((f) =>
            descendantIds.has(f.id) && f.deleted
              ? { ...f, deleted: undefined, deletedAt: undefined, updatedAt: now }
              : f,
          );
        }
        const restoredFolderIds = new Set<string>([canonicalId, ...descendantIds]);
        files = files.map((f) => {
          if (f.folderId === oldFolderId) {
            return {
              ...f,
              folderId: canonicalId,
              ...(f.deleted ? { deleted: undefined, deletedAt: undefined } : {}),
            };
          }
          if (restoredFolderIds.has(f.folderId) && f.deleted) {
            return { ...f, deleted: undefined, deletedAt: undefined };
          }
          return f;
        });
      } else {
        folders.push({
          id: canonicalId,
          name: expectedName,
          parentId: targetParentId,
          isSystemFolder: true,
          patientId: patient.id,
          createdAt: now,
          updatedAt: now,
        });
      }
      continue; // patient handled
    }

    // 3c. Pick the surviving folder: prefer the one already keyed by the current
    //     patient id, otherwise the oldest, so files settle on a stable folder.
    const survivor =
      belonging.find((f) => f.id === canonicalId) ??
      [...belonging].sort((a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      )[0];
    const survivorId = survivor.id;

    // 3d. Fold every duplicate into the survivor: move its files and any child
    //     folders over, then drop the now-empty duplicate record. No real data
    //     is lost — files are reattached; only the redundant folder disappears.
    const duplicateIds = new Set(
      belonging.filter((f) => f.id !== survivorId).map((f) => f.id),
    );
    if (duplicateIds.size > 0) {
      files = files.map((f) =>
        duplicateIds.has(f.folderId) ? { ...f, folderId: survivorId } : f,
      );
      folders = folders.map((f) =>
        f.parentId && duplicateIds.has(f.parentId)
          ? { ...f, parentId: survivorId }
          : f,
      );
      folders = folders.filter((f) => !duplicateIds.has(f.id) || f.id === survivorId);
    }

    // 3e. Normalise the survivor (correct patientId / name / parent).
    folders = folders.map((f) =>
      f.id === survivorId
        ? {
            ...f,
            patientId: patient.id,
            name: expectedName,
            parentId: targetParentId,
            updatedAt: now,
          }
        : f,
    );
  }

  return { ...state, folders, files };
}

// ---------------------------------------------------------------------------
// Exports for system constants
// ---------------------------------------------------------------------------

export { PATIENT_FOLDERS_ROOT_ID, PATIENT_FOLDERS_ROOT_NAME };

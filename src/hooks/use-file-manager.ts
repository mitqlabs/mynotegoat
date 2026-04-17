"use client";

import { useCallback, useEffect, useState } from "react";
import type { PatientRecord } from "@/lib/mock-data";
import type { CaseStatusConfig } from "@/lib/case-statuses";
import {
  type FileManagerState,
  type FileRecord,
  addFolder,
  renameFolder,
  deleteFolder as deleteFolderOp,
  addFileRecord,
  removeFileRecord,
  renameFileRecord,
  restoreFileRecord as restoreFileOp,
  restoreFolderRecord as restoreFolderOp,
  permanentlyDeleteFileRecord,
  permanentlyDeleteFolderRecord,
  getDeletedFiles,
  getDeletedFolders,
  loadFileManagerState,
  saveFileManagerState,
  syncPatientFolders,
} from "@/lib/file-manager";
import {
  uploadFileToStorage,
  deleteFilesFromStorage,
} from "@/lib/file-storage";

export function useFileManager(patients: PatientRecord[], caseStatuses: CaseStatusConfig[] = []) {
  const [state, setState] = useState<FileManagerState>(() => {
    const loaded = loadFileManagerState();
    return syncPatientFolders(loaded, patients, caseStatuses);
  });

  // Re-sync patient folders when patients change
  useEffect(() => {
    setState((current) => {
      const synced = syncPatientFolders(current, patients, caseStatuses);
      // Detect any change: folder count, file count, name/parent/patientId/deleted shifts
      const folderChanged =
        synced.folders.length !== current.folders.length ||
        synced.folders.some((sf) => {
          const cf = current.folders.find((c) => c.id === sf.id);
          return (
            !cf ||
            cf.name !== sf.name ||
            cf.parentId !== sf.parentId ||
            cf.patientId !== sf.patientId ||
            !!cf.deleted !== !!sf.deleted
          );
        });
      const fileChanged =
        synced.files.length !== current.files.length ||
        synced.files.some((sf) => {
          const cf = current.files.find((c) => c.id === sf.id);
          return !cf || !!cf.deleted !== !!sf.deleted;
        });
      if (folderChanged || fileChanged) {
        saveFileManagerState(synced);
        return synced;
      }
      return current;
    });
  }, [patients, caseStatuses]);

  const persist = useCallback((next: FileManagerState) => {
    saveFileManagerState(next);
    setState(next);
  }, []);

  // --- Folder operations ---

  const createFolder = useCallback(
    (name: string, parentId: string | null) => {
      if (!name.trim()) return;
      setState((current) => {
        const next = addFolder(current, name, parentId);
        saveFileManagerState(next);
        return next;
      });
    },
    [],
  );

  const updateFolderName = useCallback(
    (folderId: string, newName: string) => {
      if (!newName.trim()) return;
      setState((current) => {
        const next = renameFolder(current, folderId, newName);
        saveFileManagerState(next);
        return next;
      });
    },
    [],
  );

  const deleteUserFolder = useCallback(
    async (folderId: string) => {
      setState((current) => {
        const result = deleteFolderOp(current, folderId);
        // Soft-delete — no storage paths to delete
        saveFileManagerState(result.state);
        return result.state;
      });
    },
    [],
  );

  // --- File operations ---

  const uploadFile = useCallback(
    async (
      folderId: string,
      file: File,
    ): Promise<{ success: boolean; error?: string }> => {
      const { storagePath, error } = await uploadFileToStorage(folderId, file);
      if (error || !storagePath) {
        return { success: false, error: error ?? "Upload failed" };
      }

      setState((current) => {
        const next = addFileRecord(current, {
          folderId,
          name: file.name,
          storagePath,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
        saveFileManagerState(next);
        return next;
      });

      return { success: true };
    },
    [],
  );

  const renameFile = useCallback(
    (fileId: string, newName: string) => {
      setState((current) => {
        const next = renameFileRecord(current, fileId, newName);
        saveFileManagerState(next);
        return next;
      });
    },
    [],
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      setState((current) => {
        const result = removeFileRecord(current, fileId);
        // Soft-delete — storagePath is null, no storage deletion needed
        saveFileManagerState(result.state);
        return result.state;
      });
    },
    [],
  );

  // --- Restore operations (trash) ---

  const restoreFile = useCallback(
    (fileId: string) => {
      setState((current) => {
        const next = restoreFileOp(current, fileId);
        saveFileManagerState(next);
        return next;
      });
    },
    [],
  );

  const restoreFolder = useCallback(
    (folderId: string) => {
      setState((current) => {
        const next = restoreFolderOp(current, folderId);
        saveFileManagerState(next);
        return next;
      });
    },
    [],
  );

  // --- Permanent-delete operations (irreversible — drops the metadata row
  //     AND removes the underlying object from Supabase Storage). Only
  //     succeeds against items already in the trash. ---

  const permanentlyDeleteFile = useCallback(
    async (fileId: string) => {
      let toCleanUp: string | null = null;
      setState((current) => {
        const result = permanentlyDeleteFileRecord(current, fileId);
        toCleanUp = result.storagePath;
        if (toCleanUp) saveFileManagerState(result.state);
        return result.state;
      });
      // Fire the storage delete after the state write so the UI updates
      // immediately. Failure here doesn't restore the metadata row — the
      // file is gone from the user's view either way; the worst case is a
      // dangling blob in the bucket which can be reaped server-side.
      if (toCleanUp) {
        await deleteFilesFromStorage([toCleanUp]);
      }
    },
    [],
  );

  const permanentlyDeleteFolder = useCallback(
    async (folderId: string) => {
      let toCleanUp: string[] = [];
      setState((current) => {
        const result = permanentlyDeleteFolderRecord(current, folderId);
        toCleanUp = result.storagePaths;
        // Always save — the helper returns the original state if it
        // refused (e.g. system folder), so no harm.
        saveFileManagerState(result.state);
        return result.state;
      });
      if (toCleanUp.length > 0) {
        await deleteFilesFromStorage(toCleanUp);
      }
    },
    [],
  );

  // --- Trash queries ---

  const deletedFiles = getDeletedFiles(state);
  const deletedFolders = getDeletedFolders(state);

  return {
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
  };
}

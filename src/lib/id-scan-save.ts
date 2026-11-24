"use client";

import { caseNumberOf } from "@/lib/follow-up-queue";
import {
  PATIENT_FOLDERS_ROOT_ID,
  addFileRecord,
  loadFileManagerState,
  saveFileManagerState,
  type FileFolder,
} from "@/lib/file-manager";
import { uploadFileToStorage } from "@/lib/file-storage";
import { notifyChange } from "@/lib/local-sync";
import { getPatientById } from "@/lib/mock-data";

const FILES_KEY = "casemate.files.v1";

/** Picture held in memory until Create Patient. A reload drops it. Not localStorage. */
let held: File | null = null;

export function holdIdImage(file: File | null) {
  held = file;
}

export function takeHeldIdImage(): File | null {
  const file = held;
  held = null;
  return file;
}

export function clearHeldIdImage() {
  held = null;
}

function ensurePatientFolder(patientId: string): string | null {
  const current = loadFileManagerState();
  const existing = current.folders.find((folder) => folder.patientId === patientId && folder.isSystemFolder && !folder.deleted);
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
}

/** Save the ID picture through the same Patient Files path as Upload / Scan. */
export async function saveIdImageToPatient(patientId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const folderId = ensurePatientFolder(patientId);
  if (!folderId) return { ok: false, error: "no file folder" };
  const { storagePath, name, error } = await uploadFileToStorage(folderId, file);
  if (error || !storagePath) return { ok: false, error: error || "upload failed" };
  const next = addFileRecord(loadFileManagerState(), {
    folderId,
    name,
    storagePath,
    mimeType: file.type || "image/jpeg",
    sizeBytes: file.size,
  });
  saveFileManagerState(next);
  notifyChange(FILES_KEY);
  return { ok: true };
}

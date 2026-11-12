"use client";

/**
 * In-memory person overlay. Runs only when the folder switch is on, and only
 * after the case rows have loaded. It copies person fields onto the case
 * objects the rest of the app already reads, and remembers the original
 * columns so a later case save writes those originals back to the patients
 * table. It does not call persist, upsert, or any SQL.
 */
import { rememberOriginalPerson } from "@/lib/patient-folder-guard";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { groupPatientCases, type FolderPerson } from "@/lib/patient-folders";
import { PATIENTS_STORAGE_KEY, patients, type PatientRecord } from "@/lib/mock-data";
import { loadFolderCloud, saveFolderCloud, type FolderPersonRecord } from "@/lib/patient-folder-store";
import { notifyChange } from "@/lib/local-sync";
import { normalizeMaritalStatus } from "@/lib/marital-status";

function snapshotOf(patient: PatientRecord) {
  return {
    fullName: patient.fullName ?? "",
    dob: patient.dob ?? "",
    sex: patient.sex ?? null,
    maritalStatus: patient.maritalStatus ?? null,
    phone: patient.phone ?? "",
    email: patient.email ?? null,
    address: patient.address ?? null,
    alerts: patient.alerts ? [...patient.alerts] : null,
  };
}

function paint(patient: PatientRecord, person: FolderPerson | FolderPersonRecord) {
  patient.fullName = person.fullName;
  patient.dob = person.dob;
  patient.phone = person.phone;
  patient.email = person.email || undefined;
  patient.address = person.address || undefined;
  patient.sex = person.sex === "Male" || person.sex === "Female" || person.sex === "Other" ? person.sex : undefined;
  patient.maritalStatus = normalizeMaritalStatus(person.maritalStatus);
  patient.alerts = person.alerts.length ? [...person.alerts] : undefined;
}

/** Remember originals, then show the folder's person fields on every member case. */
export function installFolderPersonOverlay(): void {
  if (!patientFoldersEnabled()) return;
  for (const patient of patients) {
    if (patient.deleted) continue;
    rememberOriginalPerson(patient.id, snapshotOf(patient));
  }
  const cloud = loadFolderCloud();
  const live = patients.filter((patient) => !patient.deleted);
  const grouping = groupPatientCases(
    live.map((patient) => ({
      id: patient.id,
      fullName: patient.fullName,
      dob: patient.dob,
      phone: patient.phone,
      email: patient.email,
      address: patient.address,
      sex: patient.sex,
      maritalStatus: patient.maritalStatus,
      alerts: patient.alerts,
      caseStatus: patient.caseStatus,
    })),
  );
  const byId = new Map(live.map((patient) => [patient.id, patient]));
  for (const folder of grouping.folders) {
    const override = cloud.people[folder.id];
    const person = override ?? folder.person;
    for (const caseId of folder.caseIds) {
      const patient = byId.get(caseId);
      if (patient) paint(patient, person);
    }
  }
  notifyChange(PATIENTS_STORAGE_KEY);
}

/** A case-page edit of phone, name, or address is stored on the folder, not the case row. */
export async function savePersonForCase(
  caseId: string,
  person: Omit<FolderPersonRecord, "folderId" | "updatedAt">,
): Promise<void> {
  if (!patientFoldersEnabled()) return;
  const live = patients.filter((patient) => !patient.deleted);
  const grouping = groupPatientCases(
    live.map((patient) => ({
      id: patient.id,
      fullName: patient.fullName,
      dob: patient.dob,
      phone: patient.phone,
      email: patient.email,
      address: patient.address,
      sex: patient.sex,
      maritalStatus: patient.maritalStatus,
      alerts: patient.alerts,
      caseStatus: patient.caseStatus,
    })),
  );
  const folder = grouping.folders.find((item) => item.caseIds.includes(caseId));
  if (!folder) return;
  await saveFolderPerson(folder.id, person);
}

export async function saveFolderPerson(folderId: string, person: Omit<FolderPersonRecord, "folderId" | "updatedAt">): Promise<void> {
  if (!patientFoldersEnabled()) return;
  const cloud = loadFolderCloud();
  const previous = cloud.people[folderId];
  cloud.people[folderId] = {
    ...person,
    folderId,
    alerts: [...person.alerts],
    photoDataUrl: person.photoDataUrl !== undefined ? person.photoDataUrl : (previous?.photoDataUrl ?? ""),
    photoPath: person.photoPath !== undefined ? person.photoPath : (previous?.photoPath ?? ""),
    updatedAt: new Date().toISOString(),
  };
  await saveFolderCloud(cloud);
  installFolderPersonOverlay();
}

/** Save the cropped square on the person. Every case for this folder reads it. */
export async function savePatientPhoto(
  folderId: string,
  dataUrl: string,
  person: Omit<FolderPersonRecord, "folderId" | "updatedAt" | "photoDataUrl" | "photoPath">,
): Promise<void> {
  if (!patientFoldersEnabled()) return;
  const { isPatientPhotoDataUrl } = await import("@/lib/patient-photo");
  if (!isPatientPhotoDataUrl(dataUrl)) return;
  const { uploadPatientPhoto } = await import("@/lib/patient-photo-storage");
  const photoPath = await uploadPatientPhoto(folderId, dataUrl);
  await saveFolderPerson(folderId, { ...person, photoDataUrl: dataUrl, ...(photoPath ? { photoPath } : {}) });
}

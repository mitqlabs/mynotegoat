"use client";

import Link from "next/link";
import { PatientCaseFile } from "@/components/patient-case-file";
import { PatientFolderCasePage, PatientFolderRecordPage } from "@/components/patient-folder-live";
import { getPatientById } from "@/lib/mock-data";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";

type PatientFilePageClientProps = {
  patientId: string;
};

export function PatientFilePageClient({ patientId }: PatientFilePageClientProps) {
  if (patientFoldersEnabled()) {
    if (patientId.startsWith("pf-")) return <PatientFolderRecordPage folderId={patientId} />;
    return <PatientFolderCasePage caseId={patientId} />;
  }
  const patient = getPatientById(patientId);

  if (!patient) {
    return (
      <div className="panel-card p-5">
        <p className="text-lg font-semibold">Patient Not Found</p>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          This patient ID is not available in the current import set.
        </p>
        <Link className="mt-3 inline-block font-semibold text-[var(--brand-primary)] underline" href="/patients">
          Return to Patients
        </Link>
      </div>
    );
  }

  return <PatientCaseFile patient={patient} />;
}

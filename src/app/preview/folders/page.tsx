import { notFound } from "next/navigation";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { PatientFolderPreviewApp } from "@/components/patient-folder-preview-app";

/**
 * Fixture preview of the patient-as-folder screens. It renders only when
 * NEXT_PUBLIC_PATIENT_FOLDERS=on, which production does not set. The people
 * on this page are fictional. It does not read or write the database.
 */
export default async function PatientFolderPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!patientFoldersEnabled()) notFound();
  const params = await searchParams;
  const view = params.view === "patient" || params.view === "case" || params.view === "cases" || params.view === "list" ? params.view : "list";
  return <PatientFolderPreviewApp initial={view} />;
}

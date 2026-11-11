import { redirect } from "next/navigation";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { PatientFilePageClient } from "@/components/patient-file-page-client";

type PageProps = { params: Promise<{ id: string }> };

/** One case. With the switch off, the old /patients/[id] address is used. */
export default async function CaseFilePage({ params }: PageProps) {
  const { id } = await params;
  if (!patientFoldersEnabled()) redirect(`/patients/${id}`);
  return <PatientFilePageClient patientId={id} />;
}

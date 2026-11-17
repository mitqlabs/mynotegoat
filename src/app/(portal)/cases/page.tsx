import { redirect } from "next/navigation";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { CasesListClient } from "@/app/(portal)/cases/cases-list-client";

/** Today's patient list, one row per case. Hidden unless the folder switch is on. */
export default function CasesPage() {
  if (!patientFoldersEnabled()) redirect("/patients");
  return <CasesListClient />;
}

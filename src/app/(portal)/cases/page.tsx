"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { patientFoldersEnabled } from "@/lib/patient-folder-flag";
import { CasesListClient } from "@/app/(portal)/cases/cases-list-client";

/** Case List. On for the folder preview switch and for the demo office. */
export default function CasesPage() {
  const router = useRouter();
  const [allow, setAllow] = useState(false);
  useEffect(() => {
    if (patientFoldersEnabled()) setAllow(true);
    else router.replace("/patients");
  }, [router]);
  if (!allow) return null;
  return <CasesListClient />;
}

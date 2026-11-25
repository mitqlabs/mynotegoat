"use client";

/**
 * Local screenshot page for the patient file header.
 * Mock person only. Nothing here is linked from the app, and nothing is saved.
 */

import { useState } from "react";
import { PatientFileHeader } from "@/components/patient-file-header";
import type { PatientPersonDraft } from "@/components/patient-person-fields";

const PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="140" viewBox="0 0 110 140">
      <rect width="110" height="140" fill="#1c3348"/>
      <circle cx="55" cy="52" r="22" fill="#9ed4f5"/>
      <ellipse cx="55" cy="120" rx="34" ry="26" fill="#9ed4f5"/>
    </svg>`,
  );

const INITIAL: PatientPersonDraft = {
  lastName: "Aslanyan",
  firstName: "Armen",
  dob: "03/15/1978",
  phone: "818-555-0148",
  sex: "Male",
  maritalStatus: "Married",
  email: "armen@example.com",
  address: "123 Main St, Unit 4, Glendale, CA 91206",
  textRemindersOff: false,
};

export default function CaseHeaderPreviewPage() {
  const [person, setPerson] = useState<PatientPersonDraft>(INITIAL);
  const [alerts, setAlerts] = useState<string[]>(["BROKEN RIB"]);
  const [alertDraft, setAlertDraft] = useState("");

  const name = [person.lastName, person.firstName].map((part) => part.trim()).filter(Boolean).join(", ") || "Patient";

  return (
    <div className="min-h-screen bg-[var(--shell-bg)] text-[var(--text-main)] lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden border-r border-[var(--shell-border)] bg-[var(--bg-sidebar)] p-6 lg:block">
        <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="My Note Goat" className="h-20 w-full object-contain" src="/mynotegoatlogo.png" />
        </div>
      </aside>
      <main className="min-w-0 p-4 lg:p-7">
        <section className="panel-card px-4 py-3">
          <PatientFileHeader
            alertDraft={alertDraft}
            alerts={alerts}
            folderCrumb={{ id: "pf-mock", name }}
            name={name}
            onAddAlert={(text) => setAlerts((current) => [...current, text])}
            onAlertDraftChange={setAlertDraft}
            onPersonChange={setPerson}
            onRemoveAlert={(index) => setAlerts((current) => current.filter((_, i) => i !== index))}
            person={person}
            photoSrc={PHOTO}
          />
        </section>
      </main>
    </div>
  );
}

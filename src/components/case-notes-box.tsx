"use client";

import { CaseNotesLog } from "@/components/case-notes-log";

/**
 * Notes box for the encounter side rail. Same quick-entry log as the patient
 * page (type a note, press Enter): both read the same cloud-backed list.
 */
export function CaseNotesBox({
  patientId,
  patientName = "",
  seed = "",
}: {
  patientId: string;
  patientName?: string;
  seed?: string;
}) {
  return (
    <section className="panel-card p-3">
      <div className="grid gap-2">
        <span className="text-sm font-semibold">Notes</span>
        <CaseNotesLog maxListHeight={260} patientId={patientId} patientName={patientName} seed={seed} />
      </div>
    </section>
  );
}

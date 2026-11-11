"use client";

import Link from "next/link";
import { appConfirm } from "@/components/app-dialog";
import { deleteIntakePatient, intakeDeleteBlock } from "@/lib/intake-delete";
import type { PatientRecord } from "@/lib/mock-data";

/** Delete, or a disabled button whose tooltip says why it is blocked. */
export function IntakeDeleteButton({ patientId }: { patientId: string }) {
  const reason = intakeDeleteBlock(patientId);
  return (
    <span className="group relative inline-flex" title={reason ?? undefined}>
      <button
        className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-40"
        disabled={Boolean(reason)}
        onClick={() => {
          void (async () => {
            if (intakeDeleteBlock(patientId)) return;
            const ok = await appConfirm("Delete this patient? This can't be undone.");
            if (!ok) return;
            deleteIntakePatient(patientId);
          })();
        }}
        type="button"
      >
        Delete
      </button>
      {reason && (
        <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-1 hidden w-56 rounded-lg bg-[#123044] px-2 py-1 text-left text-xs font-normal leading-snug text-white shadow-lg group-hover:block">
          {reason}
        </span>
      )}
    </span>
  );
}

/** Patients with no case info, shown above the Patient List. */
export function NewPatientIntakeSection({
  patients,
  onAddCase,
}: {
  patients: Pick<PatientRecord, "id" | "fullName" | "phone">[];
  onAddCase?: (patientId: string) => void;
}) {
  if (patients.length === 0) return null;
  return (
    <section className="panel-card p-4" data-new-patient-intake>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">New Patient Intake</h3>
        <span className="text-sm text-[var(--text-muted)]">{patients.length} without case info</span>
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        No date of injury yet. + Case adds it and moves them onto the Patient List. Delete permanently removes a chart that has no notes and no appointments.
      </p>
      <ul className="mt-3 divide-y divide-[var(--line-soft)]">
        {patients.map((patient) => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={patient.id}>
            <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${patient.id}`}>
              {patient.fullName}
            </Link>
            <span className="text-xs text-[var(--text-muted)]">{patient.phone || "No phone"}</span>
            <span className="flex flex-wrap items-center gap-2">
              {onAddCase && (
                <button className="btn btn-secondary btn-sm" data-testid="intake-add-case" onClick={() => onAddCase(patient.id)} type="button">
                  + Case
                </button>
              )}
              <IntakeDeleteButton patientId={patient.id} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

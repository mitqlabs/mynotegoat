"use client";

import Link from "next/link";
import { appConfirm } from "@/components/app-dialog";
import type { PatientRecord } from "@/lib/mock-data";

/** Patients with no case info, shown above the Patient List. */
export function NewPatientIntakeSection({
  patients,
  onRemove,
}: {
  patients: Pick<PatientRecord, "id" | "fullName" | "phone">[];
  onRemove: (patientId: string) => void;
}) {
  if (patients.length === 0) return null;
  return (
    <section className="panel-card p-4" data-new-patient-intake>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">New Patient Intake</h3>
        <span className="text-sm text-[var(--text-muted)]">{patients.length} without case info</span>
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        No date of injury yet. Adding case info moves them onto the Patient List. Remove hides a chart you don&apos;t want. Restore it from Deleted Patients.
      </p>
      <ul className="mt-3 divide-y divide-[var(--line-soft)]">
        {patients.map((patient) => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={patient.id}>
            <Link className="font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${patient.id}`}>
              {patient.fullName}
            </Link>
            <span className="text-xs text-[var(--text-muted)]">{patient.phone || "No phone"}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void (async () => {
                  const ok = await appConfirm(`Remove ${patient.fullName} from New Patient Intake? They'll be hidden from the lists. Restore them from Deleted Patients.`);
                  if (ok) onRemove(patient.id);
                })();
              }}
              type="button"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

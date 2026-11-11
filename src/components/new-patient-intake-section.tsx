"use client";

import Link from "next/link";
import type { PatientRecord } from "@/lib/mock-data";

/** Patients with no case info, shown above the Patient List. */
export function NewPatientIntakeSection({
  patients,
  onMove,
  onAddCase,
}: {
  patients: Pick<PatientRecord, "id" | "fullName" | "phone">[];
  onMove: (patientId: string) => void;
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
        No date of injury yet. + Case adds it and moves them onto the Patient List. Move Patient to Patient List does that without case info.
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
              <button className="btn btn-secondary btn-sm" onClick={() => onMove(patient.id)} type="button">
                Move Patient to Patient List
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";

import { returningPatientLabel, type ReturningPatient } from "@/lib/returning-patient";

/** Small prompt under the name row. The duplicate-case warning stays separate. */
export function ReturningPatientBanner({
  matches,
  onFill,
  onDismiss,
}: {
  matches: ReturningPatient[];
  onFill: (id: string) => void;
  onDismiss: () => void;
}) {
  if (matches.length === 0) return null;
  const one = matches.length === 1 ? matches[0] : null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-[#72bdcf] bg-[#eef8fb] px-3 py-2 text-sm"
      data-returning-patient
    >
      {one ? (
        <p className="min-w-0 flex-1">
          Returning patient? Fill from <span className="font-semibold">{returningPatientLabel(one)}</span>
        </p>
      ) : (
        <p className="w-full font-semibold">Returning patient?</p>
      )}
      {one ? (
        <button className="btn btn-secondary btn-sm" onClick={() => onFill(one.id)} type="button">
          Fill in
        </button>
      ) : (
        <ul className="flex w-full flex-col gap-1">
          {matches.slice(0, 6).map((patient) => (
            <li key={patient.id}>
              <button className="text-left font-semibold text-[var(--brand-primary)] hover:underline" onClick={() => onFill(patient.id)} type="button">
                Fill from {returningPatientLabel(patient)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button aria-label="Dismiss" className="text-xs font-semibold text-[var(--text-muted)] underline" onClick={onDismiss} type="button">
        Dismiss
      </button>
    </div>
  );
}

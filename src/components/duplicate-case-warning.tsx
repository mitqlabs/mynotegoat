"use client";

import Link from "next/link";
import type { DuplicateCandidate } from "@/lib/patient-duplicate";

/** Prominent warning with a link to each existing chart. Name-only matches never reach this. */
export function DuplicateCaseWarning({ matches }: { matches: DuplicateCandidate[] }) {
  if (matches.length === 0) return null;
  return (
    <div
      className="rounded-xl border-2 border-[#c93b1d] bg-[#fff4f1] px-3 py-2 text-sm text-[#7a2412]"
      data-duplicate-case
      role="alert"
    >
      <p className="font-semibold">Possible duplicate — same name and the same date of loss</p>
      <ul className="mt-1 space-y-1">
        {matches.map((patient) => (
          <li key={patient.id}>
            <Link className="font-semibold underline" href={`/patients/${patient.id}`}>
              Open {patient.fullName}&apos;s chart
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

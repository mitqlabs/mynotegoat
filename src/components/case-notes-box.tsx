"use client";

import { useCaseNotes } from "@/hooks/use-case-notes";

/**
 * Free-form Case Notes box that mirrors the patient page's Notes box (same
 * shared store). Type to add, clear to delete — changes reflect on both pages.
 * Always open: it's a small box, and a collapse pill was just one more click.
 */
export function CaseNotesBox({
  patientId,
  seed = "",
}: {
  patientId: string;
  seed?: string;
}) {
  const { notes, setNotes } = useCaseNotes(patientId, seed);

  return (
    <section className="panel-card p-3">
      <label className="grid gap-2">
        <span className="text-sm font-semibold">Case Notes</span>
        <textarea
          className="min-h-[120px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Enter any free-form case notes..."
          value={notes}
        />
      </label>
    </section>
  );
}

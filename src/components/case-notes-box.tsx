"use client";

import { useState } from "react";
import { useCaseNotes } from "@/hooks/use-case-notes";

/**
 * Free-form Case Notes box that mirrors the patient page's Notes box (same
 * shared store). Type to add, clear to delete — changes reflect on both pages.
 */
export function CaseNotesBox({
  patientId,
  seed = "",
  defaultOpen = true,
}: {
  patientId: string;
  seed?: string;
  defaultOpen?: boolean;
}) {
  const { notes, setNotes } = useCaseNotes(patientId, seed);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel-card p-4">
      <button
        className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-lg font-semibold text-white"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>Notes</span>
        <span className="text-xl">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <label className="mt-3 grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Case Notes</span>
          <textarea
            className="min-h-[120px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Enter any free-form case notes..."
            value={notes}
          />
        </label>
      )}
    </section>
  );
}

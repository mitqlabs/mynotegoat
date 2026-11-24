"use client";

/**
 * Encounter → "Questionnaire received" banner above the SOAP macros. Shows a
 * patient's submitted questionnaires that haven't been reviewed yet, on an
 * open (unsigned) note. Insert puts the answers into Objective through the
 * same path as clicking each macro; Not now hides it for this visit only.
 */
import { useState } from "react";
import { useFormRequests } from "@/hooks/use-form-requests";
import type { FormRequestRow } from "@/lib/patient-forms-client";

export function QuestionnaireInsertBanner({
  patientId,
  signed,
  focusId,
  onInsert,
}: {
  patientId: string;
  signed: boolean;
  /** Came from the patient file's "Insert into Objective" for this one. */
  focusId?: string;
  onInsert: (row: FormRequestRow) => Promise<void> | void;
}) {
  const { rows, available } = useFormRequests({ patientId }, Boolean(patientId));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  if (!available || signed) return null;
  const pending = rows
    .filter((r) => r.status === "submitted" && r.review_status === "new" && !hidden.has(r.id))
    .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
  if (!pending.length) return null;
  return (
    <div className="mb-3 space-y-2" data-testid="questionnaire-insert-banner">
      {pending.map((r) => (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${r.id === focusId ? "border-emerald-500 bg-emerald-50" : "border-emerald-300 bg-emerald-50/60"}`}
          key={r.id}
        >
          <span>
            📋 <strong>Questionnaire received</strong> — {r.form_name}
            {r.submitted_at ? ` (${new Date(r.submitted_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })})` : ""}
          </span>
          <span className="flex gap-2">
            <button
              className="btn btn-primary btn-sm disabled:opacity-50"
              disabled={busy === r.id}
              onClick={async () => {
                setBusy(r.id);
                try {
                  await onInsert(r);
                } finally {
                  setBusy("");
                }
              }}
              type="button"
            >
              {busy === r.id ? "Inserting…" : "Insert into Objective"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setHidden((s) => new Set(s).add(r.id))}
              title="Hide for now. Review or dismiss it from the patient file."
              type="button"
            >
              Not now
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

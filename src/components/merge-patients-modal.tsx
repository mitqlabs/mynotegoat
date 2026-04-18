"use client";

/**
 * Merge Patients modal — used by the Settings → Diagnostics duplicate
 * scanner when the user confirms a group really IS a duplicate.
 *
 * UX:
 *   1. Pick which patient is the "winner" (the one whose ID survives).
 *      Radio buttons across the top.
 *   2. Field-by-field comparison table. For each field that differs
 *      between any two patients, the user picks the value to keep.
 *      Auto-resolved fields (one side blank, other has value) just show
 *      the chosen value with a note.
 *   3. "Merge" button — applies via mergePatients() helper which writes
 *      the merged record to the winner, soft-deletes every loser, and
 *      reassigns every related entity (encounters, appointments, billing,
 *      diagnoses, follow-up overrides, file folders) so nothing's
 *      orphaned.
 *
 * For groups with 3+ patients this merges them all into the winner in a
 * single pass — every loser's data flows into the winner.
 */

import { useMemo, useState } from "react";
import {
  patients as patientStore,
  type PatientMatrixField,
  type PatientRecord,
} from "@/lib/mock-data";
import { autoMergeRecord, mergePatients } from "@/lib/patient-merge";

type PatientSnap = {
  id: string;
  fullName: string;
  dob: string;
  dateOfLoss: string;
  caseStatus: string;
};

interface MergePatientsModalProps {
  group: PatientSnap[];
  onClose: () => void;
  onMerged?: (winnerId: string, loserIds: string[]) => void;
}

/** Fields the user picks per-row in the merge table. Anything outside
 *  this list is auto-merged by autoMergeRecord (arrays unioned, etc.). */
type ScalarField = keyof Pick<
  PatientRecord,
  | "fullName"
  | "dob"
  | "sex"
  | "maritalStatus"
  | "phone"
  | "email"
  | "address"
  | "attorney"
  | "caseStatus"
  | "dateOfLoss"
  | "priority"
>;

const SCALAR_FIELDS: { key: ScalarField; label: string }[] = [
  { key: "fullName", label: "Full Name" },
  { key: "dob", label: "Date of Birth" },
  { key: "sex", label: "Sex" },
  { key: "maritalStatus", label: "Marital Status" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "attorney", label: "Attorney" },
  { key: "caseStatus", label: "Case Status" },
  { key: "dateOfLoss", label: "Date of Injury" },
  { key: "priority", label: "Priority" },
];

/** Matrix fields that show in the merge UI's "Notes & Additional Details"
 *  section. We list them in the same order they appear in the Additional
 *  Details panel on the patient case file so the merge UI matches what
 *  the user already knows. Auto-tracked imaging dates (xraySent,
 *  mriDone, etc.) are intentionally NOT in this list because they're
 *  auto-merged via the referral arrays on the parent record. */
const MATRIX_FIELDS: { key: PatientMatrixField; label: string; multiline?: boolean }[] = [
  { key: "notes", label: "Case Notes", multiline: true },
  { key: "review", label: "Review", multiline: true },
  { key: "contact", label: "Contact" },
  { key: "initialExam", label: "Initial Exam" },
  { key: "lien", label: "Lien / LOP" },
  { key: "priorCare", label: "Prior Care" },
  { key: "reExam1", label: "Re-Exam 1" },
  { key: "reExam2", label: "Re-Exam 2" },
  { key: "reExam3", label: "Re-Exam 3" },
  { key: "discharge", label: "Discharge" },
  { key: "rbSent", label: "R&B Sent" },
  { key: "billed", label: "$ Billed" },
  { key: "paidDate", label: "Paid Date" },
  { key: "paidAmount", label: "$ Paid" },
  { key: "billPercent", label: "Bill %" },
  { key: "initialToDischarge", label: "Days Initial → Discharge" },
  { key: "dischargeToRb", label: "Days Discharge → R&B" },
  { key: "rbToPaid", label: "Days R&B → Paid" },
  { key: "xrayFindings", label: "X-Ray Findings", multiline: true },
  { key: "mriCtFindings", label: "MRI / CT Findings", multiline: true },
  { key: "specialistRecommendations", label: "Specialist Recommendations", multiline: true },
];

/** Render any string as US format if it looks like a date, else as-is. */
function asDisplay(value: unknown): string {
  if (value === undefined || value === null) return "—";
  const s = String(value).trim();
  if (!s) return "—";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[2].padStart(2, "0")}/${iso[3].padStart(2, "0")}/${iso[1]}`;
  }
  return s;
}

export function MergePatientsModal({
  group,
  onClose,
  onMerged,
}: MergePatientsModalProps) {
  // Resolve full PatientRecord objects from the in-memory store.
  const patients = useMemo<PatientRecord[]>(() => {
    const lookup = new Map(patientStore.map((p) => [p.id, p]));
    const out: PatientRecord[] = [];
    for (const snap of group) {
      const found = lookup.get(snap.id);
      if (found && !found.deleted) out.push(found);
    }
    return out;
  }, [group]);

  const [winnerId, setWinnerId] = useState<string>(
    patients[0]?.id ?? "",
  );
  // Per-field choice: which patient's value wins on conflict. Defaults to
  // the winner's value (or the first non-blank one we find).
  const [fieldChoice, setFieldChoice] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [resultError, setResultError] = useState<string>("");

  const winner = patients.find((p) => p.id === winnerId);
  const losers = patients.filter((p) => p.id !== winnerId);

  if (patients.length < 2) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.5)] px-4 py-8">
        <section className="w-full max-w-md rounded-2xl border border-[var(--line-soft)] bg-white p-5">
          <h3 className="text-lg font-semibold">Cannot merge</h3>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Need at least two active patients to merge. Re-scan and try again.
          </p>
          <div className="mt-4 flex justify-end">
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
        </section>
      </div>
    );
  }

  const choiceFor = (field: ScalarField): string => {
    const explicit = fieldChoice[field];
    if (explicit) return explicit;
    // Default: pick winner's value if non-blank, otherwise first loser
    // that has a value.
    const winnerVal = winner ? (winner[field] ?? "") : "";
    if (typeof winnerVal === "string" && winnerVal.trim()) return winnerId;
    if (winnerVal && typeof winnerVal !== "string") return winnerId;
    for (const loser of losers) {
      const v = loser[field];
      if (typeof v === "string" && v.trim()) return loser.id;
      if (v && typeof v !== "string") return loser.id;
    }
    return winnerId;
  };

  /** Same as choiceFor but for matrix sub-fields (Notes, Additional Details). */
  const matrixChoiceFor = (field: PatientMatrixField): string => {
    const explicit = fieldChoice[`matrix.${field}`];
    if (explicit) return explicit;
    const winnerVal = winner?.matrix?.[field] ?? "";
    if (winnerVal.trim()) return winnerId;
    for (const loser of losers) {
      const v = loser.matrix?.[field] ?? "";
      if (v.trim()) return loser.id;
    }
    return winnerId;
  };

  // Build the final merged record by walking every loser into the winner.
  // We use autoMergeRecord for arrays/matrix, then overlay the user's
  // per-field scalar choices on top. Always returns a fresh object — never
  // mutates `winner` or any other input record (that's why there's a spread
  // before the per-field overlay).
  const buildMergedRecord = (): PatientRecord | null => {
    if (!winner) return null;
    let base: PatientRecord = winner;
    for (const loser of losers) {
      base = autoMergeRecord(base, loser);
    }
    // Clone before applying scalar overrides so we don't mutate the
    // upstream PatientRecord that React might still be referencing.
    const overlay: Record<string, unknown> = { ...base };
    for (const { key } of SCALAR_FIELDS) {
      const sourceId = choiceFor(key);
      const source = patients.find((p) => p.id === sourceId);
      if (!source) continue;
      const value = source[key];
      // Skip undefined so we don't accidentally clobber a non-blank value
      // with undefined. Empty strings ARE allowed (user chose blank).
      if (value === undefined) continue;
      overlay[key] = value;
    }
    // Apply matrix overrides on top of the auto-merged matrix. autoMerge
    // already unioned the matrices (winner wins on conflict), but the
    // user may have explicitly chosen a different value per-field — that
    // choice goes here.
    const matrixOverlay: Partial<Record<PatientMatrixField, string>> = {
      ...(base.matrix ?? {}),
    };
    for (const { key } of MATRIX_FIELDS) {
      const sourceId = matrixChoiceFor(key);
      const source = patients.find((p) => p.id === sourceId);
      if (!source) continue;
      const value = source.matrix?.[key];
      if (value === undefined) continue;
      matrixOverlay[key] = value;
    }
    overlay.matrix = matrixOverlay;
    return overlay as unknown as PatientRecord;
  };

  const startMerge = () => {
    setResultError("");
    setResultMessage("");
    setConfirmOpen(true);
  };

  const performMerge = async () => {
    setApplying(true);
    setResultError("");
    setResultMessage("");
    const merged = buildMergedRecord();
    if (!merged) {
      setApplying(false);
      setConfirmOpen(false);
      setResultError("Could not build merged record.");
      return;
    }
    let totalReassigned = {
      encounters: 0,
      appointments: 0,
      billing: false,
      diagnoses: false,
      overrides: false,
      fileFolders: 0,
    };
    const successfulLosers: string[] = [];
    let firstError: string | null = null;

    for (const loser of losers) {
      const result = mergePatients(winnerId, loser.id, merged);
      if (!result.ok) {
        firstError = firstError ?? result.reason ?? "Unknown merge error";
        continue;
      }
      successfulLosers.push(loser.id);
      totalReassigned = {
        encounters: totalReassigned.encounters + result.reassigned.encounters,
        appointments: totalReassigned.appointments + result.reassigned.appointments,
        billing: totalReassigned.billing || result.reassigned.billing,
        diagnoses: totalReassigned.diagnoses || result.reassigned.diagnoses,
        overrides: totalReassigned.overrides || result.reassigned.overrides,
        fileFolders: totalReassigned.fileFolders + result.reassigned.fileFolders,
      };
    }

    setApplying(false);
    setConfirmOpen(false);

    if (successfulLosers.length === 0) {
      setResultError(firstError ?? "No patients were merged.");
      return;
    }

    const parts: string[] = [];
    parts.push(
      `merged ${successfulLosers.length} record${successfulLosers.length === 1 ? "" : "s"} into ${merged.fullName}`,
    );
    if (totalReassigned.encounters)
      parts.push(`${totalReassigned.encounters} encounter${totalReassigned.encounters === 1 ? "" : "s"} reassigned`);
    if (totalReassigned.appointments)
      parts.push(`${totalReassigned.appointments} appointment${totalReassigned.appointments === 1 ? "" : "s"} reassigned`);
    if (totalReassigned.billing) parts.push("billing merged");
    if (totalReassigned.diagnoses) parts.push("diagnoses merged");
    if (totalReassigned.overrides) parts.push("follow-up overrides moved");
    if (totalReassigned.fileFolders)
      parts.push(`${totalReassigned.fileFolders} file folder${totalReassigned.fileFolders === 1 ? "" : "s"} reassigned`);

    setResultMessage(`✓ ${parts.join(", ")}.`);
    onMerged?.(winnerId, successfulLosers);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.5)] px-4 py-8">
      <section className="w-full max-w-4xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Merge Duplicate Patients</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Pick which record to keep, then choose the value to use for
              each conflicting field. The kept record absorbs every other
              record&apos;s encounters, appointments, billing, diagnoses,
              and file folders. The other record(s) are soft-deleted (you
              can restore them from Patients → Trash).
            </p>
          </div>
          <button
            className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        {/* Winner picker */}
        <div className="mb-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Keep this record (winner)
          </div>
          <div className="flex flex-wrap gap-2">
            {patients.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  winnerId === p.id
                    ? "border-[var(--brand-primary)] bg-white"
                    : "border-[var(--line-soft)] bg-white/60"
                }`}
              >
                <input
                  checked={winnerId === p.id}
                  name="merge-winner"
                  onChange={() => {
                    setWinnerId(p.id);
                    setFieldChoice({}); // reset choices on winner change
                  }}
                  type="radio"
                />
                <div className="text-left">
                  <div className="font-semibold">{p.fullName}</div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">
                    DOB {asDisplay(p.dob)} · DOI {asDisplay(p.dateOfLoss)} · ID {p.id}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Field-by-field comparison */}
        <div className="overflow-x-auto rounded-xl border border-[var(--line-soft)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Field
                </th>
                {patients.map((p) => (
                  <th
                    key={p.id}
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    {p.fullName}
                    {winnerId === p.id ? (
                      <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                        WINNER
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCALAR_FIELDS.map(({ key, label }) => {
                const values = patients.map((p) => ({
                  id: p.id,
                  value: p[key] ?? "",
                }));
                const distinctValues = new Set(values.map((v) => String(v.value).trim()));
                const allSame = distinctValues.size <= 1;
                const chosen = choiceFor(key);
                return (
                  <tr
                    key={key}
                    className="border-t border-[var(--line-soft)]"
                  >
                    <td className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                      {label}
                      {!allSame ? (
                        <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                          DIFFERS
                        </span>
                      ) : null}
                    </td>
                    {values.map(({ id, value }) => {
                      const isChosen = chosen === id;
                      const display = asDisplay(value);
                      return (
                        <td
                          key={`${key}-${id}`}
                          className={`px-3 py-2 ${
                            isChosen
                              ? "bg-emerald-50 font-semibold text-emerald-900"
                              : "text-[var(--text-muted)]"
                          }`}
                        >
                          {allSame ? (
                            <span>{display}</span>
                          ) : (
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                checked={isChosen}
                                name={`merge-field-${key}`}
                                onChange={() =>
                                  setFieldChoice((current) => ({
                                    ...current,
                                    [key]: id,
                                  }))
                                }
                                type="radio"
                              />
                              <span>{display}</span>
                            </label>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Matrix / Notes / Additional Details — only render rows where
            at least one record actually has a value, to keep the table
            scannable. Multiline fields (Notes, Findings, etc.) get a
            collapsible "show full value" affordance via wrap-in-place. */}
        {(() => {
          const matrixRows = MATRIX_FIELDS.filter(({ key }) =>
            patients.some((p) => (p.matrix?.[key] ?? "").trim() !== ""),
          );
          if (matrixRows.length === 0) return null;
          return (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
                Notes &amp; Additional Details
              </h4>
              <div className="overflow-x-auto rounded-xl border border-[var(--line-soft)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-soft)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Field
                      </th>
                      {patients.map((p) => (
                        <th
                          key={p.id}
                          className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                        >
                          {p.fullName}
                          {winnerId === p.id ? (
                            <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                              WINNER
                            </span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map(({ key, label, multiline }) => {
                      const values = patients.map((p) => ({
                        id: p.id,
                        value: p.matrix?.[key] ?? "",
                      }));
                      const distinctValues = new Set(
                        values.map((v) => v.value.trim()),
                      );
                      const allSame = distinctValues.size <= 1;
                      const chosen = matrixChoiceFor(key);
                      return (
                        <tr
                          key={`matrix-${key}`}
                          className="border-t border-[var(--line-soft)] align-top"
                        >
                          <td className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                            {label}
                            {!allSame ? (
                              <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                                DIFFERS
                              </span>
                            ) : null}
                          </td>
                          {values.map(({ id, value }) => {
                            const isChosen = chosen === id;
                            const display = asDisplay(value);
                            return (
                              <td
                                key={`matrix-${key}-${id}`}
                                className={`px-3 py-2 ${
                                  isChosen
                                    ? "bg-emerald-50 font-semibold text-emerald-900"
                                    : "text-[var(--text-muted)]"
                                }`}
                              >
                                {allSame ? (
                                  <span
                                    className={
                                      multiline ? "block whitespace-pre-wrap break-words" : ""
                                    }
                                  >
                                    {display}
                                  </span>
                                ) : (
                                  <label className="flex cursor-pointer items-start gap-1.5">
                                    <input
                                      checked={isChosen}
                                      className="mt-1 shrink-0"
                                      name={`merge-matrix-${key}`}
                                      onChange={() =>
                                        setFieldChoice((current) => ({
                                          ...current,
                                          [`matrix.${key}`]: id,
                                        }))
                                      }
                                      type="radio"
                                    />
                                    <span
                                      className={
                                        multiline ? "block whitespace-pre-wrap break-words" : ""
                                      }
                                    >
                                      {display}
                                    </span>
                                  </label>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
          Lists (X-Ray, MRI, specialist referrals, alerts, related cases)
          are auto-combined: the kept record gets every entry from every
          record, deduped where possible.
        </p>

        {resultMessage ? (
          <p className="mt-3 text-sm font-semibold text-emerald-600">
            {resultMessage}
          </p>
        ) : null}
        {resultError ? (
          <p className="mt-3 text-sm font-semibold text-[#b43b34]">{resultError}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          {!resultMessage ? (
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90 disabled:opacity-50"
              disabled={applying}
              onClick={startMerge}
              type="button"
            >
              {applying ? "Merging…" : "Merge Patients"}
            </button>
          ) : null}
        </div>

        {/* Confirmation overlay */}
        {confirmOpen ? (
          <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-2xl bg-[rgba(15,46,70,0.55)] p-4">
            <div className="w-full max-w-md rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
              <h4 className="text-lg font-semibold">Confirm merge</h4>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                You&apos;re about to merge{" "}
                <span className="font-semibold text-[var(--text-primary)]">
                  {losers.length} record{losers.length === 1 ? "" : "s"}
                </span>{" "}
                into{" "}
                <span className="font-semibold text-[var(--text-primary)]">
                  {winner?.fullName}
                </span>
                . The merged-into record keeps all encounters, appointments,
                billing, diagnoses, and file folders from every record. The
                other record{losers.length === 1 ? "" : "s"} will be
                soft-deleted (recoverable from the Trash tab).
              </p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                This action cannot be auto-undone — restoring a soft-deleted
                record won&apos;t un-reassign its encounters/appointments/etc.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold"
                  disabled={applying}
                  onClick={() => setConfirmOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  disabled={applying}
                  onClick={() => void performMerge()}
                  type="button"
                >
                  {applying ? "Merging…" : "Yes, merge"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

"use client";

/**
 * G.O.A.T. on the patient page: spots encounters that share a date, shows them
 * side by side (which one holds the real data), and proposes a merge behind
 * ONE confirm card. Never merges on its own. Every merge first saves a
 * restorable backup to the cloud; "Restore" puts things back.
 */
import { useEffect, useMemo, useState } from "react";
import { logActivity } from "@/lib/activity-log";
import type { CashPaymentEntry } from "@/lib/mock-data";
import type { EncounterNoteRecord } from "@/lib/encounter-notes";
import { findDuplicateEncounters, plainText, planMerge, type DuplicateGroup, type MergeMode } from "@/lib/encounter-dupes";
import { loadMergeBackups, markBackupRestored, saveMergeBackupOrThrow, type EncounterMergeBackup } from "@/lib/encounter-merge-backups";

type Props = {
  patientId: string;
  patientName: string;
  encounters: EncounterNoteRecord[];
  cashPayments: CashPaymentEntry[];
  locked?: boolean;
  putEncounterRecords: (records: EncounterNoteRecord[]) => void;
  deleteEncounter: (id: string) => void;
  updatePatientPayments: (patientId: string, updater: (current: CashPaymentEntry[]) => CashPaymentEntry[]) => void;
};

const SECTIONS = ["subjective", "objective", "assessment", "plan"] as const;
const btn = "rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50";

export function GoatDuplicateEncounters({ patientId, patientName, encounters, cashPayments, locked, putEncounterRecords, deleteEncounter, updatePatientPayments }: Props) {
  const groups = useMemo(() => findDuplicateEncounters(encounters, patientId), [encounters, patientId]);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [mode, setMode] = useState<MergeMode>("union");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [backups, setBackups] = useState<EncounterMergeBackup[]>([]);

  useEffect(() => {
    let alive = true;
    void loadMergeBackups().then((all) => {
      if (alive) setBackups(all.filter((b) => b.patientId === patientId && !b.restoredAt));
    });
    return () => {
      alive = false;
    };
  }, [patientId]);

  const group = groups.find((g) => g.date === openDate) ?? null;
  if (!groups.length && !backups.length && !message) return null;

  const merge = async (g: DuplicateGroup) => {
    if (locked) {
      setMessage("This case is closed. Unlock the Appointments panel to merge.");
      return;
    }
    const plan = planMerge(g, mode);
    const removedIds = new Set(plan.remove.map((r) => r.id));
    const moved = cashPayments.filter((p) => p.encounterId && removedIds.has(p.encounterId)).map((p) => ({ paymentId: p.id, fromEncounterId: p.encounterId! }));
    const backup: EncounterMergeBackup = {
      id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      by: "G.O.A.T.",
      patientId,
      patientName,
      date: g.date,
      mode,
      keptBefore: plan.keep,
      removed: plan.remove,
      movedCashPayments: moved,
    };
    setBusy(true);
    setMessage("");
    try {
      await saveMergeBackupOrThrow(backup);
    } catch (e) {
      setBusy(false);
      setMessage((e as Error).message);
      return;
    }
    if (mode === "union") putEncounterRecords([plan.merged]);
    if (moved.length) {
      const ids = new Set(moved.map((m) => m.paymentId));
      updatePatientPayments(patientId, (cur) => cur.map((p) => (ids.has(p.id) ? { ...p, encounterId: plan.keep.id } : p)));
    }
    plan.remove.forEach((r) => deleteEncounter(r.id));
    logActivity({ category: "notes", action: "note.merged", summary: `G.O.A.T. merged ${g.encounters.length} encounters on ${g.date} (${mode === "union" ? "combined" : "kept the fuller one"})`, patientId, patientName, details: { backupId: backup.id, kept: plan.keep.id, removed: [...removedIds] } });
    setBackups((b) => [backup, ...b]);
    setOpenDate(null);
    setBusy(false);
    setMessage(`Merged the ${g.date} encounters into one. A backup was saved, so you can restore it below.`);
  };

  const restore = async (b: EncounterMergeBackup) => {
    setBusy(true);
    setMessage("");
    try {
      putEncounterRecords([b.keptBefore, ...b.removed]);
      if (b.movedCashPayments.length) {
        const back = new Map(b.movedCashPayments.map((m) => [m.paymentId, m.fromEncounterId]));
        updatePatientPayments(patientId, (cur) => cur.map((p) => (back.has(p.id) ? { ...p, encounterId: back.get(p.id) } : p)));
      }
      await markBackupRestored(b.id);
      logActivity({ category: "notes", action: "note.merge-restored", summary: `Restored the ${b.date} encounters from a G.O.A.T. merge backup`, patientId, patientName, details: { backupId: b.id } });
      setBackups((list) => list.filter((x) => x.id !== b.id));
      setMessage(`Restored the ${b.date} encounters as they were before the merge.`);
    } catch (e) {
      setMessage(`Restore saved the encounters, but marking the backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm" data-goat-dupes>
      {groups.map((g) => (
        <div className="flex flex-wrap items-center justify-between gap-2" key={g.date}>
          <p>
            <span className="font-semibold">🐐 G.O.A.T.:</span> {g.encounters.length} encounters on {g.date}. They may be duplicates.
          </p>
          <button className={`${btn} border-amber-400 bg-white hover:bg-amber-100`} onClick={() => setOpenDate(openDate === g.date ? null : g.date)} type="button">
            {openDate === g.date ? "Hide" : "Review"}
          </button>
        </div>
      ))}

      {group && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(group.encounters.length, 3)}, minmax(0, 1fr))` }}>
            {group.encounters.map((e, i) => {
              const s = group.scores[i];
              return (
                <div className={`min-w-0 rounded-lg border bg-white p-2 ${i === 0 ? "border-emerald-500" : "border-[var(--line-soft)]"}`} key={e.id}>
                  <div className="flex items-start justify-between gap-1">
                    <p className="truncate text-xs font-semibold">{e.appointmentType || "Encounter"}</p>
                    {i === 0 ? <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">Real data</span> : <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] text-[var(--text-muted)]">{s.score ? "Less data" : "Empty"}</span>}
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {e.provider || "No provider"}{e.signed ? " · Signed" : " · Open"}
                  </p>
                  <p className="mt-1 text-[11px]">
                    {s.sections}/4 SOAP · {s.charges} charge{s.charges === 1 ? "" : "s"} · {s.diagnoses} dx
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {SECTIONS.map((sec) => {
                      const t = plainText(e.soap?.[sec] ?? "");
                      return (
                        <p className="truncate text-[11px]" key={sec} title={t}>
                          <span className="font-semibold uppercase">{sec[0]}:</span> {t || <span className="text-[var(--text-muted)]">—</span>}
                        </p>
                      );
                    })}
                  </div>
                  {e.charges.length > 0 && <p className="mt-1 truncate text-[11px]" title={e.charges.map((c) => c.procedureCode || c.name).join(", ")}>Charges: {e.charges.map((c) => c.procedureCode || c.name).join(", ")}</p>}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-[var(--line-soft)] bg-white p-2" data-goat-merge-confirm>
            <p className="text-xs font-semibold">Merge these into one?</p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input checked={mode === "union"} name={`merge-${group.date}`} onChange={() => setMode("union")} type="radio" /> Combine (keep the fuller one, add anything only the other has)
              </label>
              <label className="flex items-center gap-1">
                <input checked={mode === "keepFuller"} name={`merge-${group.date}`} onChange={() => setMode("keepFuller")} type="radio" /> Keep the fuller one only
              </label>
            </div>
            {(() => {
              const plan = planMerge(group, mode);
              return (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Keeps the {plan.keep.appointmentType || "encounter"} ({plan.keep.provider || "no provider"}) and removes {plan.remove.length}.{" "}
                  {mode === "union" ? (plan.changes.length ? `Adds: ${plan.changes.join(", ")}.` : "Nothing extra to add.") : plan.remove.some((r) => group.scores[group.encounters.indexOf(r)].score > 0) ? "The removed one's data is not copied over." : ""}{" "}
                  A backup is saved first so you can restore it.
                </p>
              );
            })()}
            <div className="mt-2 flex gap-1.5">
              <button className={`${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`} disabled={busy} onClick={() => void merge(group)} type="button">
                {busy ? "Saving backup…" : "Confirm merge"}
              </button>
              <button className={`${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`} disabled={busy} onClick={() => setOpenDate(null)} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {backups.map((b) => (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" key={b.id}>
          <span className="text-[var(--text-muted)]">
            Merged {b.date} encounters on {new Date(b.at).toLocaleDateString("en-US")} ({b.removed.length} removed, backed up).
          </span>
          <button className={`${btn} border-[var(--line-soft)] bg-white hover:bg-[var(--bg-soft)]`} disabled={busy} onClick={() => void restore(b)} type="button">
            Restore
          </button>
        </div>
      ))}
      {message && <p className="mt-2 text-xs font-semibold text-[var(--brand-primary)]">{message}</p>}
    </div>
  );
}

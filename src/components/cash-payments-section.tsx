"use client";

import { useMemo, useState } from "react";
import { useCashPayments } from "@/hooks/use-cash-payments";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import {
  cashPaymentTypeOptions,
  createCashPayment,
  formatCashAmount,
  sumCashDiscounts,
  sumCashPayments,
} from "@/lib/cash-payments";
import type { CashPaymentEntry } from "@/lib/mock-data";
import { UsDateInput } from "@/components/us-date-input";

type Props = {
  patientId: string;
};

function getTodayUsDate(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const y = String(now.getFullYear());
  return `${m}/${d}/${y}`;
}

/** Parse a free-text decimal like "150" / "150.00" / "1,250" into a
 *  non-negative number. Empty or unparseable input returns 0. */
function parseMoney(value: string): number {
  if (!value.trim()) return 0;
  const cleaned = value.replace(/,/g, "").trim();
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

// US-date sort: descending (most recent first) for the auto-encounter list.
function compareUsDateDesc(a: string, b: string): number {
  const parse = (d: string) => {
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return 0;
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
  };
  return parse(b) - parse(a);
}

export function CashPaymentsSection({ patientId }: Props) {
  const { paymentsByPatient, updatePatientPayments } = useCashPayments();
  const { encounters } = useEncounterNotes();
  const entries = useMemo(
    () => paymentsByPatient[patientId] ?? [],
    [paymentsByPatient, patientId],
  );

  // Manual-add form draft — only for off-encounter payments. Most rows
  // come from the auto-encounter list below; the office uses this form
  // when applying a credit on account or a payment not tied to a visit.
  const [draft, setDraft] = useState<{
    date: string;
    amount: string;
    discount: string;
    paymentType: CashPaymentEntry["paymentType"];
    note: string;
  }>(() => ({
    date: getTodayUsDate(),
    amount: "",
    discount: "",
    paymentType: "Cash",
    note: "",
  }));
  const [error, setError] = useState("");

  // Per-row in-progress edit buffer for the auto-encounter list, so
  // typing into Amount / Discount doesn't fire a save on every keystroke
  // — we commit on blur (or Enter). Keyed by the encounter id.
  type RowDraft = { amount: string; discount: string; note: string };
  const [rowDrafts, setRowDrafts] = useState<Record<string, RowDraft>>({});

  // Build a row per encounter for this patient — date + owed +
  // optionally a linked CashPaymentEntry. Sorted most recent first.
  const encounterRows = useMemo(() => {
    const entryByEncounter = new Map<string, CashPaymentEntry>();
    for (const entry of entries) {
      if (entry.encounterId) entryByEncounter.set(entry.encounterId, entry);
    }
    return encounters
      .filter((enc) => enc.patientId === patientId)
      .map((enc) => {
        const owed = enc.charges.reduce(
          (sum, c) => sum + (Number(c.unitPrice) || 0) * (Number(c.units) || 0),
          0,
        );
        return {
          encounterId: enc.id,
          date: enc.encounterDate,
          owed,
          entry: entryByEncounter.get(enc.id) ?? null,
        };
      })
      .sort((a, b) => compareUsDateDesc(a.date, b.date));
  }, [encounters, entries, patientId]);

  // Manual entries — payments NOT linked to any encounter.
  const manualEntries = useMemo(
    () =>
      entries
        .filter((e) => !e.encounterId)
        .slice()
        .sort((a, b) => compareUsDateDesc(a.date, b.date)),
    [entries],
  );

  const totalAmount = sumCashPayments(entries);
  const totalDiscount = sumCashDiscounts(entries);
  // Sum owed across encounters that have charges (every encounter row
  // counts exactly once — no double-counting if two payment entries
  // were ever linked to the same encounter).
  const totalOwed = encounterRows.reduce((sum, row) => sum + row.owed, 0);

  /** Get the current display value for an editable cell on an
   *  encounter row — drafted value if the user is mid-edit, else
   *  whatever's stored. */
  const cellValue = (encounterId: string, field: keyof RowDraft, stored: string) => {
    const draft = rowDrafts[encounterId];
    if (draft && draft[field] !== undefined) return draft[field];
    return stored;
  };

  /** Update the per-row draft buffer as the user types. */
  const setCell = (encounterId: string, field: keyof RowDraft, value: string) => {
    setRowDrafts((current) => ({
      ...current,
      [encounterId]: {
        ...(current[encounterId] ?? { amount: "", discount: "", note: "" }),
        [field]: value,
      },
    }));
  };

  /** Commit the draft to storage. Creates the entry if it's the first
   *  edit on this encounter; updates the entry otherwise. */
  const commitRow = (encounterId: string, encounterDate: string) => {
    const draft = rowDrafts[encounterId];
    if (!draft) return;
    const existing = entries.find((e) => e.encounterId === encounterId) ?? null;
    const nextAmount = draft.amount !== undefined ? parseMoney(draft.amount) : existing?.amount ?? 0;
    const nextDiscountRaw = draft.discount !== undefined ? parseMoney(draft.discount) : existing?.discount ?? 0;
    const nextNote = draft.note !== undefined ? draft.note : existing?.note ?? "";

    if (existing) {
      // Update in place. If amount=0 and discount=0 and no note, we
      // intentionally leave the row stored (so the office can record
      // "paid $0 today, defer to next visit"). Use Delete to remove.
      updatePatientPayments(patientId, (current) =>
        current.map((e) =>
          e.id === existing.id
            ? {
                ...e,
                amount: nextAmount,
                discount: nextDiscountRaw > 0 ? nextDiscountRaw : undefined,
                note: nextNote.trim() || undefined,
              }
            : e,
        ),
      );
    } else {
      // Brand-new: only create if at least one field is non-empty so
      // an accidental tab-through doesn't litter rows. Amount > 0 OR
      // discount > 0 OR note has content qualifies.
      if (nextAmount <= 0 && nextDiscountRaw <= 0 && !nextNote.trim()) {
        // Nothing to save — clear the buffer.
        setRowDrafts((current) => {
          const next = { ...current };
          delete next[encounterId];
          return next;
        });
        return;
      }
      const entry = createCashPayment({
        date: encounterDate,
        amount: nextAmount,
        discount: nextDiscountRaw,
        encounterId,
        paymentType: "Cash",
        note: nextNote || undefined,
      });
      updatePatientPayments(patientId, (current) => [entry, ...current]);
    }
    // Clear the draft for this row once committed.
    setRowDrafts((current) => {
      const next = { ...current };
      delete next[encounterId];
      return next;
    });
  };

  const handleSetRowPaymentType = (encounterId: string, paymentType: CashPaymentEntry["paymentType"]) => {
    const existing = entries.find((e) => e.encounterId === encounterId);
    if (!existing) return; // payment type select is disabled until a row exists
    updatePatientPayments(patientId, (current) =>
      current.map((e) => (e.id === existing.id ? { ...e, paymentType } : e)),
    );
  };

  const handleAddManual = () => {
    setError("");
    const amountNum = parseMoney(draft.amount);
    if (amountNum <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (!draft.date.trim()) {
      setError("Enter a date.");
      return;
    }
    const discountNum = parseMoney(draft.discount);
    const entry = createCashPayment({
      date: draft.date,
      amount: amountNum,
      discount: discountNum,
      paymentType: draft.paymentType,
      note: draft.note,
    });
    updatePatientPayments(patientId, (current) => [entry, ...current]);
    setDraft({
      date: getTodayUsDate(),
      amount: "",
      discount: "",
      paymentType: "Cash",
      note: "",
    });
  };

  const handleDelete = (id: string) => {
    const ok = window.confirm("Delete this payment? This cannot be undone.");
    if (!ok) return;
    updatePatientPayments(patientId, (current) => current.filter((e) => e.id !== id));
  };

  return (
    <section className="rounded-2xl border border-[#bfd2e0] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-semibold">Cash Payments</h3>
        <div className="flex flex-wrap items-center gap-2">
          {totalOwed > 0 && (
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
              Owed: {formatCashAmount(totalOwed)}
            </span>
          )}
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
            Paid: {formatCashAmount(totalAmount)}
          </span>
          {totalDiscount > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
              Discounts: {formatCashAmount(totalDiscount)}
            </span>
          )}
          {totalOwed > 0 && (
            <span className="rounded-full bg-[var(--bg-soft)] px-3 py-1 text-sm font-semibold text-[var(--text-main)]">
              Balance: {formatCashAmount(Math.max(0, totalOwed - totalDiscount - totalAmount))}
            </span>
          )}
        </div>
      </div>

      {/* Per-encounter auto-rows. One row per encounter on this
          patient, regardless of whether a payment has been logged
          against it yet. Type Amount + Discount inline and tab/blur
          to save — the underlying CashPaymentEntry is created on
          first commit and updated on subsequent edits. Empty rows
          stay empty in storage. */}
      {encounterRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line-soft)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Visit Date</th>
                <th className="px-3 py-2 text-right">Owed</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Payment</th>
                <th className="px-3 py-2 text-left">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {encounterRows.map((row) => {
                const entry = row.entry;
                const storedAmount = entry?.amount ?? 0;
                const storedDiscount = entry?.discount ?? 0;
                const storedNote = entry?.note ?? "";
                const draftAmount = cellValue(row.encounterId, "amount", storedAmount > 0 ? String(storedAmount) : "");
                const draftDiscount = cellValue(row.encounterId, "discount", storedDiscount > 0 ? String(storedDiscount) : "");
                const draftNote = cellValue(row.encounterId, "note", storedNote);
                // Live balance shows the draft if user is mid-edit,
                // committed value otherwise.
                const liveAmount = parseMoney(draftAmount);
                const liveDiscount = parseMoney(draftDiscount);
                const balance = Math.max(0, row.owed - liveDiscount - liveAmount);

                return (
                  <tr className="border-t border-[var(--line-soft)]" key={row.encounterId}>
                    <td className="px-3 py-2 font-mono">{row.date}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {row.owed > 0 ? formatCashAmount(row.owed) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-20 rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-right text-sm"
                        inputMode="decimal"
                        onBlur={() => commitRow(row.encounterId, row.date)}
                        onChange={(e) => setCell(row.encounterId, "discount", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        }}
                        placeholder="0"
                        value={draftDiscount}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-24 rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-right text-sm font-semibold"
                        inputMode="decimal"
                        onBlur={() => commitRow(row.encounterId, row.date)}
                        onChange={(e) => setCell(row.encounterId, "amount", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        }}
                        placeholder="0.00"
                        value={draftAmount}
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        balance === 0 ? "text-emerald-700" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {row.owed > 0 ? formatCashAmount(balance) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-sm"
                        disabled={!entry}
                        onChange={(e) =>
                          handleSetRowPaymentType(
                            row.encounterId,
                            e.target.value as CashPaymentEntry["paymentType"],
                          )
                        }
                        value={entry?.paymentType ?? "Cash"}
                      >
                        {cashPaymentTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-sm"
                        onBlur={() => commitRow(row.encounterId, row.date)}
                        onChange={(e) => setCell(row.encounterId, "note", e.target.value)}
                        placeholder="Optional"
                        value={draftNote}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {entry && (
                        <button
                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                          onClick={() => handleDelete(entry.id)}
                          type="button"
                        >
                          Clear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[var(--bg-soft)]">
              <tr>
                <td className="px-3 py-2 text-right font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-bold">
                  {totalOwed > 0 ? formatCashAmount(totalOwed) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-[var(--text-muted)]">
                  {totalDiscount > 0 ? formatCashAmount(totalDiscount) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-bold">
                  {formatCashAmount(totalAmount)}
                </td>
                <td className="px-3 py-2 text-right font-bold">
                  {totalOwed > 0
                    ? formatCashAmount(Math.max(0, totalOwed - totalDiscount - totalAmount))
                    : "—"}
                </td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {encounterRows.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white px-3 py-4 text-center text-sm text-[var(--text-muted)]">
          No visits yet. Once you create an encounter with charges, it shows up here automatically.
        </p>
      )}

      {/* Manual add form — for payments NOT tied to a specific
          encounter (e.g. credit on account, deposit). */}
      <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Add Payment (not tied to a visit)
        </p>
        <div className="grid gap-2 md:grid-cols-[140px_120px_120px_160px_1fr_auto]">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Date</span>
            <UsDateInput
              className="w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
              onChange={(formatted) =>
                setDraft((current) => ({ ...current, date: formatted }))
              }
              value={draft.date}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Amount</span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
              inputMode="decimal"
              onChange={(event) =>
                setDraft((current) => ({ ...current, amount: event.target.value }))
              }
              placeholder="0.00"
              value={draft.amount}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Discount</span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
              inputMode="decimal"
              onChange={(event) =>
                setDraft((current) => ({ ...current, discount: event.target.value }))
              }
              placeholder="0.00"
              value={draft.discount}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Payment</span>
            <select
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  paymentType: event.target.value as CashPaymentEntry["paymentType"],
                }))
              }
              value={draft.paymentType}
            >
              {cashPaymentTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Note</span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, note: event.target.value }))
              }
              placeholder="e.g. Deposit"
              value={draft.note}
            />
          </label>
          <div className="flex items-end">
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97]"
              onClick={handleAddManual}
              type="button"
            >
              Add
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-[#b43b34]">{error}</p>}
      </div>

      {/* Manual entries log — anything added via the form above. */}
      {manualEntries.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-left">Payment</th>
                <th className="px-3 py-2 text-left">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {manualEntries.map((entry) => (
                <tr className="border-t border-[var(--line-soft)]" key={entry.id}>
                  <td className="px-3 py-2 font-mono">{entry.date}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatCashAmount(entry.amount)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-muted)]">
                    {entry.discount ? formatCashAmount(entry.discount) : "—"}
                  </td>
                  <td className="px-3 py-2">{entry.paymentType}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {entry.note ?? ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                      onClick={() => handleDelete(entry.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

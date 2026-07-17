"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCashPayments } from "@/hooks/use-cash-payments";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import {
  cashPaymentTypeOptions,
  createCashPayment,
  formatCashAmount,
  sumCashPayments,
} from "@/lib/cash-payments";
import { sumPackagePayments } from "@/lib/patient-packages";
import type { PatientPackage } from "@/lib/patient-packages";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { CashPaymentEntry } from "@/lib/mock-data";
import { loadOfficeSettings } from "@/lib/office-settings";

/** ISO YYYY-MM-DD → US MM/DD/YYYY (to match encounterDate format). */
function isoToUs(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

type Props = {
  patientId: string;
  patientName: string;
  // Passed down from the patient file (the parent's live package +
  // appointment state) rather than each cash sub-panel spinning up its
  // own hook instance — that caused package payments not to appear here
  // when a sibling panel added them (sync race between instances).
  packages: PatientPackage[];
  appointments: ScheduleAppointmentRecord[];
};

function getTodayUsDate(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const y = String(now.getFullYear());
  return `${m}/${d}/${y}`;
}

/** Escape user text for safe interpolation into the printable HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export function CashPaymentsSection({ patientId, patientName, packages, appointments }: Props) {
  const { paymentsByPatient, updatePatientPayments } = useCashPayments();
  const { encounters } = useEncounterNotes();
  const entries = useMemo(
    () => paymentsByPatient[patientId] ?? [],
    [paymentsByPatient, patientId],
  );

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
    // Appointment ids applied to a package → package name. A visit whose
    // appointment is applied to a package is "covered" — $0 owed, since
    // the patient pre-paid via the package.
    const coveredByAppt = new Map<string, string>();
    for (const pkg of packages) {
      for (const apptId of pkg.countedAppointmentIds ?? []) {
        coveredByAppt.set(apptId, pkg.snapshot.name);
      }
    }
    const patientAppts = appointments;
    return encounters
      .filter((enc) => enc.patientId === patientId)
      .map((enc) => {
        const rawOwed = enc.charges.reduce(
          (sum, c) => sum + (Number(c.unitPrice) || 0) * (Number(c.units) || 0),
          0,
        );
        // Resolve this encounter's appointment id — the durable link when
        // present, else match by date + type against the schedule.
        let apptId = enc.appointmentId;
        if (!apptId) {
          const match = patientAppts.find(
            (a) =>
              isoToUs(a.date) === enc.encounterDate &&
              a.appointmentType === enc.appointmentType,
          );
          apptId = match?.id;
        }
        const packageName = apptId ? coveredByAppt.get(apptId) ?? null : null;
        const covered = Boolean(packageName);
        return {
          encounterId: enc.id,
          date: enc.encounterDate,
          rawOwed,
          owed: covered ? 0 : rawOwed,
          covered,
          packageName,
          entry: entryByEncounter.get(enc.id) ?? null,
        };
      })
      .sort((a, b) => compareUsDateDesc(a.date, b.date));
  }, [encounters, entries, patientId, packages, appointments]);

  // Filter entries to exclude ORPHANS — entries whose encounterId
  // points to an encounter that no longer exists for this patient
  // (i.e., the encounter was deleted but the cash payment row wasn't
  // cascaded out). Orphans are invisible in the table (no matching
  // encounter row, but not manual either since they have an
  // encounterId), and prior to this fix they were silently inflating
  // the Discount / Paid totals at the top.
  const validEncounterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const enc of encounters) {
      if (enc.patientId === patientId) ids.add(enc.id);
    }
    return ids;
  }, [encounters, patientId]);
  const liveEntries = useMemo(
    () =>
      entries.filter(
        (e) => !e.encounterId || validEncounterIds.has(e.encounterId),
      ),
    [entries, validEncounterIds],
  );
  // Package partial payments show up here as read-only rows (note =
  // package name) and count toward the patient's Paid total.
  const packagePaid = useMemo(
    () => packages.reduce((sum, pkg) => sum + sumPackagePayments(pkg), 0),
    [packages],
  );
  const packagePaymentRows = useMemo(() => {
    const rows: { id: string; date: string; amount: number; note: string }[] = [];
    for (const pkg of packages) {
      for (const p of pkg.payments ?? []) {
        rows.push({
          id: p.id,
          date: p.date,
          amount: p.amount,
          note: `${pkg.snapshot.name} payment`,
        });
      }
    }
    return rows.sort((a, b) => compareUsDateDesc(a.date, b.date));
  }, [packages]);

  // Paid = per-visit payments + package payments.
  const totalAmount = sumCashPayments(liveEntries) + packagePaid;
  // Sum owed across encounters that have charges (covered visits are $0).
  const totalOwed = encounterRows.reduce((sum, row) => sum + row.owed, 0);
  // Discount is entered per visit as a PERCENT of that visit's owed; the
  // totals show the resulting dollar figure.
  const totalDiscount = encounterRows.reduce(
    (sum, row) => sum + row.owed * ((row.entry?.discount ?? 0) / 100),
    0,
  );

  /** Get the current display value for an editable cell on an
   *  encounter row — drafted value if the user is mid-edit, else
   *  whatever's stored. */
  const cellValue = (encounterId: string, field: keyof RowDraft, stored: string) => {
    const draft = rowDrafts[encounterId];
    if (draft && draft[field] !== undefined) return draft[field];
    return stored;
  };

  /** Update the per-row draft buffer as the user types. The draft is
   *  initialized from the stored entry's current values (or blanks
   *  when no entry exists yet) so editing one field doesn't quietly
   *  reset the others to 0 on commit. Previously the buffer started
   *  with every field as "", which meant typing in Paid would write
   *  "Discount = 0" alongside it and erase any previously-saved
   *  discount on the same row. */
  const setCell = (encounterId: string, field: keyof RowDraft, value: string) => {
    setRowDrafts((current) => {
      let base = current[encounterId];
      if (!base) {
        const stored = entries.find((e) => e.encounterId === encounterId);
        base = {
          amount: stored && stored.amount > 0 ? String(stored.amount) : "",
          discount: stored?.discount && stored.discount > 0 ? String(stored.discount) : "",
          note: stored?.note ?? "",
        };
      }
      return {
        ...current,
        [encounterId]: { ...base, [field]: value },
      };
    });
  };

  /** Commit the draft to storage. Creates the entry if it's the first
   *  edit on this encounter; updates the entry otherwise. The
   *  existing-entry lookup happens INSIDE the updater so two
   *  back-to-back commits (e.g., blurring Discount then immediately
   *  blurring Paid) don't both see "no existing" from stale closure
   *  state and create duplicate entries — which is what produced the
   *  inflated totals row (Owed × 1 but Discount/Paid × N entries). */
  const commitRow = (encounterId: string, encounterDate: string) => {
    const draft = rowDrafts[encounterId];
    if (!draft) return;
    const nextAmount = parseMoney(draft.amount);
    const nextDiscountRaw = parseMoney(draft.discount);
    const nextNote = draft.note;

    updatePatientPayments(patientId, (current) => {
      // Atomic check against the FRESH list inside the updater. If a
      // duplicate somehow already exists for this encounterId, the
      // .find returns the first one and we'll update it; subsequent
      // duplicates get cleaned up by the dedup effect below.
      const existing = current.find((e) => e.encounterId === encounterId);
      if (existing) {
        return current.map((e) =>
          e.id === existing.id
            ? {
                ...e,
                amount: nextAmount,
                discount: nextDiscountRaw > 0 ? nextDiscountRaw : undefined,
                note: nextNote.trim() || undefined,
              }
            : e,
        );
      }
      // No existing entry — only create one if at least one field is
      // non-empty so an accidental tab-through doesn't litter rows.
      if (nextAmount <= 0 && nextDiscountRaw <= 0 && !nextNote.trim()) {
        return current;
      }
      const entry = createCashPayment({
        date: encounterDate,
        amount: nextAmount,
        discount: nextDiscountRaw,
        encounterId,
        paymentType: "Cash",
        note: nextNote || undefined,
      });
      return [entry, ...current];
    });
    // Clear the draft for this row once committed.
    setRowDrafts((current) => {
      const next = { ...current };
      delete next[encounterId];
      return next;
    });
  };

  // Cleanup pass:
  //   1. Dedup entries that share an encounterId (race-condition
  //      leftovers from before the atomic-commit fix).
  //   2. Remove orphan entries — encounterId pointing to an encounter
  //      that no longer exists for this patient (the encounter got
  //      deleted, the cash payment row didn't).
  //
  // The dedup half runs once per patient (guarded by dedupedRef).
  // The orphan half only runs once we've SEEN at least one encounter
  // for this patient at some point — that guard prevents an empty
  // initial render (before encounters load from cloud) from nuking
  // valid linked entries. Once we've seen encounters, the orphan
  // pass is safe to re-run on every render; if there are no orphans
  // it's a cheap no-op.
  const dedupedRef = useRef<Set<string>>(new Set());
  const hasSeenEncountersForPatientRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (encounters.some((e) => e.patientId === patientId)) {
      hasSeenEncountersForPatientRef.current.add(patientId);
    }
  }, [encounters, patientId]);
  useEffect(() => {
    const removeIds: string[] = [];

    // Dedup (one-time per patient).
    if (!dedupedRef.current.has(patientId)) {
      const byEncounter = new Map<string, CashPaymentEntry[]>();
      for (const entry of entries) {
        if (!entry.encounterId) continue;
        const list = byEncounter.get(entry.encounterId) ?? [];
        list.push(entry);
        byEncounter.set(entry.encounterId, list);
      }
      for (const [, list] of byEncounter) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) => {
          if (b.amount !== a.amount) return b.amount - a.amount;
          const ad = a.discount ?? 0;
          const bd = b.discount ?? 0;
          if (bd !== ad) return bd - ad;
          return (b.createdAt || "").localeCompare(a.createdAt || "");
        });
        for (const loser of sorted.slice(1)) removeIds.push(loser.id);
      }
      dedupedRef.current.add(patientId);
    }

    // Orphan cleanup — only when we've confirmed encounters loaded
    // for this patient (so we don't delete valid entries during the
    // initial empty-encounters render).
    if (hasSeenEncountersForPatientRef.current.has(patientId)) {
      for (const entry of entries) {
        if (!entry.encounterId) continue;
        if (validEncounterIds.has(entry.encounterId)) continue;
        removeIds.push(entry.id);
      }
    }

    if (removeIds.length === 0) return;
    const toRemove = new Set(removeIds);
    updatePatientPayments(patientId, (current) =>
      current.filter((e) => !toRemove.has(e.id)),
    );
  }, [entries, patientId, updatePatientPayments, validEncounterIds]);

  const handleSetRowPaymentType = (encounterId: string, paymentType: CashPaymentEntry["paymentType"]) => {
    const existing = entries.find((e) => e.encounterId === encounterId);
    if (!existing) return; // payment type select is disabled until a row exists
    updatePatientPayments(patientId, (current) =>
      current.map((e) => (e.id === existing.id ? { ...e, paymentType } : e)),
    );
  };

  const handleDelete = (id: string) => {
    const ok = window.confirm("Delete this payment? This cannot be undone.");
    if (!ok) return;
    updatePatientPayments(patientId, (current) => current.filter((e) => e.id !== id));
  };

  // Build + print a patient-facing statement: visit charges, discounts,
  // payments, package balances, and the amount still due. Opens a clean
  // print window (no app chrome) so it can be handed to the patient.
  const handlePrintBill = () => {
    const office = loadOfficeSettings();
    const money = (n: number) => formatCashAmount(n);

    // Charge descriptions per encounter, for the "Services" column.
    const servicesByEncounter = new Map<string, string>();
    for (const enc of encounters) {
      if (enc.patientId !== patientId) continue;
      const names = enc.charges
        .map((c) => c.name?.trim())
        .filter((s): s is string => Boolean(s));
      servicesByEncounter.set(enc.id, names.join(", "));
    }

    const visitRowsHtml = encounterRows
      .map((row) => {
        const services = servicesByEncounter.get(row.encounterId) || "Visit";
        if (row.covered) {
          return `<tr>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(services)}</td>
            <td class="num">${money(row.rawOwed)}</td>
            <td class="num">—</td>
            <td class="num">—</td>
            <td class="num covered">Covered · ${escapeHtml(row.packageName ?? "package")}</td>
          </tr>`;
        }
        const pct = row.entry?.discount ?? 0;
        const discountDollars = row.owed * (pct / 100);
        const paid = row.entry?.amount ?? 0;
        const balance = Math.max(0, row.owed - discountDollars - paid);
        return `<tr>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(services)}</td>
          <td class="num">${money(row.rawOwed)}</td>
          <td class="num">${discountDollars > 0 ? `-${money(discountDollars)}` : "—"}</td>
          <td class="num">${paid > 0 ? money(paid) : "—"}</td>
          <td class="num">${money(balance)}</td>
        </tr>`;
      })
      .join("");

    const packageCharges = packages.reduce((s, p) => s + p.snapshot.discountedPrice, 0);
    const packagesHtml = packages.length
      ? `<section class="section">
          <h3>Treatment Packages</h3>
          <table>
            <thead><tr><th>Package</th><th class="num">Price</th><th class="num">Paid</th><th class="num">Balance</th><th class="num">Visits</th></tr></thead>
            <tbody>
              ${packages
                .map((p) => {
                  const paid = sumPackagePayments(p);
                  const bal = Math.max(0, p.snapshot.discountedPrice - paid);
                  return `<tr>
                    <td>${escapeHtml(p.snapshot.name)}</td>
                    <td class="num">${money(p.snapshot.discountedPrice)}</td>
                    <td class="num">${money(paid)}</td>
                    <td class="num">${money(bal)}</td>
                    <td class="num">${p.visitsUsed} / ${p.snapshot.totalVisits}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </section>`
      : "";

    const paymentsHtml = packagePaymentRows.length
      ? `<section class="section">
          <h3>Package Payments</h3>
          <table>
            <thead><tr><th>Date</th><th>Note</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${packagePaymentRows
                .map(
                  (r) =>
                    `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.note)}</td><td class="num">${money(r.amount)}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </section>`
      : "";

    const totalBilled = totalOwed + packageCharges;
    const balanceDue = Math.max(0, totalBilled - totalDiscount - totalAmount);
    const today = getTodayUsDate();

    const officeLine = [office.address, office.phone ? `T: ${office.phone}` : "", office.email]
      .filter((s) => s && s.trim())
      .map((s) => escapeHtml(s))
      .join(" &nbsp;·&nbsp; ");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Statement — ${escapeHtml(patientName)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2d3a; background: #fff; margin: 0; padding: 24px; }
      .wrap { max-width: 760px; margin: 0 auto; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0d79bf; padding-bottom: 10px; margin-bottom: 14px; }
      .office-name { font-size: 20px; font-weight: 800; color: #0d79bf; margin: 0; }
      .office-detail { font-size: 11px; color: #5a7a8f; margin: 4px 0 0; }
      .doc { font-size: 11px; color: #5a7a8f; text-align: right; }
      h1 { font-size: 16px; margin: 0 0 12px; }
      .meta { font-size: 12px; margin-bottom: 14px; }
      .section { margin-bottom: 16px; }
      h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #5a7a8f; margin: 0 0 6px; border-bottom: 1px solid #d0dfe9; padding-bottom: 3px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #d0dfe9; padding: 5px 8px; font-size: 11px; text-align: left; vertical-align: top; }
      th { background: #f0f6fb; font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; color: #5a7a8f; font-weight: 700; }
      td.num, th.num { text-align: right; white-space: nowrap; }
      td.covered { color: #12805c; font-weight: 600; }
      .totals { margin-top: 14px; margin-left: auto; width: 300px; font-size: 12px; }
      .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
      .totals .row.due { border-top: 2px solid #0d79bf; margin-top: 4px; padding-top: 8px; font-size: 15px; font-weight: 800; color: #0d79bf; }
      .foot { margin-top: 26px; font-size: 10px; color: #90a4b3; text-align: center; }
      @page { size: Letter; margin: 0.5in; }
    </style></head><body><div class="wrap">
      <div class="head">
        <div>
          <p class="office-name">${escapeHtml(office.officeName || "Patient Statement")}</p>
          ${officeLine ? `<p class="office-detail">${officeLine}</p>` : ""}
        </div>
        ${office.doctorName ? `<div class="doc">${escapeHtml(office.doctorName)}</div>` : ""}
      </div>
      <h1>Patient Statement</h1>
      <div class="meta"><strong>Patient:</strong> ${escapeHtml(patientName || "—")} &nbsp;&nbsp; <strong>Date:</strong> ${escapeHtml(today)}</div>

      ${
        encounterRows.length
          ? `<section class="section">
              <h3>Visits &amp; Charges</h3>
              <table>
                <thead><tr><th>Date</th><th>Service(s)</th><th class="num">Charge</th><th class="num">Discount</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
                <tbody>${visitRowsHtml}</tbody>
              </table>
            </section>`
          : ""
      }
      ${packagesHtml}
      ${paymentsHtml}

      <div class="totals">
        <div class="row"><span>Total Charges</span><span>${money(totalBilled)}</span></div>
        <div class="row"><span>Discounts</span><span>${totalDiscount > 0 ? `-${money(totalDiscount)}` : money(0)}</span></div>
        <div class="row"><span>Total Paid</span><span>${money(totalAmount)}</span></div>
        <div class="row due"><span>Balance Due</span><span>${money(balanceDue)}</span></div>
      </div>

      <p class="foot">Generated ${escapeHtml(today)} — thank you for your business.</p>
    </div></body></html>`;

    const popup = window.open("", "_blank");
    if (!popup) {
      window.alert("Please allow pop-ups to print the statement.");
      return;
    }
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    const doPrint = () => {
      popup.focus();
      popup.print();
    };
    if (popup.document.readyState === "complete") setTimeout(doPrint, 120);
    else popup.onload = () => setTimeout(doPrint, 120);
  };

  return (
    <section className="rounded-2xl border border-[#bfd2e0] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-semibold">Payments</h3>
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
          <button
            className="rounded-full border border-[var(--brand-primary)] bg-white px-3 py-1 text-sm font-semibold text-[var(--brand-primary)] transition-all hover:bg-[var(--brand-primary)] hover:text-white active:scale-[0.97]"
            onClick={handlePrintBill}
            title="Print a patient statement"
            type="button"
          >
            🖨 Print Bill
          </button>
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
                <th className="px-3 py-2 text-right">Disc %</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">Paid</th>
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
                const liveDiscountPct = parseMoney(draftDiscount);
                const liveDiscountDollars = row.owed * (liveDiscountPct / 100);
                const balance = Math.max(0, row.owed - liveDiscountDollars - liveAmount);

                return (
                  <tr className="border-t border-[var(--line-soft)]" key={row.encounterId}>
                    <td className="px-3 py-2 font-mono">{row.date}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {row.covered ? (
                        <span className="inline-flex flex-col items-end leading-tight">
                          <span className="text-xs font-semibold text-emerald-700">Covered</span>
                          <span className="text-[11px] font-normal text-[var(--text-muted)]">
                            {row.packageName}
                          </span>
                        </span>
                      ) : row.owed > 0 ? (
                        formatCashAmount(row.owed)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.covered ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1">
                          <input
                            className="w-14 rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-right text-sm"
                            inputMode="decimal"
                            onBlur={() => commitRow(row.encounterId, row.date)}
                            onChange={(e) => setCell(row.encounterId, "discount", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            }}
                            placeholder="0"
                            value={draftDiscount}
                          />
                          <span className="text-xs text-[var(--text-muted)]">%</span>
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        balance === 0 || row.covered ? "text-emerald-700" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {row.covered
                        ? formatCashAmount(0)
                        : row.owed > 0
                          ? formatCashAmount(balance)
                          : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="w-24 rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-right text-sm font-semibold disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
                        disabled={row.covered}
                        inputMode="decimal"
                        onBlur={() => commitRow(row.encounterId, row.date)}
                        onChange={(e) => setCell(row.encounterId, "amount", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        }}
                        placeholder={row.covered ? "—" : "0.00"}
                        value={draftAmount}
                      />
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
                  {totalOwed > 0
                    ? formatCashAmount(Math.max(0, totalOwed - totalDiscount - totalAmount))
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-bold">
                  {formatCashAmount(totalAmount)}
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

      {/* Package payments — partial payments applied to this patient's
          packages appear here (read-only), noted by package name, and
          are already counted in the Paid total above. Add or remove them
          in the Packages panel. */}
      {packagePaymentRows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {packagePaymentRows.map((row) => (
                <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                  <td className="px-3 py-2 font-mono">{row.date}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                    {formatCashAmount(row.amount)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { patients as seedPatients } from "@/lib/mock-data";
import { loadPatientDiagnosesMap, type PatientDiagnosisEntry } from "@/lib/patient-diagnoses";

type BillingPatient = {
  id: string;
  fullName: string;
  phone: string;
  dob: string;
  dateOfLoss: string;
  attorney: string;
};

type BillingPatientRow = BillingPatient & {
  caseNumber: string;
  chargeCount: number;
  chargeTotal: number;
};

type EncounterChargeLine = {
  id: string;
  encounterId: string;
  chargeId: string;
  encounterDate: string;
  provider: string;
  appointmentType: string;
  procedureCode: string;
  description: string;
  units: number;
  unitPrice: number;
  lineTotal: number;
};

type SettlementAdjustmentLine = {
  id: string;
  label: string;
  amount: number;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function toUsDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split("/");
    return `${month}/${day}/20${year}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    return `${month}/${day}/${year}`;
  }
  return trimmed;
}

function formatUsDateInput(rawValue: string) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (!digits) {
    return "";
  }
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function toSortStamp(dateValue: string) {
  const match = toUsDate(dateValue).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return 0;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const stamp = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function getNames(fullName: string) {
  const [lastName = "", firstName = ""] = fullName.split(",").map((value) => value.trim());
  return { firstName, lastName };
}

function buildCaseNumber(dateOfLoss: string, fullName: string) {
  const formattedDate = toUsDate(dateOfLoss);
  const dateMatch = formattedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return "";
  }
  const { firstName, lastName } = getNames(fullName);
  const month = dateMatch[1];
  const day = dateMatch[2];
  const year = dateMatch[3].slice(-2);
  const cleanLast = lastName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  const cleanFirst = firstName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  return `${month}${day}${year}${cleanLast}${cleanFirst}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPrintHtml(config: {
  officeName: string;
  officeAddress: string;
  officePhone: string;
  officeFax: string;
  officeEmail: string;
  logoDataUrl: string;
  patientName: string;
  patientPhone: string;
  patientDob: string;
  patientDoi: string;
  caseNumber: string;
  attorneyName: string;
  attorneyPhone: string;
  providerName: string;
  diagnoses: PatientDiagnosisEntry[];
  rows: EncounterChargeLine[];
  total: number;
}) {
  const diagnosisMarkup = config.diagnoses
    .map(
      (row, index) => `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.code)}</td>
      <td>${escapeHtml(row.description)}</td>
    </tr>`,
    )
    .join("");

  const rowMarkup = config.rows
    .map(
      (row, index) => `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.encounterDate)}</td>
      <td>${escapeHtml(`${row.procedureCode} - ${row.description}`)}</td>
      <td>11</td>
      <td>${row.units}</td>
      <td>${escapeHtml(formatMoney(row.lineTotal))}</td>
      <td>${escapeHtml(formatMoney(0))}</td>
    </tr>`,
    )
    .join("");

  const logoMarkup = config.logoDataUrl.trim()
    ? `<img alt="Office Logo" src="${escapeHtml(config.logoDataUrl)}" class="logo" />`
    : "";

  const diagnosisSection = config.diagnoses.length
    ? `
      <section class="section">
        <h3>Diagnoses</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${diagnosisMarkup}
          </tbody>
        </table>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Statement for Reimbursement</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        color: #121a27;
        background: #fff;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 11px;
        line-height: 1.4;
      }
      .wrapper {
        width: 100%;
        margin: 0;
      }
      .letterhead {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding-bottom: 6px;
        border-bottom: 2px solid #0d79bf;
        margin-bottom: 8px;
      }
      .logo {
        height: 60px;
        width: auto;
        max-width: 160px;
        object-fit: contain;
        flex-shrink: 0;
      }
      .office-info {
        flex: 1;
        text-align: right;
      }
      .office-name {
        font-size: 14px;
        font-weight: 700;
        color: #0d79bf;
        margin: 0;
        line-height: 1.2;
      }
      .office-detail {
        font-size: 10px;
        color: #444;
        line-height: 1.4;
        margin: 0;
      }
      .title {
        text-align: center;
        font-size: 16px;
        font-weight: 700;
        margin: 10px 0 8px 0;
        color: #0d79bf;
      }
      .meta-row {
        border-top: 1px solid #d0dfe9;
        padding-top: 6px;
        margin-bottom: 8px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        font-size: 10px;
      }
      .section {
        margin-top: 8px;
      }
      .section h3 {
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 700;
        color: #0d79bf;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        border: 1px solid #d0dfe9;
        padding: 3px 6px;
        font-size: 10px;
        vertical-align: top;
        text-align: left;
      }
      th {
        background: #f0f6fb;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #5a7a8f;
      }
      .totals {
        margin-top: 8px;
        display: flex;
        justify-content: flex-end;
      }
      .total-box {
        background: #0d79bf;
        color: #fff;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 700;
        border-radius: 3px;
      }
      @page {
        size: Letter;
        margin: 0.5in;
      }
    </style>
  </head>
  <body>
    <main class="wrapper">
      <header class="letterhead">
        ${logoMarkup}
        <div class="office-info">
          <p class="office-name">${escapeHtml(config.officeName)}</p>
          <p class="office-detail">
            ${escapeHtml(config.officeAddress)}<br />
            T: ${escapeHtml(config.officePhone)}${config.officeFax.trim() ? ` | F: ${escapeHtml(config.officeFax)}` : ""}<br />
            ${escapeHtml(config.officeEmail)}
          </p>
        </div>
      </header>

      <div class="title">Statement for Reimbursement</div>

      <div class="meta-row">
        <div>
          <strong>Patient:</strong> ${escapeHtml(config.patientName)}${config.caseNumber ? ` (${escapeHtml(config.caseNumber)})` : ""}<br />
          <strong>DOB:</strong> ${escapeHtml(config.patientDob || "-")}<br />
          <strong>Date of Injury:</strong> ${escapeHtml(config.patientDoi || "-")}
        </div>
        <div style="text-align:right">
          <strong>Attorney:</strong> ${escapeHtml(config.attorneyName || "-")}<br />
          <strong>Attorney Phone:</strong> ${escapeHtml(config.attorneyPhone || "-")}<br />
          <strong>Provider:</strong> ${escapeHtml(config.providerName || "-")}
        </div>
      </div>

      ${diagnosisSection}

      <section class="section">
        <h3>Procedures</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Service</th>
              <th>POS</th>
              <th>Un</th>
              <th>Charge</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            ${rowMarkup}
          </tbody>
        </table>
      </section>

      <div class="totals">
        <div class="total-box">Total: ${escapeHtml(formatMoney(config.total))}</div>
      </div>
    </main>
  </body>
</html>`;
}

function printHtmlWithIframeFallback(printableHtml: string) {
  const popup = window.open("", "_blank");
  if (popup) {
    popup.document.open();
    popup.document.write(printableHtml);
    popup.document.close();
    if (popup.document.readyState === "complete") {
      setTimeout(() => {
        popup.focus();
        popup.print();
      }, 80);
    } else {
      popup.onload = () => {
        setTimeout(() => {
          popup.focus();
          popup.print();
        }, 80);
      };
    }
    return true;
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument ?? iframe.contentWindow?.document;
  const frameWindow = iframe.contentWindow;
  if (!frameDocument || !frameWindow) {
    iframe.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(printableHtml);
  frameDocument.close();

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    iframe.remove();
  };

  frameWindow.onafterprint = cleanup;
  setTimeout(cleanup, 6000);

  setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
    }
  }, 120);

  return true;
}

export default function BillingPage() {
  const { encountersByNewest } = useEncounterNotes();
  const { officeSettings } = useOfficeSettings();
  const { contacts } = useContactDirectory();
  const { getRecord: getPatientBillingRecord } = usePatientBilling();

  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [message, setMessage] = useState("");

  const diagnosisMap = useMemo(() => loadPatientDiagnosesMap(), []);

  const patientsById = useMemo(() => {
    const map = new Map<string, BillingPatient>();
    seedPatients.forEach((entry) => {
      map.set(entry.id, {
        id: entry.id,
        fullName: entry.fullName,
        phone: entry.phone,
        dob: toUsDate(entry.dob),
        dateOfLoss: toUsDate(entry.dateOfLoss),
        attorney: entry.attorney,
      });
    });
    encountersByNewest.forEach((entry) => {
      if (!map.has(entry.patientId)) {
        map.set(entry.patientId, {
          id: entry.patientId,
          fullName: entry.patientName,
          phone: "",
          dob: "",
          dateOfLoss: "",
          attorney: "",
        });
      }
    });
    return map;
  }, [encountersByNewest]);

  const chargeTotalsByPatientId = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    encountersByNewest.forEach((entry) => {
      const current = map.get(entry.patientId) ?? { count: 0, total: 0 };
      entry.charges.forEach((charge) => {
        current.count += 1;
        current.total += charge.unitPrice * charge.units;
      });
      map.set(entry.patientId, current);
    });
    return map;
  }, [encountersByNewest]);

  const patientRows = useMemo(() => {
    return Array.from(patientsById.values())
      .map((entry) => {
        const totals = chargeTotalsByPatientId.get(entry.id) ?? { count: 0, total: 0 };
        const caseNumber = buildCaseNumber(entry.dateOfLoss, entry.fullName);
        return {
          ...entry,
          caseNumber,
          chargeCount: totals.count,
          chargeTotal: totals.total,
        } satisfies BillingPatientRow;
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [patientsById, chargeTotalsByPatientId]);

  const filteredPatients = useMemo(() => {
    const query = patientSearch.trim().toLowerCase();
    if (!query) {
      return patientRows;
    }
    return patientRows.filter((entry) => {
      return (
        entry.fullName.toLowerCase().includes(query) ||
        entry.phone.toLowerCase().includes(query) ||
        entry.attorney.toLowerCase().includes(query) ||
        entry.dateOfLoss.toLowerCase().includes(query) ||
        entry.caseNumber.toLowerCase().includes(query)
      );
    });
  }, [patientRows, patientSearch]);

  const fallbackPatientId = filteredPatients.find((entry) => entry.chargeCount > 0)?.id ?? filteredPatients[0]?.id ?? "";
  const activePatientId = selectedPatientId || fallbackPatientId;
  const selectedPatient = patientRows.find((entry) => entry.id === activePatientId) ?? null;

  const encounterChargeLines = useMemo(() => {
    if (!activePatientId) {
      return [] as EncounterChargeLine[];
    }
    return [...encountersByNewest]
      .filter((encounter) => encounter.patientId === activePatientId)
      .sort((a, b) => toSortStamp(toUsDate(a.encounterDate)) - toSortStamp(toUsDate(b.encounterDate)))
      .flatMap((encounter) =>
        encounter.charges.map((charge) => ({
          id: `${encounter.id}-${charge.id}`,
          encounterId: encounter.id,
          chargeId: charge.id,
          encounterDate: toUsDate(encounter.encounterDate),
          provider: encounter.provider,
          appointmentType: encounter.appointmentType,
          procedureCode: charge.procedureCode,
          description: charge.name,
          units: charge.units,
          unitPrice: charge.unitPrice,
          lineTotal: charge.unitPrice * charge.units,
        })),
      )
      .sort((left, right) => toSortStamp(left.encounterDate) - toSortStamp(right.encounterDate));
  }, [activePatientId, encountersByNewest]);

  const totalBilled = useMemo(
    () => encounterChargeLines.reduce((sum, entry) => sum + entry.lineTotal, 0),
    [encounterChargeLines],
  );
  const patientBillingRecord = activePatientId ? getPatientBillingRecord(activePatientId) : null;
  // Use encounter charges when available, otherwise fall back to manual billed amount
  const billedAmount = totalBilled > 0 ? totalBilled : (patientBillingRecord?.billedAmount ?? 0);
  const paidAmount = patientBillingRecord?.paidAmount ?? 0;
  const paidDate = patientBillingRecord?.paidDate ?? "";
  const remainingBalance = billedAmount - paidAmount;

  const diagnoses = useMemo(() => {
    if (!activePatientId) {
      return [] as PatientDiagnosisEntry[];
    }
    return diagnosisMap[activePatientId] ?? [];
  }, [activePatientId, diagnosisMap]);

  const attorneyContact = useMemo(() => {
    if (!selectedPatient?.attorney.trim()) {
      return null;
    }
    return (
      contacts.find(
        (entry) =>
          normalizeLookupValue(entry.category) === "attorney" &&
          normalizeLookupValue(entry.name) === normalizeLookupValue(selectedPatient.attorney),
      ) ?? null
    );
  }, [contacts, selectedPatient]);

  const providerName = encounterChargeLines[0]?.provider ?? officeSettings.doctorName;

  const handlePrintBill = () => {
    if (!selectedPatient) {
      setMessage("Select a patient first.");
      return;
    }
    if (!encounterChargeLines.length) {
      setMessage("This patient has no encounter charges.");
      return;
    }

    const printableHtml = buildPrintHtml({
      officeName: officeSettings.officeName,
      officeAddress: officeSettings.address,
      officePhone: officeSettings.phone,
      officeFax: officeSettings.fax,
      officeEmail: officeSettings.email,
      logoDataUrl: officeSettings.logoDataUrl,
      patientName: selectedPatient.fullName,
      patientPhone: selectedPatient.phone,
      patientDob: selectedPatient.dob,
      patientDoi: selectedPatient.dateOfLoss,
      caseNumber: buildCaseNumber(selectedPatient.dateOfLoss, selectedPatient.fullName),
      attorneyName: selectedPatient.attorney,
      attorneyPhone: attorneyContact?.phone ?? "",
      providerName,
      diagnoses,
      rows: encounterChargeLines,
      total: billedAmount,
    });

    const opened = printHtmlWithIframeFallback(printableHtml);
    if (!opened) {
      setMessage("Could not open print view. Check popup/browser settings and try again.");
      return;
    }
    setMessage("Statement opened. Use Print -> Save as PDF.");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="panel-card p-4">
        <h2 className="text-xl font-semibold">Patients</h2>
        <input
          className="mt-3 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => setPatientSearch(event.target.value)}
          placeholder="Search patient..."
          value={patientSearch}
        />
        {/* Live search: only show the patient list while the user is typing
            a query or until they've picked a patient. Once a patient is
            selected and the search box is empty, the list collapses to a
            single "currently viewing" pill so the page isn't dominated by
            the directory. */}
        {patientSearch.trim() ? (
          <div className="mt-3 max-h-[72vh] space-y-2 overflow-auto pr-1">
            {filteredPatients.slice(0, 20).map((entry) => {
              const selected = entry.id === activePatientId;
              return (
                <button
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    selected
                      ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]"
                      : "border-[var(--line-soft)] bg-white hover:bg-[var(--bg-soft)]"
                  }`}
                  key={entry.id}
                  onClick={() => {
                    setSelectedPatientId(entry.id);
                    setPatientSearch("");
                    setMessage("");
                  }}
                  type="button"
                >
                  <p className="font-semibold">{entry.fullName}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Case #: {entry.caseNumber || "-"} • DOI: {entry.dateOfLoss || "-"}
                  </p>
                </button>
              );
            })}
            {filteredPatients.length === 0 && (
              <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-4 text-sm text-[var(--text-muted)]">
                No matching patients.
              </p>
            )}
          </div>
        ) : selectedPatient ? (
          <div className="mt-3 rounded-xl border border-[var(--brand-primary)] bg-[var(--bg-soft)] px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Viewing
            </p>
            <p className="font-semibold">{selectedPatient.fullName}</p>
            <p className="text-xs text-[var(--text-muted)]">
              Case #: {selectedPatient.caseNumber || "-"} • DOI: {selectedPatient.dateOfLoss || "-"}
            </p>
            <button
              className="mt-2 text-xs font-semibold text-[var(--brand-primary)] underline"
              onClick={() => setSelectedPatientId("")}
              type="button"
            >
              Change patient
            </button>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--line-soft)] px-3 py-4 text-sm text-[var(--text-muted)]">
            Start typing a patient name above to begin.
          </p>
        )}
      </section>

      <div className="space-y-4">
        <section className="panel-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Patient Billing Statement</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {selectedPatient ? selectedPatient.fullName : "Select a patient"}
              </p>
            </div>
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90 disabled:opacity-50"
              disabled={!selectedPatient || encounterChargeLines.length === 0}
              onClick={handlePrintBill}
              type="button"
            >
              Print Bill
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Case #</p>
              <p className="font-semibold">
                {selectedPatient ? buildCaseNumber(selectedPatient.dateOfLoss, selectedPatient.fullName) || "-" : "-"}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">DOB</p>
              <p className="font-semibold">{selectedPatient?.dob || "-"}</p>
            </div>
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Date of Injury</p>
              <p className="font-semibold">{selectedPatient?.dateOfLoss || "-"}</p>
            </div>
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Total Billed</p>
              <p className="font-semibold">{formatMoney(billedAmount)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Paid</p>
              <p className="font-semibold">{formatMoney(paidAmount)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Balance</p>
              <p className={`font-semibold ${remainingBalance <= 0 ? "text-[#196d3a]" : "text-[#b43b34]"}`}>
                {formatMoney(remainingBalance)}
              </p>
            </div>
          </div>


          {message && <p className="mt-3 text-sm font-semibold text-[var(--brand-primary)]">{message}</p>}
        </section>

        <section className="panel-card overflow-hidden">
          <div className="border-b border-[var(--line-soft)] p-4">
            <h3 className="text-lg font-semibold">Diagnoses</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {diagnoses.map((entry, index) => (
                  <tr className="border-t border-[var(--line-soft)]" key={entry.id}>
                    <td className="px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3">{entry.code}</td>
                    <td className="px-4 py-3">{entry.description}</td>
                  </tr>
                ))}
                {diagnoses.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]" colSpan={3}>
                      No diagnosis codes on file for this patient.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel-card overflow-hidden">
          <div className="border-b border-[var(--line-soft)] p-4">
            <h3 className="text-lg font-semibold">Procedures</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">POS</th>
                  <th className="px-4 py-3">Un</th>
                  <th className="px-4 py-3">Charge</th>
                  <th className="px-4 py-3">Tax</th>
                </tr>
              </thead>
              <tbody>
                {encounterChargeLines.map((line, index) => (
                  <tr className="border-t border-[var(--line-soft)]" key={line.id}>
                    <td className="px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3">{line.encounterDate}</td>
                    <td className="px-4 py-3">
                      {line.procedureCode} - {line.description}
                    </td>
                    <td className="px-4 py-3">11</td>
                    <td className="px-4 py-3">{line.units}</td>
                    <td className="px-4 py-3">{formatMoney(line.lineTotal)}</td>
                    <td className="px-4 py-3">{formatMoney(0)}</td>
                  </tr>
                ))}
                {encounterChargeLines.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-sm text-[var(--text-muted)]" colSpan={7}>
                      No encounter charges found for this patient.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

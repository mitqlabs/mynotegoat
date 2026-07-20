"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { patients } from "@/lib/mock-data";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { usePatientPackages } from "@/hooks/use-patient-packages";
import { sumPackagePayments } from "@/lib/patient-packages";
import { useCashPayments } from "@/hooks/use-cash-payments";

// Legacy single-level sort keys, preserved only for migration to v2.
const ATTORNEY_SORT_COLUMN_KEY = "casemate.attorney-perf-sort-column.v1";
const ATTORNEY_SORT_ASC_KEY = "casemate.attorney-perf-sort-asc.v1";
// New multi-level sort: array of {column, asc} stored as JSON, max 3 levels.
const ATTORNEY_SORT_LEVELS_KEY = "casemate.attorney-perf-sort-levels.v1";
const ATTORNEY_MAX_SORT_LEVELS = 3;

type AttorneyStatColumn =
  | "attorney"
  | "received"
  | "active"
  | "discharged"
  | "readyToSubmit"
  | "submitted"
  | "dropped"
  | "paid"
  | "avgTimeToRb"
  | "avgTimeToPaid"
  | "percentPaid";

const attorneyStatColumns: AttorneyStatColumn[] = [
  "attorney",
  "received",
  "active",
  "discharged",
  "readyToSubmit",
  "submitted",
  "dropped",
  "paid",
  "avgTimeToRb",
  "avgTimeToPaid",
  "percentPaid",
];

const attorneyStatLabels: Record<AttorneyStatColumn, string> = {
  attorney: "Attorney",
  received: "Received",
  active: "Active",
  discharged: "Discharged",
  readyToSubmit: "Ready To Submit",
  submitted: "Submitted",
  dropped: "Dropped",
  paid: "Paid",
  avgTimeToRb: "Avg. Time To R&B",
  avgTimeToPaid: "Avg. Time To Paid",
  percentPaid: "% Paid",
};

type AttorneySortLevel = { column: AttorneyStatColumn; asc: boolean };
const defaultAttorneySortLevels: AttorneySortLevel[] = [{ column: "received", asc: false }];

function isAttorneyStatColumn(value: unknown): value is AttorneyStatColumn {
  return typeof value === "string" && attorneyStatColumns.includes(value as AttorneyStatColumn);
}

function loadAttorneySortLevels(): AttorneySortLevel[] {
  if (typeof window === "undefined") return defaultAttorneySortLevels;
  try {
    const raw = window.localStorage.getItem(ATTORNEY_SORT_LEVELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned: AttorneySortLevel[] = [];
        const seen = new Set<AttorneyStatColumn>();
        for (const entry of parsed) {
          if (!entry || typeof entry !== "object") continue;
          const col = (entry as { column?: unknown }).column;
          const asc = (entry as { asc?: unknown }).asc;
          if (!isAttorneyStatColumn(col) || typeof asc !== "boolean") continue;
          if (seen.has(col)) continue;
          seen.add(col);
          cleaned.push({ column: col, asc });
          if (cleaned.length >= ATTORNEY_MAX_SORT_LEVELS) break;
        }
        if (cleaned.length > 0) return cleaned;
      }
    }
    // One-time migration from the old single-key pair.
    const oldCol = window.localStorage.getItem(ATTORNEY_SORT_COLUMN_KEY);
    const oldAsc = window.localStorage.getItem(ATTORNEY_SORT_ASC_KEY);
    if (isAttorneyStatColumn(oldCol)) {
      return [{ column: oldCol, asc: oldAsc === "true" }];
    }
    return defaultAttorneySortLevels;
  } catch {
    return defaultAttorneySortLevels;
  }
}

function saveAttorneySortLevels(levels: AttorneySortLevel[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ATTORNEY_SORT_LEVELS_KEY, JSON.stringify(levels));
}

const monthOrder = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAYS_PER_MONTH = 30.436875;

function monthNameFromDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  return date.toLocaleString("en-US", { month: "long" });
}

/**
 * Parse a date string that may be in several formats and return the year
 * and month name. Initial Exam is stored as the user typed it (US format
 * MM/DD/YYYY), while other dates are ISO (YYYY-MM-DD). Returns null if
 * the value is empty or unparseable so the chart can skip it instead of
 * bucketing everything under a bogus month.
 */
function parseFlexibleDate(value: string | undefined): { year: number; monthName: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;

  // ISO first: YYYY-MM-DD (optionally followed by anything)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (!Number.isFinite(year) || month < 1 || month > 12) return null;
    return { year, monthName: monthOrder[month - 1] };
  }

  // US: M/D/YY or M/D/YYYY (optionally followed by anything)
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!usMatch) return null;
  const month = Number(usMatch[1]);
  let year = Number(usMatch[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, monthName: monthOrder[month - 1] };
}

function normalizeAttorneyKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanAttorneyLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function extractSpecialistLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return "";
  }
  const withoutLeadingDate = trimmed.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, "").trim();
  return withoutLeadingDate || trimmed;
}

function parseDollar(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseMatrixDate(value: string | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // US MM/DD/YYYY
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // ISO YYYY-MM-DD
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole-day gap between two milestone dates. Returns null unless BOTH
// dates are present and the interval is positive — so incomplete cases
// (missing an endpoint) and zero/negative spans never enter an average
// and skew it. This is the "completed items only" rule.
function daysBetween(startValue: string | undefined, endValue: string | undefined): number | null {
  const start = parseMatrixDate(startValue);
  const end = parseMatrixDate(endValue);
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diff > 0 ? diff : null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMonthsFromDays(value: number) {
  if (!value) {
    return "N/A";
  }
  const months = value / DAYS_PER_MONTH;
  return `${months.toFixed(1)} months`;
}

function formatAverageCaseCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Default the year filter to the current calendar year if any patient
 * has a date-of-loss in it. Otherwise fall back to "ALL" so a brand-new
 * account doesn't open to an empty chart. Evaluated once at mount.
 */
function getDefaultYear(): string {
  const currentYear = new Date().getFullYear().toString();
  const hasCurrentYear = patients.some((patient) => {
    if (!patient.dateOfLoss) return false;
    try {
      return new Date(`${patient.dateOfLoss}T00:00:00`).getFullYear().toString() === currentYear;
    } catch {
      return false;
    }
  });
  return hasCurrentYear ? currentYear : "ALL";
}

export default function StatisticsPage() {
  const { caseStatuses } = useCaseStatuses();
  // Live patient-billing records. The patient page writes paid amount
  // to BOTH this store (canonical) and patient.matrix.paidAmount (legacy
  // mirror). The matrix mirror can drift — SQL-migrated patients may
  // never have had it populated, and certain save paths can clobber it
  // back to "0" before the user re-enters a value. Reading from the
  // billing store first means the Billing Snapshot always reflects the
  // same Paid value the user sees in Additional Details → $ Paid Amount.
  const { getRecord: getPatientBillingRecord } = usePatientBilling();
  const { packagesByPatient } = usePatientPackages();
  const { paymentsByPatient } = useCashPayments();
  // Live filters — every dropdown/search update applies immediately, no
  // Go button. Previously we had a draft/applied split gated behind GO;
  // that friction wasn't worth the re-render cost on a mock-data page.
  const [search, setSearch] = useState("");
  const [year, setYear] = useState<string>(getDefaultYear);

  // Cash-patient revenue, filtered by the selected Year (packages by
  // purchase date, cash payments by payment date). Refunded packages
  // excluded from revenue. Also builds a per-patient outstanding list.
  const cashStats = useMemo(() => {
    const inYear = (dateStr: string | undefined) =>
      year === "ALL" || parseFlexibleDate(dateStr)?.year.toString() === year;
    const nameById = new Map(patients.map((p) => [p.id, p.fullName]));
    const activePatientIds = new Set<string>();

    let cashCollected = 0;
    for (const [pid, entries] of Object.entries(paymentsByPatient)) {
      for (const entry of entries) {
        if (!inYear(entry.date)) continue;
        cashCollected += entry.amount;
        activePatientIds.add(pid);
      }
    }

    let packagesSold = 0;
    let activePackages = 0;
    let packageValue = 0;
    let packagePaid = 0;
    const outstandingByPatient = new Map<string, number>();
    for (const [pid, pkgs] of Object.entries(packagesByPatient)) {
      for (const pkg of pkgs) {
        if (pkg.status === "refunded") continue;
        if (!inYear(pkg.purchaseDate)) continue;
        packagesSold += 1;
        if (pkg.status === "active") activePackages += 1;
        packageValue += pkg.snapshot.discountedPrice;
        const paid = sumPackagePayments(pkg);
        packagePaid += paid;
        activePatientIds.add(pid);
        const bal = pkg.snapshot.discountedPrice - paid;
        if (bal > 0) {
          outstandingByPatient.set(pid, (outstandingByPatient.get(pid) ?? 0) + bal);
        }
      }
    }
    const packageOutstanding = Math.max(0, packageValue - packagePaid);
    const outstandingList = Array.from(outstandingByPatient.entries())
      .map(([pid, amount]) => ({ pid, name: nameById.get(pid) ?? "Unknown", amount }))
      .sort((a, b) => b.amount - a.amount);
    const totalCashRoster = patients.filter((p) => !p.deleted && p.isCashPatient).length;

    return {
      cashPatients: year === "ALL" ? totalCashRoster : activePatientIds.size,
      packagesSold,
      activePackages,
      packageValue,
      packagePaid,
      packageOutstanding,
      cashCollected,
      totalCollected: cashCollected + packagePaid,
      outstandingList,
    };
  }, [packagesByPatient, paymentsByPatient, year]);
  const [attorney, setAttorney] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  // Billing Snapshot starts hidden so nothing sensitive is visible when
  // the page first opens — click to reveal.
  const [showBilling, setShowBilling] = useState(false);
  const [showCash, setShowCash] = useState(false);

  const [attorneySortLevels, setAttorneySortLevels] = useState<AttorneySortLevel[]>(
    () => loadAttorneySortLevels(),
  );
  const persistAttorneySortLevels = (next: AttorneySortLevel[]) => {
    setAttorneySortLevels(next);
    saveAttorneySortLevels(next);
  };
  // Click a column header to sort by it. If it's already the sort column,
  // clicking toggles the direction. Text (Attorney) defaults to A→Z, the
  // numeric columns to highest-first.
  const handleAttorneyColumnClick = (colId: AttorneyStatColumn) => {
    const primary = attorneySortLevels[0];
    const asc =
      primary && primary.column === colId ? !primary.asc : colId === "attorney";
    persistAttorneySortLevels([{ column: colId, asc }]);
  };
  const updateAttorneySortLevel = (index: number, patch: Partial<AttorneySortLevel>) => {
    const next = attorneySortLevels.map((level, i) => (i === index ? { ...level, ...patch } : level));
    persistAttorneySortLevels(next);
  };
  const removeAttorneySortLevel = (index: number) => {
    if (attorneySortLevels.length <= 1) return;
    persistAttorneySortLevels(attorneySortLevels.filter((_, i) => i !== index));
  };
  const addAttorneySortLevel = () => {
    if (attorneySortLevels.length >= ATTORNEY_MAX_SORT_LEVELS) return;
    const used = new Set(attorneySortLevels.map((l) => l.column));
    const nextCol = attorneyStatColumns.find((c) => !used.has(c)) ?? attorneyStatColumns[0];
    // Numeric columns default to descending; text (Attorney) to ascending.
    persistAttorneySortLevels([
      ...attorneySortLevels,
      { column: nextCol, asc: nextCol === "attorney" },
    ]);
  };

  const years = useMemo(
    () => {
      const collected = new Set<string>();
      for (const patient of patients) {
        const parsed = parseFlexibleDate(patient.dateOfLoss);
        if (parsed && Number.isFinite(parsed.year)) {
          collected.add(parsed.year.toString());
        }
      }
      // Sort years newest-first for a more natural dropdown order
      const sorted = Array.from(collected).sort((a, b) => Number(b) - Number(a));
      return ["ALL", ...sorted];
    },
    [],
  );

  const attorneyOptions = useMemo(() => {
    const deduped = new Map<string, string>();
    patients.forEach((patient) => {
      const cleanName = cleanAttorneyLabel(patient.attorney);
      const key = normalizeAttorneyKey(cleanName);
      if (key && !deduped.has(key)) {
        deduped.set(key, cleanName);
      }
    });
    // Sort case-insensitively so "ymPK" sits next to "YMPK" and "Ace Law"
    // appears at the top instead of buried mid-list. Patients page already
    // does this; statistics page was missing the sort and ended up with
    // attorneys ordered by first-seen-in-patient-list which read random.
    return [
      "ALL",
      ...Array.from(deduped.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    ];
  }, []);

  const statusFilterOptions = useMemo(
    () => caseStatuses.map((statusConfig) => statusConfig.name),
    [caseStatuses],
  );

  const filteredPatients = useMemo(() => {
    return patients.filter((patient) => {
      const matchesSearch =
        !search.trim() ||
        patient.fullName.toLowerCase().includes(search.toLowerCase()) ||
        patient.attorney.toLowerCase().includes(search.toLowerCase());

      const matchesYear =
        year === "ALL" ||
        (parseFlexibleDate(patient.dateOfLoss)?.year.toString() === year);

      const matchesAttorney =
        attorney === "ALL" ||
        normalizeAttorneyKey(patient.attorney) === normalizeAttorneyKey(attorney);

      const matchesStatus = status === "ALL" || patient.caseStatus === status;

      return matchesSearch && matchesYear && matchesAttorney && matchesStatus;
    });
  }, [attorney, search, status, year]);

  // Billing data from Additional Details → $ Billed, $ Paid Amount.
  // Prefer the live patient-billing record (canonical post-rollout
  // store, written every save) and fall back to the legacy matrix
  // mirror for any patient that doesn't have a billing record yet
  // (e.g. SQL-imported patients that haven't been opened in the new
  // patient page since the rollout). This matches what the user sees
  // in the $ Paid Amount field on the patient page — previously the
  // snapshot read the legacy mirror only, which could be stale or
  // "0" while the live billing record had the real value.
  const billingData = useMemo(() => {
    let billedTotal = 0;
    let paidTotal = 0;
    let billedPaidCases = 0;
    let paidPaidCases = 0;
    let billedCaseCount = 0; // patients with billed > 0
    let paidCaseCount = 0; // patients with paid > 0

    filteredPatients.forEach((patient) => {
      const billing = getPatientBillingRecord(patient.id);
      const billed = billing && billing.billedAmount > 0
        ? billing.billedAmount
        : parseDollar(patient.matrix?.billed);
      const paid = billing && billing.paidAmount > 0
        ? billing.paidAmount
        : parseDollar(patient.matrix?.paidAmount);
      billedTotal += billed;
      paidTotal += paid;
      if (billed > 0) billedCaseCount += 1;
      if (paid > 0) paidCaseCount += 1;

      if (paid > 0 || patient.caseStatus === "Paid") {
        billedPaidCases += billed;
        paidPaidCases += paid;
      }
    });

    const paidRate = billedPaidCases === 0 ? 0 : (paidPaidCases / billedPaidCases) * 100;
    const avgBilled = billedCaseCount ? billedTotal / billedCaseCount : 0;
    const avgPaid = paidCaseCount ? paidTotal / paidCaseCount : 0;

    return { billedTotal, paidTotal, paidRate, avgBilled, avgPaid };
  }, [filteredPatients, getPatientBillingRecord]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    caseStatuses.forEach((statusConfig) => {
      counts[statusConfig.name] = 0;
    });

    filteredPatients.forEach((patient) => {
      counts[patient.caseStatus] = (counts[patient.caseStatus] ?? 0) + 1;
    });
    return counts;
  }, [caseStatuses, filteredPatients]);

  // Cases By Month buckets by the patient's INITIAL EXAM date (the day
  // the patient first walked into the office), not date-of-loss. We parse
  // the raw user-entered value flexibly (US or ISO), skip anything
  // unparseable or missing, and — when a specific year is selected in
  // the filter — only count exams that fall inside that calendar year.
  // "ALL" aggregates across every year's exams.
  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(
      monthOrder.map((monthName) => [monthName, 0]),
    ) as Record<string, number>;

    filteredPatients.forEach((patient) => {
      const parsed = parseFlexibleDate(patient.matrix?.initialExam);
      if (!parsed) return;
      if (year !== "ALL" && parsed.year.toString() !== year) return;
      counts[parsed.monthName] += 1;
    });

    return monthOrder.map((monthName) => ({
      month: monthName,
      count: counts[monthName],
    }));
  }, [filteredPatients, year]);

  const totalCasesAcrossMonths = monthCounts.reduce((sum, entry) => sum + entry.count, 0);
  const monthsWithCases = monthCounts.filter((entry) => entry.count > 0).length;
  const averageCasesPerMonth = monthsWithCases > 0 ? totalCasesAcrossMonths / monthsWithCases : 0;

  // Cycle time averages from patient matrix (Additional Details)
  const timelineAverages = useMemo(() => {
    const initialToDischargeValues: number[] = [];
    const dischargeToRbValues: number[] = [];
    const rbToPaidValues: number[] = [];

    filteredPatients.forEach((patient) => {
      const m = patient.matrix;
      // Compute from the actual saved milestone DATES (the precomputed
      // matrix.initialToDischarge/dischargeToRb/rbToPaid fields are never
      // written by the app, so they were empty/garbage).
      const itd = daysBetween(m?.initialExam, m?.discharge);
      const dtr = daysBetween(m?.discharge, m?.rbSent);
      const rtp = daysBetween(m?.rbSent, m?.paidDate);
      if (itd !== null) initialToDischargeValues.push(itd);
      if (dtr !== null) dischargeToRbValues.push(dtr);
      if (rtp !== null) rbToPaidValues.push(rtp);
    });

    return {
      initialToDischarge: average(initialToDischargeValues),
      dischargeToRb: average(dischargeToRbValues),
      rbToPaid: average(rbToPaidValues),
    };
  }, [filteredPatients]);

  const imagingFacilityStats = useMemo(() => {
    type FacilityRow = { facility: string; xray: number; mri: number; total: number; casePatientIds: Set<string> };
    const grouped: Record<string, FacilityRow> = {};

    const addReferral = (patientId: string, facility: string, type: "xray" | "mri", regions: string[]) => {
      const key = facility.toLowerCase();
      if (!grouped[key]) {
        grouped[key] = { facility, xray: 0, mri: 0, total: 0, casePatientIds: new Set<string>() };
      }
      grouped[key].casePatientIds.add(patientId);
      // Count each region as a referral (or 1 if no regions)
      const count = Math.max(1, regions.length);
      if (type === "xray") {
        grouped[key].xray += count;
      } else {
        grouped[key].mri += count;
      }
      grouped[key].total += count;
    };

    filteredPatients.forEach((patient) => {
      // X-Ray referrals
      if (Array.isArray(patient.xrayReferrals)) {
        for (const raw of patient.xrayReferrals) {
          const ref = raw as Record<string, unknown>;
          const center = typeof ref.center === "string" ? ref.center.trim() : "";
          if (!center) continue;
          const regions = Array.isArray(ref.regions) ? (ref.regions as string[]) : [];
          addReferral(patient.id, center, "xray", regions);
        }
      }
      // MRI / CT referrals
      if (Array.isArray(patient.mriReferrals)) {
        for (const raw of patient.mriReferrals) {
          const ref = raw as Record<string, unknown>;
          const center = typeof ref.center === "string" ? ref.center.trim() : "";
          if (!center) continue;
          const regions = Array.isArray(ref.regions) ? (ref.regions as string[]) : [];
          addReferral(patient.id, center, "mri", regions);
        }
      }
    });

    return Object.values(grouped)
      .map((row) => ({
        facility: row.facility,
        cases: row.casePatientIds.size,
        xray: row.xray,
        mri: row.mri,
        total: row.total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredPatients]);

  const specialistReferralStats = useMemo(() => {
    const grouped: Record<string, { specialist: string; casePatientIds: Set<string> }> = {};

    filteredPatients.forEach((patient) => {
      // Read from specialistReferrals array (the actual saved data)
      if (Array.isArray(patient.specialistReferrals)) {
        for (const raw of patient.specialistReferrals) {
          const ref = raw as Record<string, unknown>;
          const name = typeof ref.specialist === "string" ? ref.specialist.trim() : "";
          if (!name || name === "-") continue;

          const key = name.toLowerCase();
          if (!grouped[key]) {
            grouped[key] = { specialist: name, casePatientIds: new Set<string>() };
          }
          grouped[key].casePatientIds.add(patient.id);
        }
      }

      // Fallback: also check matrix.specialistSent for older data
      if (!Array.isArray(patient.specialistReferrals) || patient.specialistReferrals.length === 0) {
        const specialist = extractSpecialistLabel(patient.matrix?.specialistSent ?? "");
        if (!specialist) return;

        const key = specialist.toLowerCase();
        if (!grouped[key]) {
          grouped[key] = { specialist, casePatientIds: new Set<string>() };
        }
        grouped[key].casePatientIds.add(patient.id);
      }
    });

    return Object.values(grouped)
      .map((row) => ({
        specialist: row.specialist,
        cases: row.casePatientIds.size,
      }))
      .sort((a, b) => b.cases - a.cases);
  }, [filteredPatients]);

  const attorneyStats = useMemo(() => {
    const grouped: Record<
      string,
      {
        attorney: string;
        received: number;
        active: number;
        discharged: number;
        readyToSubmit: number;
        submitted: number;
        dropped: number;
        paid: number;
        billed: number;
        collected: number;
        timeToRbValues: number[];
        timeToPaidValues: number[];
      }
    > = {};

    filteredPatients.forEach((patient) => {
      const attorneyKey = normalizeAttorneyKey(patient.attorney);
      if (!grouped[attorneyKey]) {
        grouped[attorneyKey] = {
          attorney: cleanAttorneyLabel(patient.attorney),
          received: 0,
          active: 0,
          discharged: 0,
          readyToSubmit: 0,
          submitted: 0,
          dropped: 0,
          paid: 0,
          billed: 0,
          collected: 0,
          timeToRbValues: [],
          timeToPaidValues: [],
        };
      }

      const row = grouped[attorneyKey];
      row.received += 1;
      row.active += patient.caseStatus === "Active" ? 1 : 0;
      row.discharged += patient.caseStatus === "Discharged" ? 1 : 0;
      row.readyToSubmit += patient.caseStatus === "Ready To Submit" ? 1 : 0;
      row.submitted += patient.caseStatus === "Submitted" ? 1 : 0;
      row.dropped += patient.caseStatus === "Dropped" ? 1 : 0;
      row.paid += patient.caseStatus === "Paid" ? 1 : 0;

      // Billing — prefer live patient-billing record (canonical), fall
      // back to legacy matrix mirror only when no record exists. Same
      // reasoning as the Billing Snapshot above: the matrix mirror can
      // be stale while the billing record holds the user-entered value.
      const billing = getPatientBillingRecord(patient.id);
      row.billed += billing && billing.billedAmount > 0
        ? billing.billedAmount
        : parseDollar(patient.matrix?.billed);
      row.collected += billing && billing.paidAmount > 0
        ? billing.paidAmount
        : parseDollar(patient.matrix?.paidAmount);

      // Timeline from the saved milestone dates (completed spans only).
      const dtr = daysBetween(patient.matrix?.discharge, patient.matrix?.rbSent);
      const rtp = daysBetween(patient.matrix?.rbSent, patient.matrix?.paidDate);
      if (dtr !== null) row.timeToRbValues.push(dtr);
      if (rtp !== null) row.timeToPaidValues.push(rtp);
    });

    return Object.values(grouped).map((row) => {
      const avgTimeToRb = average(row.timeToRbValues);
      const avgTimeToPaid = average(row.timeToPaidValues);
      const percentPaid = row.billed ? (row.collected / row.billed) * 100 : 0;
      return {
        ...row,
        avgTimeToRb,
        avgTimeToPaid,
        percentPaid,
      };
    });
  }, [filteredPatients, getPatientBillingRecord]);

  const sortedAttorneyStats = useMemo(() => {
    const compareBy = (
      a: (typeof attorneyStats)[number],
      b: (typeof attorneyStats)[number],
      column: AttorneyStatColumn,
      asc: boolean,
    ) => {
      let cmp: number;
      if (column === "attorney") {
        cmp = a.attorney.localeCompare(b.attorney);
      } else if (column === "avgTimeToRb" || column === "avgTimeToPaid") {
        // Rows with no timing data (value === 0, displayed as "N/A") always
        // sort to the bottom regardless of direction.
        const av = a[column];
        const bv = b[column];
        if (!av && !bv) cmp = 0;
        else if (!av) return 1;
        else if (!bv) return -1;
        else cmp = av - bv;
      } else {
        cmp = (a[column] as number) - (b[column] as number);
      }
      return asc ? cmp : -cmp;
    };
    const items = [...attorneyStats];
    items.sort((a, b) => {
      for (const level of attorneySortLevels) {
        const c = compareBy(a, b, level.column, level.asc);
        if (c !== 0) return c;
      }
      // Final tiebreaker so the order is stable when all sort levels match.
      return a.attorney.localeCompare(b.attorney);
    });
    return items;
  }, [attorneyStats, attorneySortLevels]);

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Statistics Workspace</h3>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
            <label className="text-sm font-semibold text-[var(--text-muted)]">Patient Name</label>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient or attorney"
              value={search}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Year
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => setYear(event.target.value)}
                value={year}
              >
                {years.map((yearOption) => (
                  <option key={yearOption} value={yearOption}>
                    {yearOption}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Attorney
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => setAttorney(event.target.value)}
                value={attorney}
              >
                {attorneyOptions.map((attorneyOption) => (
                  <option key={attorneyOption} value={attorneyOption}>
                    {attorneyOption}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Status
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="ALL">ALL</option>
                {statusFilterOptions.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <article className="panel-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-semibold">Billing Snapshot</h4>
              <button
                aria-label={showBilling ? "Hide billing numbers" : "Show billing numbers"}
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                onClick={() => setShowBilling((prev) => !prev)}
                type="button"
              >
                {showBilling ? "Hide" : "Show"}
              </button>
            </div>
            {/*
              Billing Snapshot stays hidden until the user explicitly asks
              for it. When hidden we render a blurred copy of the numbers
              so the layout doesn't jump, plus a "click to reveal" button
              on top. This is for office-walk-by privacy — anyone glancing
              at the screen shouldn't see totals.
            */}
            <div className="relative mt-4">
              <div
                className={`space-y-2 text-sm transition-[filter] ${showBilling ? "" : "pointer-events-none select-none blur-md"}`}
                aria-hidden={!showBilling}
              >
                <p className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Billed</span>
                  <span className="font-bold">{formatMoney(billingData.billedTotal)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Paid</span>
                  <span className="font-bold">{formatMoney(billingData.paidTotal)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">% Paid (Paid Cases)</span>
                  <span className="font-bold">{billingData.paidRate.toFixed(1)}%</span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Uses only cases with payments or Paid status for percentage.
                </p>
                <div className="my-2 border-t border-[var(--line-soft)]" />
                <p className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Avg/Billed</span>
                  <span className="font-bold">{formatMoney(billingData.avgBilled)}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Avg/Paid</span>
                  <span className="font-bold">{formatMoney(billingData.avgPaid)}</span>
                </p>
              </div>
              {!showBilling && (
                <button
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-white/60 text-sm font-semibold text-[var(--text-primary)] hover:bg-white/80"
                  onClick={() => setShowBilling(true)}
                  type="button"
                >
                  <span>Click to reveal</span>
                  <span className="text-xs font-normal text-[var(--text-muted)]">Hidden for privacy</span>
                </button>
              )}
            </div>
          </article>

          <article className="panel-card p-4">
            <h4 className="text-lg font-semibold">Total Reports</h4>
            <p className="mt-2 text-3xl font-bold">{filteredPatients.length}</p>
            <div className="mt-3 space-y-1">
              {caseStatuses.map((statusConfig) => (
                <p key={statusConfig.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                    style={{ backgroundColor: statusConfig.color }}
                  />
                  <span>{statusConfig.name.toUpperCase()}</span>
                  <span className="font-semibold">{statusCounts[statusConfig.name] ?? 0}</span>
                </p>
              ))}
            </div>
          </article>

          <article className="panel-card p-4">
            <h4 className="text-lg font-semibold">Cycle Time Averages</h4>
            <div className="mt-4 space-y-2 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Avg. Initial To Discharge</span>
                <span className="font-semibold">{formatMonthsFromDays(timelineAverages.initialToDischarge)}</span>
              </p>
              <p className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Avg. Discharge To R&B</span>
                <span className="font-semibold">{formatMonthsFromDays(timelineAverages.dischargeToRb)}</span>
              </p>
              <p className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Avg. R&B To Paid</span>
                <span className="font-semibold">{formatMonthsFromDays(timelineAverages.rbToPaid)}</span>
              </p>
            </div>
          </article>

          <article className="panel-card p-4">
            <h4 className="text-lg font-semibold">Cases By Month</h4>
            <div className="mt-2 space-y-1 text-sm">
              {monthCounts.map((entry) => (
                <div key={entry.month} className="flex items-center justify-between">
                  <span>{entry.month}</span>
                  <span className="font-semibold">{entry.count}</span>
                </div>
              ))}
              <div className="my-2 border-t border-[var(--line-soft)]" />
              <div className="flex items-center justify-between">
                <span className="font-semibold">Average / Month</span>
                <span className="font-bold">{formatAverageCaseCount(averageCasesPerMonth)}</span>
              </div>
            </div>
          </article>

          <article className="panel-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-semibold">Cash Patients &amp; Packages</h4>
              <button
                aria-label={showCash ? "Hide cash numbers" : "Show cash numbers"}
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                onClick={() => setShowCash((prev) => !prev)}
                type="button"
              >
                {showCash ? "Hide" : "Show"}
              </button>
            </div>
            <div className="relative mt-4">
              <div
                className={`space-y-2 text-sm transition-[filter] ${showCash ? "" : "pointer-events-none select-none blur-md"}`}
                aria-hidden={!showCash}
              >
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Cash Patients</span>
                  <span className="font-bold tabular-nums">{cashStats.cashPatients}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Active Packages</span>
                  <span className="font-bold tabular-nums">{cashStats.activePackages} / {cashStats.packagesSold}</span>
                </p>
                <div className="my-2 border-t border-[var(--line-soft)]" />
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Package Value</span>
                  <span className="font-bold tabular-nums">{formatMoney(cashStats.packageValue)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Collected</span>
                  <span className="font-bold tabular-nums text-emerald-700">{formatMoney(cashStats.packagePaid)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Outstanding</span>
                  <span className="font-bold tabular-nums text-[#c93b1d]">{formatMoney(cashStats.packageOutstanding)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Cash Payments</span>
                  <span className="font-bold tabular-nums text-emerald-700">{formatMoney(cashStats.cashCollected)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Total Collected</span>
                  <span className="font-bold tabular-nums text-emerald-700">{formatMoney(cashStats.totalCollected)}</span>
                </p>
              </div>
              {!showCash && (
                <button
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-white/60 text-sm font-semibold text-[var(--text-primary)] hover:bg-white/80"
                  onClick={() => setShowCash(true)}
                  type="button"
                >
                  Click to reveal
                </button>
              )}
            </div>
          </article>
        </section>

        <section className="panel-card p-4">
          <h4 className="text-lg font-semibold">Outstanding Balance</h4>
          {cashStats.outstandingList.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--text-muted)]">No outstanding package balances.</p>
          ) : (
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {cashStats.outstandingList.map((row) => (
                <li
                  key={row.pid}
                  className="flex justify-between gap-2 border-b border-[var(--line-soft)] py-1"
                >
                  <Link
                    className="truncate font-medium text-[var(--brand-primary)] hover:underline"
                    href={`/patients/${row.pid}`}
                  >
                    {row.name}
                  </Link>
                  <span className="font-semibold tabular-nums text-[#c93b1d]">{formatMoney(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <article className="panel-card overflow-hidden">
            <div className="border-b border-[var(--line-soft)] p-4">
              <h4 className="text-lg font-semibold">Imaging Referral Totals</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Counts use referral quantity (for example, one patient can have multiple X-rays).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-soft)] text-left text-sm">
                    <th className="px-4 py-3">Facility</th>
                    <th className="px-4 py-3">Cases</th>
                    <th className="px-4 py-3">X-Ray Referrals</th>
                    <th className="px-4 py-3">MRI Referrals</th>
                    <th className="px-4 py-3">Total Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {imagingFacilityStats.map((row) => (
                    <tr key={row.facility} className="border-t border-[var(--line-soft)]">
                      <td className="px-4 py-3 font-semibold">{row.facility}</td>
                      <td className="px-4 py-3">{row.cases}</td>
                      <td className="px-4 py-3">{row.xray}</td>
                      <td className="px-4 py-3">{row.mri}</td>
                      <td className="px-4 py-3">{row.total}</td>
                    </tr>
                  ))}
                  {imagingFacilityStats.length === 0 && (
                    <tr className="border-t border-[var(--line-soft)]">
                      <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={5}>
                        No imaging rows for selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel-card overflow-hidden">
            <div className="border-b border-[var(--line-soft)] p-4">
              <h4 className="text-lg font-semibold">Specialist Referral Totals</h4>
              <p className="text-sm text-[var(--text-muted)]">Case counts only.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-soft)] text-left text-sm">
                    <th className="px-4 py-3">Specialist</th>
                    <th className="px-4 py-3">Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {specialistReferralStats.map((row) => (
                    <tr key={row.specialist} className="border-t border-[var(--line-soft)]">
                      <td className="px-4 py-3 font-semibold">{row.specialist}</td>
                      <td className="px-4 py-3">{row.cases}</td>
                    </tr>
                  ))}
                  {specialistReferralStats.length === 0 && (
                    <tr className="border-t border-[var(--line-soft)]">
                      <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={2}>
                        No specialist rows for selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="panel-card overflow-hidden">
          <div className="border-b border-[var(--line-soft)] p-4">
            <h4 className="text-lg font-semibold">Attorney Performance</h4>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Click any column heading to sort by it; click again to reverse.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  {attorneyStatColumns.map((colId) => {
                    const sortIndex = attorneySortLevels.findIndex((l) => l.column === colId);
                    const sortLevel = sortIndex >= 0 ? attorneySortLevels[sortIndex] : null;
                    return (
                      <th key={colId} className="select-none px-4 py-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-semibold hover:text-[var(--brand-primary)]"
                          onClick={() => handleAttorneyColumnClick(colId)}
                          title="Click to sort by this column"
                        >
                          {attorneyStatLabels[colId]}
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {sortLevel ? (sortLevel.asc ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedAttorneyStats.map((row) => (
                  <tr key={row.attorney} className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-3 font-semibold">{row.attorney}</td>
                    <td className="px-4 py-3">{row.received}</td>
                    <td className="px-4 py-3">{row.active}</td>
                    <td className="px-4 py-3">{row.discharged}</td>
                    <td className="px-4 py-3">{row.readyToSubmit}</td>
                    <td className="px-4 py-3">{row.submitted}</td>
                    <td className="px-4 py-3">{row.dropped}</td>
                    <td className="px-4 py-3">{row.paid}</td>
                    <td className="px-4 py-3">{formatMonthsFromDays(row.avgTimeToRb)}</td>
                    <td className="px-4 py-3">{formatMonthsFromDays(row.avgTimeToPaid)}</td>
                    <td className="px-4 py-3">{row.percentPaid.toFixed(2)}%</td>
                  </tr>
                ))}
                {sortedAttorneyStats.length === 0 && (
                  <tr className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={11}>
                      No attorney stats for selected filters.
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

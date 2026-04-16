"use client";

import { useMemo, useState } from "react";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { patients } from "@/lib/mock-data";

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

function parseDaysFromMatrix(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
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
  // Live filters — every dropdown/search update applies immediately, no
  // Go button. Previously we had a draft/applied split gated behind GO;
  // that friction wasn't worth the re-render cost on a mock-data page.
  const [search, setSearch] = useState("");
  const [year, setYear] = useState<string>(getDefaultYear);
  const [attorney, setAttorney] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  // Billing Snapshot starts hidden so nothing sensitive is visible when
  // the page first opens — click to reveal.
  const [showBilling, setShowBilling] = useState(false);

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
    return ["ALL", ...Array.from(deduped.values())];
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

  // Billing data from patient matrix (Additional Details → $ Billed, $ Paid Amount)
  const billingData = useMemo(() => {
    let billedTotal = 0;
    let paidTotal = 0;
    let billedPaidCases = 0;
    let paidPaidCases = 0;

    filteredPatients.forEach((patient) => {
      const billed = parseDollar(patient.matrix?.billed);
      const paid = parseDollar(patient.matrix?.paidAmount);
      billedTotal += billed;
      paidTotal += paid;

      if (paid > 0 || patient.caseStatus === "Paid") {
        billedPaidCases += billed;
        paidPaidCases += paid;
      }
    });

    const paidRate = billedPaidCases === 0 ? 0 : (paidPaidCases / billedPaidCases) * 100;
    const avgBilled = filteredPatients.length ? billedTotal / filteredPatients.length : 0;
    const avgPaid = filteredPatients.length ? paidTotal / filteredPatients.length : 0;

    return { billedTotal, paidTotal, paidRate, avgBilled, avgPaid };
  }, [filteredPatients]);

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
      const itd = parseDaysFromMatrix(patient.matrix?.initialToDischarge);
      const dtr = parseDaysFromMatrix(patient.matrix?.dischargeToRb);
      const rtp = parseDaysFromMatrix(patient.matrix?.rbToPaid);
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

      // Billing from patient matrix
      row.billed += parseDollar(patient.matrix?.billed);
      row.collected += parseDollar(patient.matrix?.paidAmount);

      // Timeline from patient matrix
      const dtr = parseDaysFromMatrix(patient.matrix?.dischargeToRb);
      const rtp = parseDaysFromMatrix(patient.matrix?.rbToPaid);
      if (dtr !== null) row.timeToRbValues.push(dtr);
      if (rtp !== null) row.timeToPaidValues.push(rtp);
    });

    return Object.values(grouped)
      .map((row) => {
        const avgTimeToRb = average(row.timeToRbValues);
        const avgTimeToPaid = average(row.timeToPaidValues);
        const percentPaid = row.billed ? (row.collected / row.billed) * 100 : 0;
        return {
          ...row,
          avgTimeToRb,
          avgTimeToPaid,
          percentPaid,
        };
      })
      .sort((a, b) => b.received - a.received);
  }, [filteredPatients]);

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
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  <th className="px-4 py-3">Attorney</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Discharged</th>
                  <th className="px-4 py-3">Ready To Submit</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Dropped</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Avg. Time To R&amp;B</th>
                  <th className="px-4 py-3">Avg. Time To Paid</th>
                  <th className="px-4 py-3">% Paid</th>
                </tr>
              </thead>
              <tbody>
                {attorneyStats.map((row) => (
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
                {attorneyStats.length === 0 && (
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

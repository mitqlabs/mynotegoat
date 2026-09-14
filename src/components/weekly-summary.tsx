"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import {
  REVIEW_RECEIVED,
  REVIEW_REFRAIN,
  REVIEW_REQUESTED,
  isReadyToRequestReview,
  normalizeReviewStatus,
} from "@/lib/review-status";
import { patients } from "@/lib/mock-data";

/**
 * Weekly Summary for the Dashboard: what happened in one Monday–Sunday week,
 * plus the follow-up counts that matter right now. Built entirely from data
 * the app already loads (appointments, patients, billing) — nothing new is
 * stored.
 */

const DAY_MS = 86_400_000;



/** Local-midnight Date for an ISO (YYYY-MM-DD) or US (MM/DD/YYYY) string. */
function parseAnyDate(value: string | undefined | null): Date | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    return new Date(year, Number(us[1]) - 1, Number(us[2]));
  }
  return null;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - offset * DAY_MS);
}

function inRange(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= start.getTime() && t < end.getTime();
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Tile({
  label,
  value,
  tone = "",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
      <div className="text-xs font-semibold text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export function WeeklySummary() {
  const { scheduleAppointments } = useScheduleAppointments();
  const { recordsByPatientId } = usePatientBilling();
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, -1 = last week…

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const weekStart = useMemo(
    () => new Date(startOfWeek(today).getTime() + weekOffset * 7 * DAY_MS),
    [today, weekOffset],
  );
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * DAY_MS), [weekStart]);
  const nextWeekEnd = useMemo(() => new Date(weekEnd.getTime() + 7 * DAY_MS), [weekEnd]);

  const stats = useMemo(() => {
    const activePatients = patients.filter((p) => !p.deleted);
    const apptsInWeek = scheduleAppointments.filter((a) => inRange(parseAnyDate(a.date), weekStart, weekEnd));
    const count = (status: string) => apptsInWeek.filter((a) => a.status === status).length;

    // Visits that happened (date already passed) but are still Checked In,
    // i.e. the note hasn't been closed + checked out. All time, not per week.
    const waitingOnNotesAllTime = scheduleAppointments.filter((a) => {
      const d = parseAnyDate(a.date);
      return a.status === "Check In" && d !== null && d.getTime() < today.getTime();
    }).length;

    const scheduledNextWeek = scheduleAppointments.filter(
      (a) => a.status === "Scheduled" && inRange(parseAnyDate(a.date), weekEnd, nextWeekEnd),
    ).length;

    const newPatients = activePatients.filter((p) =>
      inRange(parseAnyDate(p.matrix?.initialExam), weekStart, weekEnd),
    ).length;
    const discharged = activePatients.filter((p) =>
      inRange(parseAnyDate(p.matrix?.discharge), weekStart, weekEnd),
    ).length;

    let paidTotal = 0;
    let paidCases = 0;
    for (const record of Object.values(recordsByPatientId)) {
      if (inRange(parseAnyDate(record.paidDate), weekStart, weekEnd) && record.paidAmount > 0) {
        paidTotal += record.paidAmount;
        paidCases += 1;
      }
    }

    return {
      completed: count("Check Out"),
      checkedIn: count("Check In"),
      canceled: count("Canceled"),
      scheduled: count("Scheduled"),
      waitingOnNotesAllTime,
      scheduledNextWeek,
      newPatients,
      discharged,
      paidTotal,
      paidCases,
    };
  }, [scheduleAppointments, recordsByPatientId, weekStart, weekEnd, nextWeekEnd, today]);

  const weekLabel =
    weekOffset === 0 ? "This week" : weekOffset === -1 ? "Last week" : `${shortDate(weekStart)} week`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-sm font-semibold"
          onClick={() => setWeekOffset((w) => w - 1)}
          type="button"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">
          {weekLabel} · {shortDate(weekStart)} – {shortDate(new Date(weekEnd.getTime() - DAY_MS))}
        </span>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-sm font-semibold disabled:opacity-40"
          disabled={weekOffset >= 0}
          onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
          type="button"
        >
          ›
        </button>
        {weekOffset !== 0 && (
          <button
            className="text-xs font-semibold text-[var(--brand-primary)] underline"
            onClick={() => setWeekOffset(0)}
            type="button"
          >
            Back to this week
          </button>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Visits</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Checked out" tone="text-[#047857]" value={stats.completed} />
          <Tile label="Checked in (note open)" tone="text-[#0d79bf]" value={stats.checkedIn} />
          <Tile label="Canceled" tone="text-[#b43b34]" value={stats.canceled} />
          <Tile label="Still scheduled" value={stats.scheduled} />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Patients &amp; payments</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="New patients" hint="Initial exam this week" value={stats.newPatients} />
          <Tile label="Discharged" hint="Discharge date this week" value={stats.discharged} />
          <Tile
            label="Payments received"
            hint={`${stats.paidCases} case${stats.paidCases === 1 ? "" : "s"} paid`}
            tone="text-[#047857]"
            value={stats.paidTotal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          />
          <Tile label="Scheduled next week" value={stats.scheduledNextWeek} />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Needs follow-up (right now)</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            hint="Past visits still Checked In"
            label="Visits waiting on notes"
            tone={stats.waitingOnNotesAllTime > 0 ? "text-[#b43b34]" : ""}
            value={stats.waitingOnNotesAllTime}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Reviews section for the Dashboard: where review follow-up stands right now.
 * Stored review values can be legacy capitals ("REQUESTED"), so compare
 * case-insensitively.
 */
export function ReviewsSummary() {
  const counts = useMemo(() => {
    const pi = patients.filter((p) => !p.deleted && !p.isCashPatient);
    const status = (p: (typeof pi)[number]) => normalizeReviewStatus(p.matrix?.review);
    return {
      toRequest: pi.filter((p) => isReadyToRequestReview(p.caseStatus, p.matrix?.review)).length,
      requested: pi.filter((p) => status(p) === REVIEW_REQUESTED).length,
      received: pi.filter((p) => status(p) === REVIEW_RECEIVED).length,
      refrain: pi.filter((p) => status(p) === REVIEW_REFRAIN).length,
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile hint="Not Active or Dropped, not yet asked" label="To request" value={counts.toRequest} />
        <Tile hint="Waiting on the review" label="Requested" tone="text-amber-700" value={counts.requested} />
        <Tile label="Received" tone="text-[#047857]" value={counts.received} />
        <Tile hint="Not asking these patients" label={REVIEW_REFRAIN} tone="text-slate-500" value={counts.refrain} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        On the{" "}
        <Link className="font-semibold text-[var(--brand-primary)] underline" href="/patients">
          Patients
        </Link>{" "}
        page, set Review to <strong>To Request</strong> to work through who to ask, or <strong>Requested</strong> to mark
        reviews as Received.
      </p>
    </div>
  );
}

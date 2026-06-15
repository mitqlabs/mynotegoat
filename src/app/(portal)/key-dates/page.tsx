"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useKeyDateDismissals } from "@/hooks/use-key-date-dismissals";
import { useCloudKeyDates } from "@/hooks/use-cloud-key-dates";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { patients } from "@/lib/mock-data";
import {
  findKeyDatesForDate,
  formatKeyDateRange,
  formatUsDateFromIso,
  type KeyDateOfficeStatus,
  type KeyDateRecord,
} from "@/lib/key-dates";
import { formatTimeLabel, type ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { UsDateInput } from "@/components/us-date-input";

type KeyDateDraft = {
  startDate: string;
  endDate: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
  isRange: boolean;
};

type ConflictRow = {
  appointment: ScheduleAppointmentRecord;
  matches: KeyDateRecord[];
  hasClosedDate: boolean;
};

function toIsoFromUsDate(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = `${month}`.padStart(2, "0");
  const dd = `${day}`.padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function createDraft(): KeyDateDraft {
  return {
    startDate: "",
    endDate: "",
    officeStatus: "Closed",
    reason: "",
    isRange: false,
  };
}

function compareConflictRows(left: ConflictRow, right: ConflictRow) {
  const leftKey = `${left.appointment.date} ${left.appointment.startTime}`;
  const rightKey = `${right.appointment.date} ${right.appointment.startTime}`;
  return leftKey.localeCompare(rightKey);
}

export default function KeyDatesPage() {
  const { keyDates, addKeyDate, updateKeyDate, removeKeyDate, isLoading } = useCloudKeyDates();
  const { scheduleAppointments, removeAppointment } = useScheduleAppointments();
  const { dismissals, dismissAppointment, restoreAppointment } = useKeyDateDismissals();
  const [showDismissed, setShowDismissed] = useState(false);

  const [draft, setDraft] = useState<KeyDateDraft>(() => createDraft());
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Inline delete confirmation. The previous implementation used
  // window.confirm, but Chrome / Safari can suppress those dialogs
  // entirely (per-site "Block dialogs" toggle, or after the user has
  // dismissed too many). A blocked confirm returns undefined → the
  // `if (confirm(...))` short-circuits and the Delete button looks
  // dead. Two-click inline confirm is browser-proof.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const allWarningRows = useMemo(() => {
    const rows: ConflictRow[] = [];
    scheduleAppointments.forEach((appointment) => {
      const matches = findKeyDatesForDate(keyDates, appointment.date);
      if (!matches.length) {
        return;
      }
      rows.push({
        appointment,
        matches,
        hasClosedDate: matches.some((entry) => entry.officeStatus === "Closed"),
      });
    });
    return rows.sort(compareConflictRows);
  }, [keyDates, scheduleAppointments]);

  // Rows not yet dismissed are what the user sees by default. Dismissed
  // rows are tucked away behind a "Show N cleared" toggle so the user
  // can un-dismiss one if they change their mind.
  const warningRows = useMemo(
    () => allWarningRows.filter((row) => !dismissals.has(row.appointment.id)),
    [allWarningRows, dismissals],
  );
  const dismissedRows = useMemo(
    () => allWarningRows.filter((row) => dismissals.has(row.appointment.id)),
    [allWarningRows, dismissals],
  );

  const closedWarnings = warningRows.filter((row) => row.hasClosedDate);
  const coveredWarnings = warningRows.filter((row) => !row.hasClosedDate);

  const patientIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patients) {
      if (!patient.deleted) {
        map.set(patient.fullName.toLowerCase(), patient.id);
      }
    }
    return map;
  }, []);

  const resolvePatientId = (appointment: ScheduleAppointmentRecord): string | null => {
    if (appointment.patientId) return appointment.patientId;
    return patientIdByName.get(appointment.patientName.toLowerCase()) ?? null;
  };

  const handleDeleteAppointment = (appointment: ScheduleAppointmentRecord) => {
    const confirmed = window.confirm(
      `Delete ${appointment.patientName}'s ${appointment.appointmentType} on ${formatUsDateFromIso(appointment.date)}?\n\n` +
        "This removes the appointment globally — it will no longer appear on the patient file, schedule, or dashboard.",
    );
    if (!confirmed) return;
    removeAppointment(appointment.id);
    // The row disappears automatically once scheduleAppointments updates,
    // but tidy up any stale dismissal just in case.
    restoreAppointment(appointment.id);
  };

  const startEditing = (row: KeyDateRecord) => {
    setEditingId(row.id);
    setFormError("");
    const isRange = row.startDate !== row.endDate;
    setDraft({
      startDate: formatUsDateFromIso(row.startDate),
      endDate: isRange ? formatUsDateFromIso(row.endDate) : "",
      officeStatus: row.officeStatus,
      reason: row.reason,
      isRange,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormError("");
    setDraft(createDraft());
  };

  const submitForm = async () => {
    const startDate = toIsoFromUsDate(draft.startDate);
    if (!startDate) {
      setFormError("Enter Date as MM/DD/YYYY.");
      return;
    }

    const endInput = draft.isRange ? draft.endDate : draft.startDate;
    const endDate = toIsoFromUsDate(endInput);
    if (!endDate) {
      setFormError("Enter Date Range as MM/DD/YYYY.");
      return;
    }

    const payload = {
      startDate,
      endDate,
      officeStatus: draft.officeStatus,
      reason: draft.reason,
    } as const;

    try {
      if (!editingId) {
        const result = await addKeyDate(payload);
        if (!result.added) {
          setFormError(result.reason ?? "Could not add key date.");
          return;
        }
        resetForm();
        return;
      }

      const result = await updateKeyDate(editingId, payload);
      if (!result.updated) {
        setFormError(result.reason ?? "Could not update key date.");
        return;
      }
      resetForm();
    } catch (err) {
      // Cloud write failed (network, RLS, etc.). Surface explicitly
      // so the user can retry — never silently drop a save.
      setFormError(
        `Cloud save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Key Dates</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Track office closure/coverage dates and prevent accidental scheduling on closed days.
            </p>
          </div>
          <div className="grid gap-2 text-right text-sm">
            <p>
              <span className="font-semibold text-[#b43b34]">{closedWarnings.length}</span> Closed-date conflicts
            </p>
            <p>
              <span className="font-semibold text-[#0d79bf]">{coveredWarnings.length}</span> Covered-date appointments
            </p>
          </div>
        </div>
      </section>

      <form className="panel-card p-4" onSubmit={(e) => { e.preventDefault(); void submitForm(); }}>
        <h4 className="text-lg font-semibold">{editingId ? "Edit Key Date" : "Add Key Date"}</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Date *</span>
            <UsDateInput
              className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(formatted) =>
                setDraft((current) => ({ ...current, startDate: formatted }))
              }
              value={draft.startDate}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Date Range End</span>
            <UsDateInput
              className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
              disabled={!draft.isRange}
              onChange={(formatted) =>
                setDraft((current) => ({ ...current, endDate: formatted }))
              }
              placeholder={draft.isRange ? "MM/DD/YYYY" : "Enable range below"}
              value={draft.isRange ? draft.endDate : ""}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Office Status *</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setDraft((current) => ({ ...current, officeStatus: event.target.value as KeyDateOfficeStatus }))
              }
              value={draft.officeStatus}
            >
              <option value="Closed">Closed</option>
              <option value="Covered">Covered</option>
            </select>
          </label>

          <label className="grid gap-1 xl:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Reason</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Vacation, holiday, conference, etc."
              value={draft.reason}
            />
          </label>
        </div>

        <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
          <input
            checked={draft.isRange}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                isRange: event.target.checked,
                // Preserve whatever the user previously typed; never mirror startDate
              }))
            }
            type="checkbox"
          />
          Use date range
        </label>

        {formError && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{formError}</p>}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {editingId && (
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={resetForm}
              type="button"
            >
              Cancel Edit
            </button>
          )}
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
            type="submit"
          >
            {editingId ? "Save Key Date" : "Add Key Date"}
          </button>
        </div>
      </form>

      <section className="panel-card overflow-hidden">
        <div className="border-b border-[var(--line-soft)] px-4 py-3">
          <h4 className="text-lg font-semibold">Configured Key Dates</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Reason</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keyDates.map((row) => (
                <tr key={row.id} className="border-t border-[var(--line-soft)]">
                  <td className="px-4 py-3">{formatKeyDateRange(row)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.officeStatus === "Closed"
                          ? "bg-[rgba(201,66,58,0.15)] text-[#b43b34]"
                          : "bg-[rgba(13,121,191,0.12)] text-[#0d79bf]"
                      }`}
                    >
                      {row.officeStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.reason || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] px-3 py-1 font-semibold"
                        onClick={() => startEditing(row)}
                        type="button"
                      >
                        Edit
                      </button>
                      {pendingDeleteId === row.id ? (
                        <>
                          <button
                            className="rounded-lg bg-[#b43b34] px-3 py-1 font-semibold text-white"
                            onClick={() => {
                              void removeKeyDate(row.id);
                              setPendingDeleteId(null);
                            }}
                            type="button"
                          >
                            Confirm Delete
                          </button>
                          <button
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 font-semibold"
                            onClick={() => setPendingDeleteId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="rounded-lg border border-[rgba(201,66,58,0.4)] bg-[rgba(201,66,58,0.08)] px-3 py-1 font-semibold text-[#b43b34]"
                          onClick={() => setPendingDeleteId(row.id)}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {keyDates.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-[var(--text-muted)]" colSpan={4}>
                    {isLoading ? "Loading key dates from cloud..." : "No key dates yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card overflow-hidden">
        <div className="border-b border-[var(--line-soft)] px-4 py-3">
          <h4 className="text-lg font-semibold">Warning List: Appointments On Key Dates</h4>
          <p className="text-sm text-[var(--text-muted)]">
            Use this to catch migration mistakes where appointments landed on office key dates.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Patient</th>
                <th className="px-4 py-3 font-semibold">Appointment</th>
                <th className="px-4 py-3 font-semibold">Key Date Status</th>
                <th className="px-4 py-3 font-semibold">Key Date Reason</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {warningRows.map((row) => {
                const keyStatusLabel = row.matches.map((entry) => entry.officeStatus).join(", ");
                const reasonLabel = row.matches
                  .map((entry) =>
                    `${entry.reason || "No reason"} (${formatKeyDateRange({
                      startDate: entry.startDate,
                      endDate: entry.endDate,
                    })})`,
                  )
                  .join("; ");
                const patientId = resolvePatientId(row.appointment);
                return (
                  <tr key={`warning-${row.appointment.id}`} className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-3">{formatUsDateFromIso(row.appointment.date)}</td>
                    <td className="px-4 py-3">{formatTimeLabel(row.appointment.startTime)}</td>
                    <td className="px-4 py-3 font-semibold">{row.appointment.patientName}</td>
                    <td className="px-4 py-3">{row.appointment.appointmentType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.hasClosedDate
                            ? "bg-[rgba(201,66,58,0.15)] text-[#b43b34]"
                            : "bg-[rgba(13,121,191,0.12)] text-[#0d79bf]"
                        }`}
                      >
                        {keyStatusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">{reasonLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                          onClick={() => dismissAppointment(row.appointment.id)}
                          title="Hide this appointment from the warnings list. The appointment itself stays on the schedule."
                          type="button"
                        >
                          Clear
                        </button>
                        {patientId ? (
                          <Link
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold text-[var(--brand-primary)]"
                            href={`/patients/${patientId}`}
                          >
                            Open
                          </Link>
                        ) : (
                          <span
                            className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)]"
                            title="Can't find a matching patient record for this appointment"
                          >
                            Open
                          </span>
                        )}
                        {row.hasClosedDate && (
                          <button
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                            onClick={() => handleDeleteAppointment(row.appointment)}
                            title="Delete this appointment globally (schedule, patient file, dashboard, billing)"
                            type="button"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {warningRows.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-[var(--text-muted)]" colSpan={7}>
                    No appointments currently fall on key dates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {dismissedRows.length > 0 && (
          <div className="mt-4">
            <button
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold"
              onClick={() => setShowDismissed((v) => !v)}
              type="button"
            >
              {showDismissed ? "Hide" : "Show"} {dismissedRows.length} cleared warning{dismissedRows.length === 1 ? "" : "s"}
            </button>
            {showDismissed && (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-[720px] w-full text-xs">
                  <thead className="bg-[var(--bg-soft)] text-left text-[var(--text-muted)]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Date</th>
                      <th className="px-3 py-2 font-semibold">Time</th>
                      <th className="px-3 py-2 font-semibold">Patient</th>
                      <th className="px-3 py-2 font-semibold">Appointment</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dismissedRows.map((row) => (
                      <tr key={`cleared-${row.appointment.id}`} className="border-t border-[var(--line-soft)] text-[var(--text-muted)]">
                        <td className="px-3 py-2">{formatUsDateFromIso(row.appointment.date)}</td>
                        <td className="px-3 py-2">{formatTimeLabel(row.appointment.startTime)}</td>
                        <td className="px-3 py-2">{row.appointment.patientName}</td>
                        <td className="px-3 py-2">{row.appointment.appointmentType}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                            onClick={() => restoreAppointment(row.appointment.id)}
                            type="button"
                          >
                            Un-clear
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

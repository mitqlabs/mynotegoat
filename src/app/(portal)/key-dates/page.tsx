"use client";

import { TimeInput12h } from "@/components/time-input-12h";

import { ensureDeleteAllowed } from "@/lib/delete-guard";
import { logActivity } from "@/lib/activity-log";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useKeyDateDismissals } from "@/hooks/use-key-date-dismissals";
import { useCloudKeyDates } from "@/hooks/use-cloud-key-dates";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useCashPayments } from "@/hooks/use-cash-payments";
import { patients } from "@/lib/mock-data";
import {
  findKeyDatesForDate,
  formatKeyDateHours,
  isTimeWithinHours,
  keyDateHasHours,
  normalizeKeyDateTime,
  formatKeyDateRange,
  formatUsDateFromIso,
  dismissalsToResetForClosure,
  summarizeKeyDateBookings,
  type KeyDateOfficeStatus,
  type KeyDateRecord,
} from "@/lib/key-dates";
import { formatTimeLabel, type ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { UsDateInput } from "@/components/us-date-input";
import { appConfirm } from "@/components/app-dialog";

type KeyDateDraft = {
  startDate: string;
  endDate: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
  isRange: boolean;
  /** Special hours ("HH:MM"); blank = whole day. */
  openStart: string;
  openEnd: string;
};

/** Is this visit outside a key date's special hours? */
function outsideHours(entry: KeyDateRecord, time: string) {
  return keyDateHasHours(entry) && !isTimeWithinHours(time, { start: normalizeKeyDateTime(entry.openStart), end: normalizeKeyDateTime(entry.openEnd) });
}

/** Settings → Text Reminders, prefilled with a closure text for this key date. */
function closureMessageHref(row: KeyDateRecord) {
  const q = new URLSearchParams({ section: "textReminders", msgDate: row.startDate });
  const end = normalizeKeyDateTime(row.openEnd);
  const start = normalizeKeyDateTime(row.openStart);
  // Visits after closing time (the common "closing early" case); otherwise
  // the ones before opening.
  if (end) q.set("msgStart", end);
  else if (start) q.set("msgEnd", start);
  const hours = formatKeyDateHours(row).replace(/^Open/, "open");
  q.set(
    "msgText",
    `Our office is ${row.officeStatus === "Closed" ? "closing early" : "on special hours"} on ${formatUsDateFromIso(row.startDate)} (${hours}). We'll call you to reschedule your appointment.`,
  );
  return `/settings?${q.toString()}`;
}

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
    openStart: "",
    openEnd: "",
  };
}

function compareConflictRows(left: ConflictRow, right: ConflictRow) {
  const leftKey = `${left.appointment.date} ${left.appointment.startTime}`;
  const rightKey = `${right.appointment.date} ${right.appointment.startTime}`;
  return leftKey.localeCompare(rightKey);
}

export default function KeyDatesPage() {
  const { keyDates, addKeyDate, updateKeyDate, removeKeyDate, isLoading } = useCloudKeyDates();
  const { scheduleAppointments, removeAppointment, updateAppointment } = useScheduleAppointments();
  const { encountersByNewest, deleteEncounter } = useEncounterNotes();
  const { updatePatientPayments } = useCashPayments();
  const { dismissals, dismissAppointment, restoreAppointment } = useKeyDateDismissals();
  const [showDismissed, setShowDismissed] = useState(false);

  const [draft, setDraft] = useState<KeyDateDraft>(() => createDraft());
  const [formError, setFormError] = useState("");
  // Shown after a save: what the status means for the visits already booked.
  const [formNotice, setFormNotice] = useState("");
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
      // A visit that already happened, or that is already called off, is not a
      // conflict to resolve — it is history. Half-day holidays are the common
      // case: the office is marked Closed, but a few patients were still seen
      // and checked out. Those rows only ever needed clearing because they
      // should not have appeared. Canceled is the same story from the other
      // direction: the appointment is already off the books.
      if (
        appointment.status === "Check Out" ||
        appointment.status === "Canceled" ||
        appointment.status === "No Show"
      ) {
        return;
      }
      // OPEN key dates are normal days — never a conflict to resolve.
      // Key dates WITH special hours only flag visits outside those hours
      // (inside them it's a normal visit, whatever the status).
      const matches = findKeyDatesForDate(keyDates, appointment.date).filter((entry) =>
        keyDateHasHours(entry) ? outsideHours(entry, appointment.startTime) : entry.officeStatus !== "Open",
      );
      if (!matches.length) {
        return;
      }
      rows.push({
        appointment,
        matches,
        hasClosedDate: matches.some((entry) => entry.officeStatus === "Closed" || keyDateHasHours(entry)),
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
  // Clicking the Appointments count on a Configured Key Date narrows the
  // warning list below to just that date. null = show everything.
  const [focusedKeyDateId, setFocusedKeyDateId] = useState<string | null>(null);
  const visibleDismissedRows = useMemo(
    () => (focusedKeyDateId ? dismissedRows.filter((row) => row.matches.some((m) => m.id === focusedKeyDateId)) : dismissedRows),
    [dismissedRows, focusedKeyDateId],
  );

  // Two-click inline confirm for Cancel, same reason as the Delete one above:
  // browsers can suppress window.confirm entirely, which made the button look
  // dead. Also the visible result banner — cancelling used to change the
  // appointment silently and leave the row looking identical, so it read as
  // "nothing happened" even though it had worked.
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState("");

  // How many outstanding warnings each configured key date accounts for.
  // Counted off warningRows (undismissed) so the number matches what the list
  // below actually shows, and drops to 0 as they are cleared.
  const warningCountByKeyDateId = useMemo(() => {
    const counts = new Map<string, number>();
    warningRows.forEach((row) => {
      row.matches.forEach((match) => {
        counts.set(match.id, (counts.get(match.id) ?? 0) + 1);
      });
    });
    return counts;
  }, [warningRows]);

  const focusedKeyDate = focusedKeyDateId
    ? keyDates.find((entry) => entry.id === focusedKeyDateId) ?? null
    : null;

  // The list honours the focus filter; if the focused date's warnings all get
  // cleared the filter simply yields an empty list, which reads correctly.
  const visibleWarningRows = useMemo(
    () =>
      focusedKeyDateId
        ? warningRows.filter((row) => row.matches.some((m) => m.id === focusedKeyDateId))
        : warningRows,
    [focusedKeyDateId, warningRows],
  );

  // The REAL number of visits on each key date (single day or range) —
  // independent of "Clear", which only hides a row from the warning list.
  const bookingsByKeyDateId = useMemo(
    () => summarizeKeyDateBookings(keyDates, scheduleAppointments, dismissals),
    [keyDates, scheduleAppointments, dismissals],
  );

  // Upcoming full-day closures that still have patients booked. Never hidden
  // by "Clear": these are the days where reminders are blocked and patients
  // may still be planning to come in.
  const closedWithBookings = useMemo(() => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return keyDates
      .filter((row) => row.officeStatus === "Closed" && !keyDateHasHours(row) && row.endDate >= todayIso)
      .map((row) => ({ row, booked: bookingsByKeyDateId.get(row.id)?.booked ?? 0 }))
      .filter((entry) => entry.booked > 0)
      .sort((a, b) => a.row.startDate.localeCompare(b.row.startDate));
  }, [keyDates, bookingsByKeyDateId]);

  const closedWarnings = warningRows.filter((row) => row.hasClosedDate);
  const coveredWarnings = warningRows.filter((row) => !row.hasClosedDate);

  const patientIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patients) {
      if (!patient.deleted) {
        map.set(patient.fullName.toLowerCase(), patient.id);
      }
    }
    // `patients` is a module-scope import, not reactive state, so it is
    // deliberately not a dependency here.
    return map;
  }, []);

  const resolvePatientId = (appointment: ScheduleAppointmentRecord): string | null => {
    if (appointment.patientId) return appointment.patientId;
    return patientIdByName.get(appointment.patientName.toLowerCase()) ?? null;
  };

  // Cancel an appointment that collides with a Closed/Covered key date (Open
  // key dates never produce a warning row, so they never offer this), and
  // (optionally) delete any encounter charted for that day so a closed day is
  // left with no visit note. The appointment stays on record as "Canceled"
  // (not deleted). Encounter removal reuses the same delete + cash-payment
  // cascade the patient file uses, and is always gated behind a confirm.
  const handleCancelAppointment = async (appointment: ScheduleAppointmentRecord) => {
    const dateLabel = formatUsDateFromIso(appointment.date);
    // A visit the patient actually attended is history, not something to call
    // off. Cancel is for appointments that never happened.
    if (appointment.status === "Check Out") {
      setActionNotice(
        `${appointment.patientName}'s appointment on ${dateLabel} is already Checked Out — a completed visit can't be canceled.`,
      );
      return;
    }
    updateAppointment(appointment.id, (current) => ({ ...current, status: "Canceled" }));
    setActionNotice(
      `${appointment.patientName}'s appointment on ${dateLabel} is now Canceled. It stays on the schedule and the patient file so you can see it was there.`,
    );
    restoreAppointment(appointment.id);
    const patientId = resolvePatientId(appointment);
    const linkedEncounter = encountersByNewest.find(
      (entry) => entry.patientId === patientId && entry.encounterDate === dateLabel,
    );
    if (linkedEncounter) {
      const chargeCount = linkedEncounter.charges.length;
      const removeEncounter = (await appConfirm(`${appointment.patientName}'s appointment on ${dateLabel} is now Canceled.\n\n` +
                `An encounter${linkedEncounter.signed ? " (CLOSED)" : ""} also exists for that day${
                  chargeCount > 0 ? ` with ${chargeCount} charge${chargeCount === 1 ? "" : "s"}` : ""
                }.\n\n` +
                `Click OK to DELETE that encounter (and any charges) too.\n` +
                `Click Cancel to keep the encounter.`));
      if (removeEncounter) {
        deleteEncounter(linkedEncounter.id);
        updatePatientPayments(linkedEncounter.patientId ?? patientId ?? "", (current) =>
          current.filter((entry) => entry.encounterId !== linkedEncounter.id),
        );
      }
    }
  };

  const handleDeleteAppointment = async (appointment: ScheduleAppointmentRecord) => {
    const confirmed = (await appConfirm(`Delete ${appointment.patientName}'s ${appointment.appointmentType} on ${formatUsDateFromIso(appointment.date)}?\n\n` +
            "This removes the appointment globally — it will no longer appear on the patient file, schedule, or dashboard."));
    if (!confirmed) return;
    if (!(await ensureDeleteAllowed("appointments"))) return;
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
      openStart: row.openStart ?? "",
      openEnd: row.openEnd ?? "",
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
      openStart: draft.openStart,
      openEnd: draft.openEnd,
    } as const;
    if (draft.openStart && draft.openEnd && draft.openEnd <= draft.openStart) {
      setFormError("The closing time must be after the opening time.");
      return;
    }

    // After a successful save: forget old "Clear"s on a day that is now fully
    // Closed (they were made when it was Covered) and say what happens next.
    const afterSave = () => {
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const toReset = dismissalsToResetForClosure(payload, scheduleAppointments, dismissals, todayIso);
      toReset.forEach((id) => restoreAppointment(id));
      const booked = scheduleAppointments.filter(
        (a) => a.status !== "Canceled" && a.status !== "No Show" && a.date >= startDate && a.date <= endDate,
      ).length;
      const when = startDate === endDate ? formatUsDateFromIso(startDate) : `${formatUsDateFromIso(startDate)} – ${formatUsDateFromIso(endDate)}`;
      if (payload.officeStatus === "Closed" && !payload.openStart && !payload.openEnd) {
        setFormNotice(
          booked > 0
            ? `${when} is Closed: no text reminders will go out for it. ${booked} appointment${booked === 1 ? " is" : "s are"} still booked — cancel or reschedule them below. Reminders already sent can't be recalled.`
            : `${when} is Closed: no text reminders will go out for it.`,
        );
      } else if (payload.officeStatus === "Covered") {
        setFormNotice(
          `${when} is Covered, not Closed: visits stay bookable and text reminders STILL go out. Choose Closed if the office is shut and patients should not be reminded.`,
        );
      } else {
        setFormNotice("");
      }
    };

    try {
      if (!editingId) {
        const result = await addKeyDate(payload);
        if (!result.added) {
          setFormError(result.reason ?? "Could not add key date.");
          return;
        }
        resetForm();
        afterSave();
        return;
      }

      const result = await updateKeyDate(editingId, payload);
      if (!result.updated) {
        setFormError(result.reason ?? "Could not update key date.");
        return;
      }
      resetForm();
      afterSave();
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
        <div className="flex flex-wrap items-start justify-end gap-3">
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
              <option value="Open">Open</option>
            </select>
            <span className="text-xs text-[var(--text-muted)]">
              {draft.officeStatus === "Closed"
                ? "Closed: no scheduling, and NO text reminders for that day."
                : draft.officeStatus === "Covered"
                  ? "Covered: someone covers. Still bookable; text reminders STILL go out."
                  : "Open: a normal working day."}
            </span>
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

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Open from (optional)</span>
            <TimeInput12h
              allowEmpty
              smart
              ariaLabel="Open from"
              inputClassName="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(v) => setDraft((current) => ({ ...current, openStart: v }))}
              value={draft.openStart}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Open until (optional)</span>
            <TimeInput12h
              allowEmpty
              smart
              ariaLabel="Open until"
              inputClassName="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(v) => setDraft((current) => ({ ...current, openEnd: v }))}
              value={draft.openEnd}
            />
          </label>
          <p className="self-end text-sm text-[var(--text-muted)] md:col-span-2 xl:col-span-3">
            Leave blank for the whole day. With hours, a Closed date becomes a partial day (e.g. open until 2:00 PM):
            visits inside the hours stay, visits outside are flagged below and get no text reminders.
          </p>
        </div>

        {formError && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{formError}</p>}
        {formNotice && !formError && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{formNotice}</p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {editingId && (
            <button
              className="btn btn-secondary"
              onClick={resetForm}
              type="button"
            >
              Cancel Edit
            </button>
          )}
          <button
            className="btn btn-primary"
            type="submit"
          >
            {editingId ? "Save Key Date" : "Add Key Date"}
          </button>
        </div>
      </form>

      {closedWithBookings.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">Closed days that still have patients booked</p>
          <ul className="mt-1 list-disc pl-5">
            {closedWithBookings.map(({ row, booked }) => (
              <li key={row.id}>
                {formatKeyDateRange(row)}
                {row.reason ? ` (${row.reason})` : ""}: {booked} appointment{booked === 1 ? "" : "s"} booked. Text reminders are blocked for this day, so cancel or reschedule these visits, or message the patients.
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <th className="px-4 py-3 font-semibold">Appointments</th>
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
                          : row.officeStatus === "Open"
                            ? "bg-[rgba(46,155,93,0.14)] text-[#257a49]"
                            : "bg-[rgba(13,121,191,0.12)] text-[#0d79bf]"
                      }`}
                    >
                      {row.officeStatus}
                    </span>
                    {keyDateHasHours(row) && (
                      <span className="ml-2 text-xs font-semibold text-[var(--text-muted)]">{formatKeyDateHours(row)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{row.reason || "-"}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const { booked, cleared } = bookingsByKeyDateId.get(row.id) ?? { booked: 0, cleared: 0 };
                      if (booked === 0) {
                        return <span className="text-xs text-[var(--text-muted)]">None</span>;
                      }
                      const label = `${booked} appointment${booked === 1 ? "" : "s"}`;
                      const note = cleared > 0 ? <span className="ml-2 text-xs text-[var(--text-muted)]">{cleared} cleared</span> : null;
                      // An Open day is a normal day: just the number, no warning.
                      if (row.officeStatus === "Open" && !keyDateHasHours(row)) {
                        return <span className="text-xs font-semibold text-[var(--text-muted)]">{label}</span>;
                      }
                      const isFocused = focusedKeyDateId === row.id;
                      const closed = row.officeStatus === "Closed" && !keyDateHasHours(row);
                      return (
                        <>
                          <button
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                              isFocused
                                ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                                : closed
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                            onClick={() => {
                              setFocusedKeyDateId(isFocused ? null : row.id);
                              if (!isFocused && cleared > 0) setShowDismissed(true);
                            }}
                            title={
                              isFocused
                                ? "Showing only this date's appointments — click to show all"
                                : "Show only this date's appointments in the warning list below"
                            }
                            type="button"
                          >
                            {label}
                            {closed ? " · closed" : ""}
                          </button>
                          {note}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {keyDateHasHours(row) && row.startDate === row.endDate && (warningCountByKeyDateId.get(row.id) ?? 0) > 0 && (
                        <Link
                          className="rounded-lg border border-[var(--line-soft)] px-3 py-1 font-semibold text-[var(--brand-primary)]"
                          href={closureMessageHref(row)}
                          title="Open Message patients with a closure text for the visits outside these hours"
                        >
                          Text affected patients
                        </Link>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
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
                              void (async () => {
                                if (!(await ensureDeleteAllowed("keyDates"))) return;
                                await removeKeyDate(row.id);
                                setPendingDeleteId(null);
                                logActivity({
                                  category: "keyDates",
                                  action: "keyDate.deleted",
                                  summary: `Deleted key date ${row.startDate}${row.endDate && row.endDate !== row.startDate ? ` – ${row.endDate}` : ""} (${row.reason || row.officeStatus})`,
                                });
                              })();
                            }}
                            type="button"
                          >
                            Confirm Delete
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
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
          <h4 className="text-lg font-semibold">
            Warning List: Appointments On Key Dates
            {focusedKeyDate ? ` — ${formatKeyDateRange(focusedKeyDate)}` : ""}
          </h4>
          {focusedKeyDate ? (
            <p className="text-sm text-[var(--text-muted)]">
              Showing only {focusedKeyDate.reason || "this key date"}.{" "}
              <button
                className="font-semibold text-[var(--brand-primary)] underline"
                onClick={() => setFocusedKeyDateId(null)}
                type="button"
              >
                Show all key dates
              </button>
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Use this to catch migration mistakes where appointments landed on office key dates.
              Click an Appointments count above to narrow this to one date.
            </p>
          )}
        </div>

        {actionNotice && (
          <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="flex-1">{actionNotice}</span>
            <button
              className="font-semibold text-amber-800 underline"
              onClick={() => setActionNotice("")}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

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
              {visibleWarningRows.map((row) => {
                const keyStatusLabel = row.matches
                  .map((entry) => (keyDateHasHours(entry) ? `Outside hours (${formatKeyDateHours(entry)})` : entry.officeStatus))
                  .join(", ");
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
                          className="btn btn-secondary btn-sm"
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
                        {row.appointment.status === "Check Out" ? (
                          <span
                            className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)]"
                            title="This visit was completed — a checked-out appointment can't be canceled."
                          >
                            Checked Out
                          </span>
                        ) : pendingCancelId === row.appointment.id ? (
                          <>
                            <button
                              className="rounded-lg border border-amber-300 bg-amber-500 px-2 py-1 text-xs font-semibold text-white"
                              onClick={() => {
                                handleCancelAppointment(row.appointment);
                                setPendingCancelId(null);
                              }}
                              type="button"
                            >
                              Confirm Cancel
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setPendingCancelId(null)}
                              type="button"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700"
                            onClick={() => setPendingCancelId(row.appointment.id)}
                            title="Mark this appointment Canceled. It stays on record so you can see it was there."
                            type="button"
                          >
                            Cancel Appointment
                          </button>
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
              {visibleWarningRows.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-[var(--text-muted)]" colSpan={7}>
                    No appointments currently fall on key dates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {visibleDismissedRows.length > 0 && (
          <div className="mt-4">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowDismissed((v) => !v)}
              type="button"
            >
              {showDismissed ? "Hide" : "Show"} {visibleDismissedRows.length} cleared warning{visibleDismissedRows.length === 1 ? "" : "s"}
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
                    {visibleDismissedRows.map((row) => (
                      <tr key={`cleared-${row.appointment.id}`} className="border-t border-[var(--line-soft)] text-[var(--text-muted)]">
                        <td className="px-3 py-2">{formatUsDateFromIso(row.appointment.date)}</td>
                        <td className="px-3 py-2">{formatTimeLabel(row.appointment.startTime)}</td>
                        <td className="px-3 py-2">{row.appointment.patientName}</td>
                        <td className="px-3 py-2">{row.appointment.appointmentType}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="btn btn-secondary btn-sm"
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

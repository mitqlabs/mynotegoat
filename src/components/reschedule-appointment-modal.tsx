"use client";

import { useEffect, useMemo, useState } from "react";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useKeyDates } from "@/hooks/use-key-dates";
import {
  findClosedKeyDateForDate,
  formatUsDateFromIso,
} from "@/lib/key-dates";
import {
  createAppointmentId,
  formatTimeLabel,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import {
  isAppointmentWithinOfficeHours,
  isStartTimeAlignedToInterval,
} from "@/lib/schedule-settings";
import { ScrollLock } from "@/components/scroll-lock";

function parseIso(dateIso: string): Date | null {
  const parts = dateIso.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function addDaysIso(dateIso: string, amount: number): string {
  const source = parseIso(dateIso);
  if (!source) return dateIso;
  source.setUTCDate(source.getUTCDate() + amount);
  return formatIso(source);
}

function toMinutesOrZero(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function addMinutesToTime(time: string, deltaMinutes: number): string {
  const base = toMinutesOrZero(time);
  let total = base + deltaMinutes;
  // Clamp within a single day; if the delta would roll off the edge, pin it.
  if (total < 0) total = 0;
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface RescheduleAppointmentModalProps {
  open: boolean;
  appointment: ScheduleAppointmentRecord | null;
  onClose: () => void;
  onRescheduled?: (oldAppointment: ScheduleAppointmentRecord, newAppointment: ScheduleAppointmentRecord) => void;
}

export function RescheduleAppointmentModal({
  open,
  appointment,
  onClose,
  onRescheduled,
}: RescheduleAppointmentModalProps) {
  const { scheduleAppointments, addAppointments, updateAppointment, updateManyAppointments } =
    useScheduleAppointments();
  const { scheduleRooms } = useScheduleRooms();
  const { scheduleSettings } = useScheduleSettings();
  const { keyDates } = useKeyDates();

  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [newDurationMin, setNewDurationMin] = useState(30);
  const [newRoom, setNewRoom] = useState("");
  const [newNote, setNewNote] = useState("");
  const [overrideOfficeHours, setOverrideOfficeHours] = useState(false);
  const [applyScope, setApplyScope] = useState<"single" | "future">("single");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !appointment) {
      return;
    }
    setNewDate(appointment.date);
    setNewTime(appointment.startTime);
    setNewDurationMin(appointment.durationMin);
    setNewRoom(appointment.room);
    setNewNote(appointment.note);
    setOverrideOfficeHours(Boolean(appointment.overrideOfficeHours));
    setApplyScope("single");
    setError("");
  }, [open, appointment]);

  const configuredRooms = useMemo(
    () =>
      scheduleRooms.rooms
        .filter((room) => room.active)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [scheduleRooms.rooms],
  );

  const roomOptions = useMemo(() => {
    const values = new Set<string>();
    configuredRooms.forEach((room) => values.add(room.name));
    scheduleAppointments.forEach((entry) => {
      const room = entry.room.trim();
      if (room) {
        values.add(room);
      }
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [configuredRooms, scheduleAppointments]);

  // All STRICTLY FUTURE appointments for this same patient (after the one being
  // rescheduled). Excludes cancelled/completed/no-show and the original itself.
  const futureSiblings = useMemo(() => {
    if (!appointment) return [];
    const origKey = `${appointment.date} ${appointment.startTime}`;
    return scheduleAppointments.filter((entry) => {
      if (entry.id === appointment.id) return false;
      if (entry.patientId !== appointment.patientId) return false;
      // Only shift appointments that are still in the "Scheduled" state.
      // Anything already checked in/out, cancelled, no-showed, or previously
      // rescheduled should stay put.
      if (entry.status !== "Scheduled") return false;
      const key = `${entry.date} ${entry.startTime}`;
      return key > origKey;
    });
  }, [scheduleAppointments, appointment]);

  if (!open || !appointment) {
    return null;
  }

  const handleSubmit = () => {
    if (!newDate || !newTime) {
      setError("New date and time are required.");
      return;
    }
    if (!isStartTimeAlignedToInterval(newTime, scheduleSettings.appointmentIntervalMin)) {
      setError(
        `Start time must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
      );
      return;
    }
    if (newDurationMin < 5) {
      setError("Duration must be at least 5 minutes.");
      return;
    }

    // Block CLOSED key dates
    const closedEntry = findClosedKeyDateForDate(keyDates, newDate);
    if (closedEntry) {
      const reasonSuffix = closedEntry.reason ? ` (${closedEntry.reason})` : "";
      setError(
        `Cannot reschedule onto CLOSED key date ${formatUsDateFromIso(newDate)}${reasonSuffix}.`,
      );
      return;
    }

    // Office-hours enforcement
    if (
      scheduleSettings.enforceOfficeHours &&
      !isAppointmentWithinOfficeHours(scheduleSettings, newDate, newTime, newDurationMin) &&
      (!scheduleSettings.allowOverride || !overrideOfficeHours)
    ) {
      setError(
        `New time is outside office hours on ${formatUsDateFromIso(newDate)}. Enable override or pick a different slot.`,
      );
      return;
    }

    // Slot capacity (exclude the original appointment from the count).
    // Bypassed when override is in effect — single checkbox covers
    // both office-hours and capacity.
    const overrideActive =
      scheduleSettings.allowOverride && overrideOfficeHours;
    const slotCapacity = Math.max(1, scheduleSettings.maxAppointmentsPerSlot);
    const occupants = scheduleAppointments.filter(
      (entry) =>
        entry.id !== appointment.id &&
        entry.date === newDate &&
        entry.startTime === newTime,
    ).length;
    if (!overrideActive && occupants >= slotCapacity) {
      setError(
        `Time slot ${formatTimeLabel(newTime)} on ${formatUsDateFromIso(newDate)} is full (max ${slotCapacity}). Tick Override Office Hours to add anyway.`,
      );
      return;
    }

    // 1. Mark the OLD appointment as Reschedule
    updateAppointment(appointment.id, (current) => ({
      ...current,
      status: "Reschedule",
    }));

    // 2. Create the NEW appointment as Scheduled on the new date/time
    const newRecord: ScheduleAppointmentRecord = {
      ...appointment,
      id: createAppointmentId(),
      date: newDate,
      startTime: newTime,
      durationMin: newDurationMin,
      room: newRoom.trim(),
      note: newNote.trim(),
      status: "Scheduled",
      overrideOfficeHours: Boolean(overrideOfficeHours),
    };
    addAppointments([newRecord]);

    // 3. If requested, shift every FUTURE Scheduled appointment for this patient
    //    by the same day-delta and time-delta so the whole remaining series
    //    moves together.
    if (applyScope === "future" && futureSiblings.length > 0) {
      const dayDelta = daysBetweenIso(appointment.date, newDate);
      const timeDelta =
        (toMinutesOrZero(newTime) - toMinutesOrZero(appointment.startTime));
      const futureIds = new Set(futureSiblings.map((entry) => entry.id));
      updateManyAppointments(
        (entry) => futureIds.has(entry.id),
        (current) => {
          const shiftedDate = addDaysIso(current.date, dayDelta);
          const shiftedTime = addMinutesToTime(current.startTime, timeDelta);
          return {
            ...current,
            date: shiftedDate,
            startTime: shiftedTime,
          };
        },
      );
    }

    onRescheduled?.(appointment, newRecord);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.45)] px-4 py-8">
      <ScrollLock />
      <section className="w-full max-w-xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold">Reschedule Appointment</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-main)]">{appointment.patientName}</span>{" "}
              • {appointment.appointmentType}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Originally {formatUsDateFromIso(appointment.date)} at {formatTimeLabel(appointment.startTime)}
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

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">New Date *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setNewDate(event.target.value)}
              type="date"
              value={newDate}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">New Start Time *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setNewTime(event.target.value)}
              step={scheduleSettings.appointmentIntervalMin * 60}
              type="time"
              value={newTime}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Duration (min)</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              min={5}
              onChange={(event) => setNewDurationMin(Math.max(5, Number(event.target.value) || 30))}
              type="number"
              value={newDurationMin}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Room</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setNewRoom(event.target.value)}
              value={newRoom}
            >
              <option value="">No room</option>
              {roomOptions.map((roomName) => (
                <option key={`reschedule-room-option-${roomName}`} value={roomName}>
                  {roomName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {scheduleSettings.allowOverride && (
          <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
            <input
              checked={overrideOfficeHours}
              onChange={(event) => setOverrideOfficeHours(event.target.checked)}
              type="checkbox"
            />
            Override office hours for this booking
          </label>
        )}

        <fieldset className="mt-4 rounded-xl border border-[var(--line-soft)] p-3">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Apply To
          </legend>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input
              checked={applyScope === "single"}
              className="mt-1"
              name="reschedule-apply-scope"
              onChange={() => setApplyScope("single")}
              type="radio"
            />
            <span>
              <span className="font-semibold">This appointment only</span>
              <span className="block text-xs text-[var(--text-muted)]">
                Reschedule just this one visit.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input
              checked={applyScope === "future"}
              className="mt-1"
              disabled={futureSiblings.length === 0}
              name="reschedule-apply-scope"
              onChange={() => setApplyScope("future")}
              type="radio"
            />
            <span>
              <span className="font-semibold">
                This and all future appointments
                {futureSiblings.length > 0 && (
                  <span className="ml-1 font-normal text-[var(--text-muted)]">
                    ({futureSiblings.length} upcoming)
                  </span>
                )}
              </span>
              <span className="block text-xs text-[var(--text-muted)]">
                {futureSiblings.length === 0
                  ? "No remaining scheduled appointments for this patient."
                  : `Every upcoming Scheduled visit for ${appointment.patientName} will be shifted by the same day/time delta so the whole remaining series moves together.`}
              </span>
            </span>
          </label>
        </fieldset>

        <label className="mt-3 grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Note</span>
          <textarea
            className="min-h-[72px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            maxLength={500}
            onChange={(event) => setNewNote(event.target.value)}
            value={newNote}
          />
        </label>

        <p className="mt-3 text-xs text-[var(--text-muted)]">
          The original appointment will be marked as <strong>Reschedule</strong> and a new
          appointment will be created on the new date.
        </p>

        {error && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{error}</p>}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
            onClick={handleSubmit}
            type="button"
          >
            Confirm Reschedule
          </button>
        </div>
      </section>
    </div>
  );
}

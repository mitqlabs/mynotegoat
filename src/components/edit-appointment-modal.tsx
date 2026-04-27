"use client";

import { useEffect, useMemo, useState } from "react";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useKeyDates } from "@/hooks/use-key-dates";
import {
  findClosedKeyDateForDate,
  formatUsDateFromIso,
} from "@/lib/key-dates";
import {
  appointmentStatusOptions,
  formatAppointmentStatusLabel,
  isAppointmentStatusSelectable,
  confirmStatusChangeIfNeeded,
  formatTimeLabel,
  type AppointmentStatus,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import { filterAppointmentTypesForPatient, formatDurationMinutes } from "@/lib/schedule-appointment-types";
import { patients } from "@/lib/mock-data";
import {
  isAppointmentWithinOfficeHours,
  isStartTimeAlignedToInterval,
} from "@/lib/schedule-settings";
import { ScrollLock } from "@/components/scroll-lock";

export interface EditAppointmentModalProps {
  open: boolean;
  appointment: ScheduleAppointmentRecord | null;
  onClose: () => void;
  onSaved?: (updated: ScheduleAppointmentRecord) => void;
}

export function EditAppointmentModal({
  open,
  appointment,
  onClose,
  onSaved,
}: EditAppointmentModalProps) {
  const { scheduleAppointments, updateAppointment } = useScheduleAppointments();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { scheduleRooms } = useScheduleRooms();
  const { scheduleSettings } = useScheduleSettings();
  const { keyDates } = useKeyDates();

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(30);
  const [appointmentType, setAppointmentType] = useState("");
  const [status, setStatus] = useState<AppointmentStatus>("Scheduled");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [room, setRoom] = useState("");
  const [caseLabel, setCaseLabel] = useState("");
  const [note, setNote] = useState("");
  const [overrideOfficeHours, setOverrideOfficeHours] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !appointment) {
      return;
    }
    setDate(appointment.date);
    setStartTime(appointment.startTime);
    setDurationMin(appointment.durationMin);
    setAppointmentType(appointment.appointmentType);
    setStatus(appointment.status);
    setProvider(appointment.provider);
    setLocation(appointment.location);
    setRoom(appointment.room);
    setCaseLabel(appointment.caseLabel);
    setNote(appointment.note);
    setOverrideOfficeHours(Boolean(appointment.overrideOfficeHours));
    setError("");
  }, [open, appointment]);

  const appointmentTypeByName = useMemo(() => {
    const map = new Map<string, (typeof appointmentTypes)[number]>();
    appointmentTypes.forEach((entry) => {
      map.set(entry.name.toLowerCase(), entry);
    });
    return map;
  }, [appointmentTypes]);

  const selectedType = appointmentTypeByName.get(appointmentType.toLowerCase()) ?? null;

  const configuredRooms = useMemo(
    () =>
      scheduleRooms.rooms
        .filter((roomEntry) => roomEntry.active)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [scheduleRooms.rooms],
  );

  const roomOptions = useMemo(() => {
    const values = new Set<string>();
    configuredRooms.forEach((roomEntry) => values.add(roomEntry.name));
    scheduleAppointments.forEach((entry) => {
      const trimmed = entry.room.trim();
      if (trimmed) {
        values.add(trimmed);
      }
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [configuredRooms, scheduleAppointments]);

  const providerOptions = useMemo(() => {
    const values = new Set<string>();
    scheduleAppointments.forEach((entry) => values.add(entry.provider));
    if (appointment) {
      values.add(appointment.provider);
    }
    return Array.from(values);
  }, [scheduleAppointments, appointment]);

  const locationOptions = useMemo(() => {
    const values = new Set<string>();
    scheduleAppointments.forEach((entry) => values.add(entry.location));
    if (appointment) {
      values.add(appointment.location);
    }
    return Array.from(values);
  }, [scheduleAppointments, appointment]);

  if (!open || !appointment) {
    return null;
  }

  const handleSubmit = () => {
    if (!date || !startTime) {
      setError("Date and time are required.");
      return;
    }
    if (!appointmentType.trim()) {
      setError("Appointment type is required.");
      return;
    }
    if (!provider.trim() || !location.trim()) {
      setError("Provider and location are required.");
      return;
    }
    if (!isStartTimeAlignedToInterval(startTime, scheduleSettings.appointmentIntervalMin)) {
      setError(
        `Start time must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
      );
      return;
    }
    if (durationMin < 5) {
      setError("Duration must be at least 5 minutes.");
      return;
    }

    const closedEntry = findClosedKeyDateForDate(keyDates, date);
    if (closedEntry) {
      const reasonSuffix = closedEntry.reason ? ` (${closedEntry.reason})` : "";
      setError(
        `Cannot move onto CLOSED key date ${formatUsDateFromIso(date)}${reasonSuffix}.`,
      );
      return;
    }

    if (
      scheduleSettings.enforceOfficeHours &&
      !isAppointmentWithinOfficeHours(scheduleSettings, date, startTime, durationMin) &&
      (!scheduleSettings.allowOverride || !overrideOfficeHours)
    ) {
      setError(
        `Selected time is outside office hours on ${formatUsDateFromIso(date)}. Enable override or pick a different slot.`,
      );
      return;
    }

    const slotCapacity = Math.max(1, scheduleSettings.maxAppointmentsPerSlot);
    const occupants = scheduleAppointments.filter(
      (entry) =>
        entry.id !== appointment.id && entry.date === date && entry.startTime === startTime,
    ).length;
    if (occupants >= slotCapacity) {
      setError(
        `Time slot ${formatTimeLabel(startTime)} on ${formatUsDateFromIso(date)} is full (max ${slotCapacity}).`,
      );
      return;
    }

    let updatedRecord: ScheduleAppointmentRecord | null = null;
    updateAppointment(appointment.id, (current) => {
      const next: ScheduleAppointmentRecord = {
        ...current,
        date,
        startTime,
        durationMin,
        appointmentType: appointmentType.trim(),
        status,
        provider: provider.trim(),
        location: location.trim(),
        room: room.trim(),
        caseLabel: caseLabel.trim(),
        note: note.trim(),
        overrideOfficeHours: Boolean(overrideOfficeHours),
      };
      updatedRecord = next;
      return next;
    });

    if (updatedRecord) {
      onSaved?.(updatedRecord);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.45)] px-4 py-8">
      <ScrollLock />
      <section className="w-full max-w-3xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold">Edit Appointment</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-main)]">{appointment.patientName}</span>{" "}
              • Originally {formatUsDateFromIso(appointment.date)} at{" "}
              {formatTimeLabel(appointment.startTime)}
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
            <span className="text-sm font-semibold text-[var(--text-muted)]">Date *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Start Time *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setStartTime(event.target.value)}
              step={scheduleSettings.appointmentIntervalMin * 60}
              type="time"
              value={startTime}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Appointment Type *</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => {
                const nextName = event.target.value;
                const matched = appointmentTypeByName.get(nextName.toLowerCase());
                setAppointmentType(nextName);
                if (matched && matched.durationMin && durationMin === appointment.durationMin) {
                  setDurationMin(matched.durationMin);
                }
              }}
              value={appointmentType}
            >
              {!appointmentTypeByName.has(appointmentType.toLowerCase()) && (
                <option value={appointmentType}>{appointmentType}</option>
              )}
              {(() => {
                const patient = appointment
                  ? patients.find((p) => p.id === appointment.patientId)
                  : null;
                const list = patient
                  ? filterAppointmentTypesForPatient(appointmentTypes, Boolean(patient.isCashPatient))
                  : appointmentTypes;
                return list.map((type) => (
                  <option key={`edit-type-${type.id}`} value={type.name}>
                    {type.name}
                  </option>
                ));
              })()}
            </select>
            {selectedType && (
              <span className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                  style={{ backgroundColor: selectedType.color }}
                />
                Default duration: {formatDurationMinutes(selectedType.durationMin)}
              </span>
            )}
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Duration (min) *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              min={5}
              onChange={(event) => setDurationMin(Math.max(5, Number(event.target.value) || 30))}
              type="number"
              value={durationMin}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Status</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => {
                const next = event.target.value as AppointmentStatus;
                if (!confirmStatusChangeIfNeeded(appointment.status, next)) return;
                setStatus(next);
              }}
              value={status}
            >
              {appointmentStatusOptions.map((option) => {
                const disabled = !isAppointmentStatusSelectable(option, appointment.status);
                return (
                  <option key={`edit-status-${option}`} disabled={disabled} value={option}>
                    {formatAppointmentStatusLabel(option)}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Room</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setRoom(event.target.value)}
              value={room}
            >
              <option value="">No room</option>
              {roomOptions.map((roomName) => (
                <option key={`edit-room-${roomName}`} value={roomName}>
                  {roomName}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Provider *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              list="edit-appointment-modal-providers"
              onChange={(event) => setProvider(event.target.value)}
              value={provider}
            />
            <datalist id="edit-appointment-modal-providers">
              {providerOptions.map((option) => (
                <option key={`edit-provider-${option}`} value={option} />
              ))}
            </datalist>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Location *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              list="edit-appointment-modal-locations"
              onChange={(event) => setLocation(event.target.value)}
              value={location}
            />
            <datalist id="edit-appointment-modal-locations">
              {locationOptions.map((option) => (
                <option key={`edit-location-${option}`} value={option} />
              ))}
            </datalist>
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Case</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setCaseLabel(event.target.value)}
              value={caseLabel}
            />
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

        <label className="mt-3 grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Note</span>
          <textarea
            className="min-h-[72px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </label>

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
            Save Changes
          </button>
        </div>
      </section>
    </div>
  );
}

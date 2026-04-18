"use client";

import { useEffect, useMemo, useState } from "react";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useKeyDates } from "@/hooks/use-key-dates";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import {
  ContactGapPrompt,
  findContactByName,
  type ContactGap,
} from "@/components/contact-gap-prompt";
import { createPatientRecord, patients } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import {
  findClosedKeyDateForDate,
  findKeyDatesForDate,
  formatUsDateFromIso,
} from "@/lib/key-dates";
import {
  createAppointmentId,
  defaultScheduleLocation,
  defaultScheduleProvider,
  formatTimeLabel,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import { filterAppointmentTypesForPatient, formatDurationMinutes } from "@/lib/schedule-appointment-types";
import {
  getNextBusinessDayIso,
  isAppointmentWithinOfficeHours,
  isStartTimeAlignedToInterval,
  weekdayLabels,
} from "@/lib/schedule-settings";

type RecurrenceUnit = "days" | "weeks";
type RecurrenceEndMode = "date" | "visits";

interface NewAppointmentDraft {
  patientId: string;
  provider: string;
  location: string;
  appointmentType: string;
  caseLabel: string;
  room: string;
  startDate: string;
  startTime: string;
  durationHours: number;
  durationMinutes: number;
  note: string;
  walkIn: boolean;
  isRecurring: boolean;
  recurInterval: number;
  recurUnit: RecurrenceUnit;
  recurrenceEndMode: RecurrenceEndMode;
  recurDays: number[];
  recurEndDate: string;
  recurVisitCount: number;
  overrideOfficeHours: boolean;
  /** Per-weekday override times for the recurring series. Keyed by the
   *  Sunday-0..Saturday-6 day-of-week number (same as `recurDays`). When
   *  a day appears here, its time overrides `startTime` for that day's
   *  generated appointments. Used to support e.g. "Mon 8:30, Wed 1:30,
   *  Thu 10:00" without creating a separate series per day. Empty object
   *  means "use startTime for every selected day" (the legacy behavior). */
  perDayTimes: Record<number, string>;
  /** Whether the "Different time per day" toggle is on. Driven from
   *  state instead of inferred from perDayTimes so the user can have
   *  the toggle visible while leaving per-day values blank (which means
   *  that day falls back to startTime). */
  usePerDayTimes: boolean;
}

const dayToggleOptions = [
  { day: 0, short: "S" },
  { day: 1, short: "M" },
  { day: 2, short: "T" },
  { day: 3, short: "W" },
  { day: 4, short: "Th" },
  { day: 5, short: "F" },
  { day: 6, short: "S" },
];

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(dateIso: string) {
  const [yearRaw, monthRaw, dayRaw] = dateIso.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const value = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return value;
}

function toIsoDate(date: Date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateIso: string, amount: number) {
  const source = parseIsoDate(dateIso);
  if (!source) {
    return dateIso;
  }
  source.setUTCDate(source.getUTCDate() + amount);
  return toIsoDate(source);
}

function getDayOfWeek(dateIso: string) {
  const parsed = parseIsoDate(dateIso);
  if (!parsed) {
    return 0;
  }
  return parsed.getUTCDay();
}

function getDurationMinutes(hours: number, minutes: number) {
  return Math.max(5, Math.round(hours) * 60 + Math.round(minutes));
}

function toDurationParts(durationMin: number) {
  const safe = Math.max(5, Math.round(durationMin));
  return {
    durationHours: Math.floor(safe / 60),
    durationMinutes: safe % 60,
  };
}

function getPatientNameParts(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  if (trimmed.includes(",")) {
    const [lastNameRaw, firstNameRaw] = trimmed.split(",");
    return {
      firstName: (firstNameRaw ?? "").trim().split(/\s+/)[0] ?? "",
      lastName: (lastNameRaw ?? "").trim(),
    };
  }
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts[parts.length - 1] ?? "",
  };
}

function buildCaseLabelFromPatient(patient: (typeof patients)[number]) {
  const doiUs = formatUsDateFromIso(patient.dateOfLoss);
  const dateMatch = doiUs.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return "";
  }
  const { firstName, lastName } = getPatientNameParts(patient.fullName);
  const month = dateMatch[1];
  const day = dateMatch[2];
  const year = dateMatch[3].slice(-2);
  const cleanLast = lastName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  const cleanFirst = firstName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  return `${month}${day}${year}${cleanLast}${cleanFirst}`;
}

function createInitialDraft(
  selectedDate: string,
  defaultType?: { name: string; durationMin: number } | null,
): NewAppointmentDraft {
  const baseDuration = toDurationParts(defaultType?.durationMin ?? 30);
  return {
    patientId: "",
    provider: defaultScheduleProvider,
    location: defaultScheduleLocation,
    appointmentType: defaultType?.name ?? "Personal Injury Office Visit",
    caseLabel: "",
    room: "",
    startDate: selectedDate,
    startTime: "09:00",
    durationHours: baseDuration.durationHours,
    durationMinutes: baseDuration.durationMinutes,
    note: "",
    walkIn: false,
    isRecurring: false,
    recurInterval: 1,
    recurUnit: "weeks",
    recurrenceEndMode: "date",
    recurDays: [getDayOfWeek(selectedDate)],
    recurEndDate: addDays(selectedDate, 30),
    recurVisitCount: 12,
    overrideOfficeHours: false,
    perDayTimes: {},
    usePerDayTimes: false,
  };
}

/**
 * Resolve the actual start-time that should be used for a given
 * generated date. If the "Different time per day" toggle is on and the
 * per-day override map has a non-empty time for that weekday, use it —
 * otherwise fall back to the draft's single startTime.
 *
 * Only applies to weekly recurring appointments; daily recurrence and
 * one-off appointments always use startTime as-is.
 */
function resolveTimeForDate(draft: NewAppointmentDraft, dateIso: string): string {
  if (!draft.isRecurring || draft.recurUnit !== "weeks" || !draft.usePerDayTimes) {
    return draft.startTime;
  }
  const parsed = parseIsoDate(dateIso);
  if (!parsed) return draft.startTime;
  const dayOfWeek = parsed.getUTCDay();
  const override = draft.perDayTimes[dayOfWeek];
  return override && override.trim() ? override : draft.startTime;
}

function getDatesForDraft(draft: NewAppointmentDraft) {
  if (!draft.isRecurring) {
    return [draft.startDate];
  }

  const stopByDate = draft.recurrenceEndMode === "date";
  const stopByVisits = draft.recurrenceEndMode === "visits";
  const visitLimit = Math.max(1, Math.round(draft.recurVisitCount));

  if (stopByDate && draft.recurEndDate < draft.startDate) {
    return [];
  }

  const dates: string[] = [];
  const interval = Math.max(1, Math.round(draft.recurInterval));

  if (draft.recurUnit === "days") {
    let current = draft.startDate;
    while (true) {
      if (stopByDate && current > draft.recurEndDate) {
        break;
      }
      dates.push(current);
      if (stopByVisits && dates.length >= visitLimit) {
        break;
      }
      current = addDays(current, interval);
    }
    return dates;
  }

  const selectedDays = draft.recurDays;
  if (selectedDays.length === 0) {
    return [];
  }
  const daySet = new Set(selectedDays);
  let current = draft.startDate;

  const startDate = parseIsoDate(draft.startDate);
  if (!startDate) {
    return [];
  }
  const startMs = startDate.getTime();

  while (true) {
    if (stopByDate && current > draft.recurEndDate) {
      break;
    }
    const currentDate = parseIsoDate(current);
    if (!currentDate) {
      break;
    }
    const dayOfWeek = currentDate.getUTCDay();
    const diffDays = Math.floor((currentDate.getTime() - startMs) / 86400000);
    const weekIndex = Math.floor(diffDays / 7);

    if (daySet.has(dayOfWeek) && weekIndex % interval === 0) {
      dates.push(current);
      if (stopByVisits && dates.length >= visitLimit) {
        break;
      }
    }
    current = addDays(current, 1);
  }

  return dates;
}

export interface NewAppointmentModalProps {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
  /** When provided, locks the modal to this patient and hides patient search. */
  lockedPatientId?: string;
  onSaved?: (records: ScheduleAppointmentRecord[]) => void;
}

export function NewAppointmentModal({
  open,
  onClose,
  initialDate,
  lockedPatientId,
  onSaved,
}: NewAppointmentModalProps) {
  const { scheduleAppointments, addAppointments } = useScheduleAppointments();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { scheduleRooms } = useScheduleRooms();
  const { scheduleSettings } = useScheduleSettings();
  const { keyDates } = useKeyDates();

  const defaultAppointmentType = useMemo(
    () => appointmentTypes.find((entry) => entry.isDefault) ?? appointmentTypes[0] ?? null,
    [appointmentTypes],
  );

  const appointmentTypeByName = useMemo(() => {
    const map = new Map<string, (typeof appointmentTypes)[number]>();
    appointmentTypes.forEach((entry) => {
      map.set(entry.name.toLowerCase(), entry);
    });
    return map;
  }, [appointmentTypes]);

  // When the modal is opened WITHOUT an explicit initialDate (e.g. "Schedule future
   // appointments" from a patient case file), default to the next working business day
   // instead of today. When the caller passes an explicit initialDate (e.g. clicked a
   // day on the calendar), honor that date.
  const closedDateSet = useMemo(() => {
    const set = new Set<string>();
    keyDates.forEach((row) => {
      if (row.officeStatus !== "Closed") return;
      // Expand date ranges into individual iso dates.
      const start = row.startDate;
      const end = row.endDate || row.startDate;
      if (!start) return;
      let cursor = start;
      let safety = 0;
      while (cursor <= end && safety < 400) {
        set.add(cursor);
        cursor = addDays(cursor, 1);
        safety += 1;
      }
    });
    return set;
  }, [keyDates]);

  const defaultStartDate = useMemo(() => {
    if (initialDate) return initialDate;
    // Default to today (inclusive) — the real guard is duplicate-day detection below
    return getNextBusinessDayIso(scheduleSettings, closedDateSet, getTodayIsoDate(), true);
  }, [initialDate, scheduleSettings, closedDateSet]);

  const [draft, setDraft] = useState<NewAppointmentDraft>(() =>
    createInitialDraft(defaultStartDate, defaultAppointmentType),
  );
  const [patientSearchDraft, setPatientSearchDraft] = useState("");
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [error, setError] = useState("");

  // Filter appointment types by the selected patient's kind (PI vs Cash).
  // If no patient is selected yet, show all so the default type is visible
  // while the user is still typing the name.
  const visibleAppointmentTypes = useMemo(() => {
    const selectedPatient = patients.find((p) => p.id === draft.patientId);
    if (!selectedPatient) return appointmentTypes;
    return filterAppointmentTypesForPatient(
      appointmentTypes,
      Boolean(selectedPatient.isCashPatient),
    );
  }, [appointmentTypes, draft.patientId]);

  // ── Quick New Patient (inline create-from-scratch panel) ────────────────
  // When the user's in the "New Appointment" flow and they realize the
  // patient doesn't exist yet, they can click "+ New Patient" to expand
  // a compact form that creates the patient + auto-selects them for the
  // appointment, without having to close this modal and open another.
  const { contacts } = useContactDirectory();
  const [showQuickNewPatient, setShowQuickNewPatient] = useState(false);
  const [quickNewPatientDraft, setQuickNewPatientDraft] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    attorney: "",
    dateOfLoss: "",
    notes: "",
  });
  const [quickNewPatientError, setQuickNewPatientError] = useState("");
  const [quickAttorneyFocused, setQuickAttorneyFocused] = useState(false);
  const [contactGap, setContactGap] = useState<ContactGap | null>(null);

  const attorneyContactOptions = useMemo(
    () => contacts.filter((c) => c.category.toLowerCase() === "attorney"),
    [contacts],
  );
  const quickAttorneyMatches = useMemo(() => {
    const q = quickNewPatientDraft.attorney.trim().toLowerCase();
    if (!q) return [];
    if (attorneyContactOptions.some((c) => c.name.trim().toLowerCase() === q)) return [];
    return attorneyContactOptions.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [attorneyContactOptions, quickNewPatientDraft.attorney]);

  const resetQuickNewPatientPanel = () => {
    setShowQuickNewPatient(false);
    setQuickNewPatientDraft({
      firstName: "",
      lastName: "",
      phone: "",
      attorney: "",
      dateOfLoss: "",
      notes: "",
    });
    setQuickNewPatientError("");
  };

  // Reset draft whenever the modal opens
  useEffect(() => {
    if (!open) {
      return;
    }
    const baseDate = defaultStartDate;
    const initial = createInitialDraft(baseDate, defaultAppointmentType);
    if (lockedPatientId) {
      const lockedPatient = patients.find((p) => p.id === lockedPatientId);
      if (lockedPatient) {
        initial.patientId = lockedPatient.id;
        initial.caseLabel = buildCaseLabelFromPatient(lockedPatient);
        setPatientSearchDraft(lockedPatient.fullName);
      } else {
        setPatientSearchDraft("");
      }
    } else {
      setPatientSearchDraft("");
    }
    setDraft(initial);
    setShowPatientSuggestions(false);
    setError("");
  }, [open, initialDate, lockedPatientId, defaultAppointmentType, defaultStartDate]);

  const patientById = useMemo(() => {
    const map = new Map<string, (typeof patients)[number]>();
    patients.forEach((patient) => {
      map.set(patient.id, patient);
    });
    return map;
  }, []);

  const selectedDraftType =
    appointmentTypeByName.get(draft.appointmentType.toLowerCase()) ?? null;

  const filteredPatientSuggestions = useMemo(() => {
    const query = patientSearchDraft.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return patients
      .filter((patient) => patient.fullName.toLowerCase().includes(query))
      .slice(0, 12);
  }, [patientSearchDraft]);

  const providers = useMemo(() => {
    const values = new Set<string>([defaultScheduleProvider]);
    scheduleAppointments.forEach((appointment) => values.add(appointment.provider));
    return Array.from(values);
  }, [scheduleAppointments]);

  const locations = useMemo(() => {
    const values = new Set<string>([defaultScheduleLocation]);
    scheduleAppointments.forEach((appointment) => values.add(appointment.location));
    return Array.from(values);
  }, [scheduleAppointments]);

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
    scheduleAppointments.forEach((appointment) => {
      const room = appointment.room.trim();
      if (room) {
        values.add(room);
      }
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [configuredRooms, scheduleAppointments]);

  const openRecurringDays = useMemo(() => {
    const openDays = scheduleSettings.officeHours
      .filter((entry) => entry.enabled)
      .map((entry) => entry.dayOfWeek);
    return new Set(openDays);
  }, [scheduleSettings.officeHours]);

  const handlePatientSearchChange = (value: string) => {
    if (lockedPatientId) {
      return;
    }
    setPatientSearchDraft(value);
    const normalizedValue = value.trim().toLowerCase();
    const exactMatch = patients.find((patient) => patient.fullName.toLowerCase() === normalizedValue);
    setDraft((current) => ({
      ...current,
      patientId: exactMatch?.id ?? "",
      caseLabel: exactMatch ? buildCaseLabelFromPatient(exactMatch) : "",
    }));
    if (normalizedValue && !showPatientSuggestions) {
      setShowPatientSuggestions(true);
    }
    if (!normalizedValue) {
      setShowPatientSuggestions(false);
    }
  };

  const handleSelectPatient = (patient: (typeof patients)[number]) => {
    setPatientSearchDraft(patient.fullName);
    setDraft((current) => ({
      ...current,
      patientId: patient.id,
      caseLabel: buildCaseLabelFromPatient(patient),
    }));
    setShowPatientSuggestions(false);
    setError("");
  };

  const handleCreateQuickPatient = () => {
    const firstName = quickNewPatientDraft.firstName.trim();
    const lastName = quickNewPatientDraft.lastName.trim();
    if (!firstName || !lastName) {
      setQuickNewPatientError("First and last name are required.");
      return;
    }
    let dolIso = "";
    if (quickNewPatientDraft.dateOfLoss.trim()) {
      const match = quickNewPatientDraft.dateOfLoss.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) {
        setQuickNewPatientError("Date of Injury must be MM/DD/YYYY.");
        return;
      }
      dolIso = `${match[3]}-${match[1]}-${match[2]}`;
    }
    const created = createPatientRecord({
      firstName,
      lastName,
      attorney: quickNewPatientDraft.attorney.trim() || undefined,
      phone: quickNewPatientDraft.phone.trim() || undefined,
      dateOfLoss: dolIso,
      notes: quickNewPatientDraft.notes.trim() || undefined,
    });
    if (!created) {
      setQuickNewPatientError("Could not create patient.");
      return;
    }
    // Auto-select the just-created patient into the appointment draft.
    handleSelectPatient(created);
    // Contact-gap check: if the attorney string doesn't match an existing
    // Attorney-category contact, prompt to add one.
    const attorneyName = created.attorney;
    if (attorneyName && attorneyName.toLowerCase() !== "self") {
      const found = findContactByName(contacts, attorneyName, "Attorney");
      if (!found) {
        setContactGap({
          name: attorneyName,
          categoryHint: "Attorney",
          message: `"${attorneyName}" isn't in your Contacts yet — add them now?`,
        });
      }
    }
    resetQuickNewPatientPanel();
  };

  const handleSubmit = () => {
    const selectedPatient = patientById.get(draft.patientId);
    if (!selectedPatient) {
      setError("Select a patient.");
      return;
    }
    if (!draft.provider.trim() || !draft.location.trim() || !draft.appointmentType.trim()) {
      setError("Patient, provider, location, and appointment type are required.");
      return;
    }
    if (!draft.startDate || !draft.startTime) {
      setError("Start date and start time are required.");
      return;
    }
    if (!isStartTimeAlignedToInterval(draft.startTime, scheduleSettings.appointmentIntervalMin)) {
      setError(
        `Start time must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
      );
      return;
    }
    // When the Different-time-per-day toggle is on, every non-blank
    // per-day override ALSO needs to align to the interval — otherwise
    // the schedule grid gets a misaligned pin that the user can't edit
    // cleanly afterwards.
    if (
      draft.isRecurring &&
      draft.recurUnit === "weeks" &&
      draft.usePerDayTimes
    ) {
      for (const [dayStr, time] of Object.entries(draft.perDayTimes)) {
        if (!time || !time.trim()) continue;
        if (!isStartTimeAlignedToInterval(time, scheduleSettings.appointmentIntervalMin)) {
          const dayNum = Number(dayStr);
          setError(
            `${weekdayLabels[dayNum] ?? "Day"} time (${time}) must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
          );
          return;
        }
      }
    }

    const sanitizedDraft: NewAppointmentDraft =
      draft.isRecurring && draft.recurUnit === "weeks"
        ? {
            ...draft,
            recurDays: draft.recurDays.filter((day) => openRecurringDays.has(day)),
          }
        : draft;

    if (sanitizedDraft.isRecurring && sanitizedDraft.recurUnit === "weeks" && sanitizedDraft.recurDays.length === 0) {
      setError("Pick at least one open office day for recurring weekly appointments.");
      return;
    }

    if (
      sanitizedDraft.isRecurring &&
      sanitizedDraft.recurrenceEndMode === "visits" &&
      (!Number.isFinite(sanitizedDraft.recurVisitCount) || sanitizedDraft.recurVisitCount < 1)
    ) {
      setError("Visits must be at least 1.");
      return;
    }

    if (
      sanitizedDraft.isRecurring &&
      sanitizedDraft.recurrenceEndMode === "date" &&
      sanitizedDraft.recurEndDate < sanitizedDraft.startDate
    ) {
      setError("End date must be on or after start date.");
      return;
    }

    const durationMin = getDurationMinutes(sanitizedDraft.durationHours, sanitizedDraft.durationMinutes);
    const caseLabel = sanitizedDraft.caseLabel.trim() || buildCaseLabelFromPatient(selectedPatient);
    let scheduleDates = getDatesForDraft(sanitizedDraft);
    if (!scheduleDates.length) {
      setError("Recurring rule did not generate any appointment dates.");
      return;
    }

    const slotCapacity = Math.max(1, scheduleSettings.maxAppointmentsPerSlot);
    const overbookedDates = scheduleDates.filter((dateIso) => {
      const startTimeForDate = resolveTimeForDate(sanitizedDraft, dateIso);
      const countAtSlot = scheduleAppointments.filter(
        (entry) => entry.date === dateIso && entry.startTime === startTimeForDate,
      ).length;
      return countAtSlot >= slotCapacity;
    });
    if (overbookedDates.length) {
      const detail = overbookedDates
        .slice(0, 5)
        .map((dateIso) => {
          const t = resolveTimeForDate(sanitizedDraft, dateIso);
          return `${formatUsDateFromIso(dateIso)} @ ${formatTimeLabel(t)}`;
        })
        .join(", ");
      setError(
        `Time slot full (max ${slotCapacity}) on: ${detail}${
          overbookedDates.length > 5 ? "..." : ""
        }`,
      );
      return;
    }

    const closedDates = scheduleDates.filter((dateIso) => Boolean(findClosedKeyDateForDate(keyDates, dateIso)));
    if (closedDates.length > 0) {
      const openDates = scheduleDates.filter((dateIso) => !closedDates.includes(dateIso));
      const closedList = closedDates
        .map((dateIso) => {
          const entry = findClosedKeyDateForDate(keyDates, dateIso);
          const reason = entry?.reason ? ` (${entry.reason})` : "";
          return `${formatUsDateFromIso(dateIso)}${reason}`;
        })
        .join("\n  • ");

      if (openDates.length === 0) {
        setError(`Cannot schedule — all dates fall on CLOSED key dates:\n  • ${closedList}`);
        return;
      }

      const skipConfirmed = window.confirm(
        `Cannot schedule on CLOSED key date(s):\n  • ${closedList}\n\nWould you like to skip ${closedDates.length === 1 ? "this date" : "these dates"} and schedule the remaining ${openDates.length} appointment${openDates.length === 1 ? "" : "s"}?`,
      );
      if (!skipConfirmed) return;

      // Replace scheduleDates with only the open dates
      scheduleDates = openDates;
    }

    // Duplicate-day detection: prevent scheduling this patient on a day they already have an appointment
    const patientExistingDates = new Set(
      scheduleAppointments
        .filter((entry) => entry.patientId === selectedPatient.id && entry.status !== "Canceled")
        .map((entry) => entry.date),
    );
    const duplicateDates = scheduleDates.filter((dateIso) => patientExistingDates.has(dateIso));
    if (duplicateDates.length > 0) {
      const nonDupDates = scheduleDates.filter((dateIso) => !patientExistingDates.has(dateIso));
      const dupList = duplicateDates
        .slice(0, 5)
        .map((dateIso) => formatUsDateFromIso(dateIso))
        .join(", ");

      if (nonDupDates.length === 0) {
        setError(`${selectedPatient.fullName} already has an appointment on ${dupList}. Cannot create duplicate.`);
        return;
      }

      const skipConfirmed = window.confirm(
        `${selectedPatient.fullName} already has an appointment on:\n  • ${duplicateDates.map((d) => formatUsDateFromIso(d)).join("\n  • ")}\n\nSkip ${duplicateDates.length === 1 ? "this date" : "these dates"} and schedule the remaining ${nonDupDates.length} appointment${nonDupDates.length === 1 ? "" : "s"}?`,
      );
      if (!skipConfirmed) return;

      scheduleDates = nonDupDates;
    }

    if (scheduleSettings.enforceOfficeHours) {
      const outsideOfficeHoursDate = scheduleDates.find((dateIso) => {
        const startTimeForDate = resolveTimeForDate(sanitizedDraft, dateIso);
        return !isAppointmentWithinOfficeHours(
          scheduleSettings,
          dateIso,
          startTimeForDate,
          durationMin,
        );
      });
      if (
        outsideOfficeHoursDate &&
        (!scheduleSettings.allowOverride || !sanitizedDraft.overrideOfficeHours)
      ) {
        const t = resolveTimeForDate(sanitizedDraft, outsideOfficeHoursDate);
        setError(
          `Outside office hours on ${outsideOfficeHoursDate} @ ${formatTimeLabel(t)}. Enable override or adjust office hours.`,
        );
        return;
      }
    }

    const seriesId = sanitizedDraft.isRecurring ? createAppointmentId() : undefined;
    const records: ScheduleAppointmentRecord[] = scheduleDates.map((dateIso) => ({
      id: createAppointmentId(),
      patientId: selectedPatient.id,
      patientName: selectedPatient.fullName,
      provider: sanitizedDraft.provider.trim(),
      location: sanitizedDraft.location.trim(),
      appointmentType: sanitizedDraft.appointmentType.trim(),
      caseLabel,
      room: sanitizedDraft.room.trim(),
      date: dateIso,
      // Per-day override time if set, else the single startTime. For
      // one-off and daily-recurrence appointments this resolves to
      // sanitizedDraft.startTime unchanged.
      startTime: resolveTimeForDate(sanitizedDraft, dateIso),
      durationMin,
      status: "Scheduled",
      note: sanitizedDraft.note.trim(),
      overrideOfficeHours: Boolean(sanitizedDraft.overrideOfficeHours),
      recurringSeriesId: seriesId,
    }));

    addAppointments(records);
    onSaved?.(records);

    const coveredDates = scheduleDates.filter((dateIso) =>
      findKeyDatesForDate(keyDates, dateIso).some((row) => row.officeStatus === "Covered"),
    );
    if (coveredDates.length) {
      // Surface a soft warning via the error slot in inverse color? Just close.
    }
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.45)] px-4 py-8">
      <section className="w-full max-w-5xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold">New Appointment</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              One-time: set date/time and save. Recurring: set interval, days, and an end date.
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
          <label className="relative grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Patient *</span>
              {!lockedPatientId && (
                <button
                  className="text-xs font-semibold text-[var(--brand-primary)] underline"
                  onClick={() => setShowQuickNewPatient((v) => !v)}
                  type="button"
                >
                  {showQuickNewPatient ? "Cancel new patient" : "+ New Patient"}
                </button>
              )}
            </div>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 disabled:bg-[var(--bg-soft)]"
              disabled={Boolean(lockedPatientId)}
              onBlur={() => window.setTimeout(() => setShowPatientSuggestions(false), 120)}
              onChange={(event) => handlePatientSearchChange(event.target.value)}
              onFocus={() => {
                if (!lockedPatientId) {
                  setShowPatientSuggestions(Boolean(patientSearchDraft.trim()));
                }
              }}
              placeholder="Search patient by name"
              value={patientSearchDraft}
            />
            {!lockedPatientId && showPatientSuggestions && patientSearchDraft.trim() && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-10 max-h-56 overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white shadow-[0_12px_24px_rgba(14,41,62,0.14)]">
                {filteredPatientSuggestions.length ? (
                  filteredPatientSuggestions.map((patient) => (
                    <button
                      key={`new-appointment-patient-${patient.id}`}
                      className="flex w-full items-start justify-between gap-3 border-b border-[var(--line-soft)] px-3 py-2 text-left last:border-b-0 hover:bg-[rgba(13,121,191,0.08)]"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectPatient(patient)}
                      type="button"
                    >
                      <span className="font-medium">{patient.fullName}</span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        DOI {formatUsDateFromIso(patient.dateOfLoss)}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No matching patients.</p>
                )}
              </div>
            )}
          </label>

          {showQuickNewPatient && !lockedPatientId && (
            <div className="rounded-xl border border-dashed border-[var(--brand-primary)] bg-[rgba(13,121,191,0.05)] p-3 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-sm font-semibold">Quick New Patient</h5>
                <span className="text-xs text-[var(--text-muted)]">
                  Complete the rest of the chart later
                </span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Last Name *</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    onChange={(e) =>
                      setQuickNewPatientDraft((c) => ({ ...c, lastName: e.target.value }))
                    }
                    value={quickNewPatientDraft.lastName}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">First Name *</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    onChange={(e) =>
                      setQuickNewPatientDraft((c) => ({ ...c, firstName: e.target.value }))
                    }
                    value={quickNewPatientDraft.firstName}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Phone</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(e) =>
                      setQuickNewPatientDraft((c) => ({
                        ...c,
                        phone: formatUsPhoneInput(e.target.value),
                      }))
                    }
                    placeholder="(555) 555-5555"
                    value={quickNewPatientDraft.phone}
                  />
                </label>
                <label className="relative grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Attorney</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    onBlur={() =>
                      window.setTimeout(() => setQuickAttorneyFocused(false), 120)
                    }
                    onChange={(e) =>
                      setQuickNewPatientDraft((c) => ({ ...c, attorney: e.target.value }))
                    }
                    onFocus={() => setQuickAttorneyFocused(true)}
                    placeholder="Search or type attorney"
                    value={quickNewPatientDraft.attorney}
                  />
                  {quickAttorneyFocused && quickAttorneyMatches.length > 0 && (
                    <ul className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 max-h-56 overflow-auto rounded-lg border border-[var(--line-soft)] bg-white shadow-[0_12px_24px_rgba(14,41,62,0.14)]">
                      {quickAttorneyMatches.map((entry) => (
                        <li key={entry.id}>
                          <button
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[rgba(13,121,191,0.08)]"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setQuickNewPatientDraft((c) => ({ ...c, attorney: entry.name }));
                              setQuickAttorneyFocused(false);
                            }}
                            type="button"
                          >
                            <span className="font-medium">{entry.name}</span>
                            <span className="text-xs text-[var(--text-muted)]">
                              {entry.phone || ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Date of Injury</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
                      let formatted = raw;
                      if (raw.length > 4)
                        formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
                      else if (raw.length > 2)
                        formatted = `${raw.slice(0, 2)}/${raw.slice(2)}`;
                      setQuickNewPatientDraft((c) => ({ ...c, dateOfLoss: formatted }));
                    }}
                    placeholder="MM/DD/YYYY"
                    value={quickNewPatientDraft.dateOfLoss}
                  />
                </label>
              </div>
              <label className="mt-3 grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Note</span>
                <textarea
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                  onChange={(e) =>
                    setQuickNewPatientDraft((c) => ({ ...c, notes: e.target.value }))
                  }
                  placeholder="Anything from the call: chief complaint, referral source, language, ride needs, etc."
                  rows={2}
                  value={quickNewPatientDraft.notes}
                />
              </label>
              {quickNewPatientError && (
                <p className="mt-2 text-xs font-semibold text-[#b43b34]">{quickNewPatientError}</p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold"
                  onClick={resetQuickNewPatientPanel}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-sm font-semibold text-white"
                  onClick={handleCreateQuickPatient}
                  type="button"
                >
                  Create Patient
                </button>
              </div>
            </div>
          )}

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Provider *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              list="new-appointment-modal-provider-list"
              onChange={(event) =>
                setDraft((current) => ({ ...current, provider: event.target.value }))
              }
              value={draft.provider}
            />
            <datalist id="new-appointment-modal-provider-list">
              {providers.map((provider) => (
                <option key={`provider-option-${provider}`} value={provider} />
              ))}
            </datalist>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Location *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              list="new-appointment-modal-location-list"
              onChange={(event) =>
                setDraft((current) => ({ ...current, location: event.target.value }))
              }
              value={draft.location}
            />
            <datalist id="new-appointment-modal-location-list">
              {locations.map((location) => (
                <option key={`location-option-${location}`} value={location} />
              ))}
            </datalist>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Appointment Type *</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => {
                const nextTypeName = event.target.value;
                const matchedType = appointmentTypeByName.get(nextTypeName.toLowerCase());
                setDraft((current) => {
                  if (!matchedType) {
                    return { ...current, appointmentType: nextTypeName };
                  }
                  return {
                    ...current,
                    appointmentType: nextTypeName,
                    ...toDurationParts(matchedType.durationMin),
                  };
                });
              }}
              value={draft.appointmentType}
            >
              {visibleAppointmentTypes.map((type) => (
                <option key={`type-option-${type.id}`} value={type.name}>
                  {type.name}
                </option>
              ))}
            </select>
            {selectedDraftType && (
              <span className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                  style={{ backgroundColor: selectedDraftType.color }}
                />
                Default duration: {formatDurationMinutes(selectedDraftType.durationMin)}
              </span>
            )}
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Case</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setDraft((current) => ({ ...current, caseLabel: event.target.value }))
              }
              placeholder="Auto-filled from DOI + patient name (example: 072726DOJO)"
              value={draft.caseLabel}
            />
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Scheduled Room</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setDraft((current) => ({ ...current, room: event.target.value }))
              }
              value={draft.room}
            >
              <option value="">No room</option>
              {roomOptions.map((roomName) => (
                <option key={`schedule-room-option-${roomName}`} value={roomName}>
                  {roomName}
                </option>
              ))}
            </select>
            {roomOptions.length > 0 ? (
              <span className="text-xs text-[var(--text-muted)]">
                Add/edit rooms in Settings → Schedule Settings → Room Settings.
              </span>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">
                No rooms configured yet. You can add them in Settings.
              </span>
            )}
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            className={`rounded-xl border px-4 py-3 text-left font-semibold ${
              !draft.isRecurring
                ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
            }`}
            onClick={() => setDraft((current) => ({ ...current, isRecurring: false }))}
            type="button"
          >
            One-Time Appointment
          </button>
          <button
            className={`rounded-xl border px-4 py-3 text-left font-semibold ${
              draft.isRecurring
                ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
            }`}
            onClick={() =>
              setDraft((current) => {
                // Default to weekly recurrence using the start date's weekday
                // (if it's an open office day) so the picker isn't empty.
                const startDay = getDayOfWeek(current.startDate);
                const seedDays = openRecurringDays.has(startDay) ? [startDay] : [];
                return {
                  ...current,
                  isRecurring: true,
                  recurUnit: "weeks",
                  recurInterval: 1,
                  recurDays: current.recurDays.length > 0 ? current.recurDays : seedDays,
                };
              })
            }
            type="button"
          >
            Recurring Series
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 md:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Start Date *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => {
                const nextStartDate = event.target.value;
                const nextStartDay = getDayOfWeek(nextStartDate);
                setDraft((current) => ({
                  ...current,
                  startDate: nextStartDate,
                  recurDays:
                    current.isRecurring && current.recurUnit === "weeks"
                      ? current.recurDays
                      : [nextStartDay],
                  recurEndDate:
                    current.recurrenceEndMode === "date" && current.recurEndDate < nextStartDate
                      ? addDays(nextStartDate, 30)
                      : current.recurEndDate,
                }));
              }}
              type="date"
              value={draft.startDate}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Start Time *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setDraft((current) => ({ ...current, startTime: event.target.value }))
              }
              step={scheduleSettings.appointmentIntervalMin * 60}
              type="time"
              value={draft.startTime}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Duration</span>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-2 py-2"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    durationHours: Number(event.target.value),
                  }))
                }
                value={draft.durationHours}
              >
                <option value={0}>0 hr</option>
                <option value={1}>1 hr</option>
                <option value={2}>2 hr</option>
                <option value={3}>3 hr</option>
                <option value={4}>4 hr</option>
              </select>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-2 py-2"
                max={59}
                min={0}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    durationMinutes: Math.max(0, Math.min(59, Number(event.target.value) || 0)),
                  }))
                }
                type="number"
                value={draft.durationMinutes}
              />
            </div>
          </label>
        </div>

        {draft.isRecurring && (
          <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Ends By</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setDraft((current) => {
                      const nextMode = event.target.value as RecurrenceEndMode;
                      if (nextMode === "date") {
                        return {
                          ...current,
                          recurrenceEndMode: nextMode,
                          recurEndDate:
                            current.recurEndDate < current.startDate
                              ? addDays(current.startDate, 30)
                              : current.recurEndDate,
                        };
                      }
                      return {
                        ...current,
                        recurrenceEndMode: nextMode,
                        recurVisitCount: Math.max(1, Math.round(current.recurVisitCount || 1)),
                      };
                    })
                  }
                  value={draft.recurrenceEndMode}
                >
                  <option value="date">Date</option>
                  <option value="visits">Visits</option>
                </select>
              </label>
              {draft.recurrenceEndMode === "date" ? (
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">End Date *</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    min={draft.startDate}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        recurEndDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={draft.recurEndDate}
                  />
                </label>
              ) : (
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Visits *</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    min={1}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        recurVisitCount: Math.max(1, Number(event.target.value) || 1),
                      }))
                    }
                    type="number"
                    value={draft.recurVisitCount}
                  />
                </label>
              )}
            </div>

            {draft.recurUnit === "weeks" && (
              <div className="mt-3">
                <p className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Recurs Every</p>
                <div className="flex flex-wrap gap-2">
                  {dayToggleOptions.map((option) => {
                    const isOpenDay = openRecurringDays.has(option.day);
                    const isSelected =
                      isOpenDay && draft.recurDays.includes(option.day);
                    return (
                      <button
                        key={`recur-day-${option.day}`}
                        className={`flex h-10 min-w-10 items-center justify-center rounded-full border px-2 text-sm font-semibold ${
                          isSelected
                            ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                            : isOpenDay
                              ? "border-[var(--line-soft)] bg-[#dce4ea] text-[var(--text-main)]"
                              : "cursor-not-allowed border-[var(--line-soft)] bg-[#eef2f5] text-[#9ca9b5]"
                        }`}
                        disabled={!isOpenDay}
                        onClick={() =>
                          setDraft((current) => {
                            if (!isOpenDay) {
                              return current;
                            }
                            const exists = current.recurDays.includes(option.day);
                            const nextDays = exists
                              ? current.recurDays.filter((entry) => entry !== option.day)
                              : [...current.recurDays, option.day];
                            return {
                              ...current,
                              recurDays: nextDays,
                            };
                          })
                        }
                        type="button"
                        title={
                          isOpenDay
                            ? weekdayLabels[option.day]
                            : `${weekdayLabels[option.day]} (closed in office hours)`
                        }
                      >
                        {option.short}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Only office-open days are selectable.
                </p>

                {/* Per-day time override — small opt-in so the weekly
                    series can have different times per weekday (e.g. Mon
                    8:30, Wed 1:30, Thu 10:00). Hidden behind a single
                    checkbox so the normal single-time path stays clean. */}
                {draft.recurDays.length > 1 && (
                  <div className="mt-3 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold">
                      <input
                        checked={draft.usePerDayTimes}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            usePerDayTimes: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Different time per day
                    </label>
                    {draft.usePerDayTimes && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {draft.recurDays
                          .slice()
                          .sort((a, b) => a - b)
                          .map((day) => {
                            const override = draft.perDayTimes[day] ?? "";
                            return (
                              <label
                                key={`per-day-time-${day}`}
                                className="grid gap-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
                              >
                                <span className="text-xs font-semibold text-[var(--text-muted)]">
                                  {weekdayLabels[day]}
                                </span>
                                <div className="flex items-center gap-2">
                                  <input
                                    className="w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setDraft((current) => ({
                                        ...current,
                                        perDayTimes: {
                                          ...current.perDayTimes,
                                          [day]: value,
                                        },
                                      }));
                                    }}
                                    type="time"
                                    value={override}
                                  />
                                  {override ? (
                                    <button
                                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                      onClick={() =>
                                        setDraft((current) => {
                                          const next = { ...current.perDayTimes };
                                          delete next[day];
                                          return { ...current, perDayTimes: next };
                                        })
                                      }
                                      title={`Clear — use the main Start Time (${formatTimeLabel(
                                        draft.startTime,
                                      )})`}
                                      type="button"
                                    >
                                      ×
                                    </button>
                                  ) : null}
                                </div>
                                {!override ? (
                                  <span className="text-[10px] text-[var(--text-muted)]">
                                    Uses {formatTimeLabel(draft.startTime)}
                                  </span>
                                ) : null}
                              </label>
                            );
                          })}
                      </div>
                    )}
                    {!draft.usePerDayTimes ? (
                      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                        Turn this on if Mon/Wed/Thu need different appointment times.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <label className="inline-flex items-center gap-2 text-sm font-semibold">
            <input
              checked={draft.walkIn}
              onChange={(event) =>
                setDraft((current) => ({ ...current, walkIn: event.target.checked }))
              }
              type="checkbox"
            />
            Walk-In
          </label>

          {scheduleSettings.allowOverride && (
            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              <input
                checked={draft.overrideOfficeHours}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overrideOfficeHours: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Override office hours for this booking
            </label>
          )}
        </div>

        <label className="mt-4 grid gap-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Appointment Note</span>
          <textarea
            className="min-h-[88px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            maxLength={500}
            onChange={(event) =>
              setDraft((current) => ({ ...current, note: event.target.value }))
            }
            value={draft.note}
          />
        </label>

        {error && (
          <p className="mt-3 text-sm font-semibold text-[#b43b34]">{error}</p>
        )}

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
            Save Appointment
          </button>
        </div>
      </section>
      <ContactGapPrompt gap={contactGap} onClose={() => setContactGap(null)} />
    </div>
  );
}

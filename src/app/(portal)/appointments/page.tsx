"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ContactGapPrompt, findContactByName, type ContactGap } from "@/components/contact-gap-prompt";
import { RescheduleAppointmentModal } from "@/components/reschedule-appointment-modal";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useKeyDates } from "@/hooks/use-key-dates";
import { createPatientRecord, patients } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import {
  findClosedKeyDateForDate,
  findKeyDatesForDate,
  formatKeyDateRange,
  formatUsDateFromIso,
} from "@/lib/key-dates";
import {
  appointmentStatusOptions,
  createAppointmentId,
  defaultScheduleLocation,
  defaultScheduleProvider,
  formatAppointmentStatusLabel,
  formatTimeLabel,
  getStatusBadgeClass,
  isAppointmentStatusSelectable,
  confirmStatusChangeIfNeeded,
  type AppointmentStatus,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import { formatDurationMinutes } from "@/lib/schedule-appointment-types";
import {
  getOfficeHoursForDate,
  getOfficeHoursLabel,
  isAppointmentWithinOfficeHours,
  isStartTimeAlignedToInterval,
  weekdayLabels,
} from "@/lib/schedule-settings";

type AppointmentMode = "schedule" | "patient-flow";
type RecurrenceUnit = "days" | "weeks";
type RecurrenceEndMode = "date" | "visits";

const quickStatusActions: AppointmentStatus[] = ["Check In", "Check Out", "Canceled", "Reschedule"];

const flowSections: Array<{ title: string; status: AppointmentStatus }> = [
  { title: "Scheduled", status: "Scheduled" },
  { title: "Checked In", status: "Check In" },
  { title: "Checked Out", status: "Check Out" },
  { title: "Rescheduled", status: "Reschedule" },
  { title: "Canceled", status: "Canceled" },
];

const dayToggleOptions = [
  { day: 0, short: "S" },
  { day: 1, short: "M" },
  { day: 2, short: "T" },
  { day: 3, short: "W" },
  { day: 4, short: "Th" },
  { day: 5, short: "F" },
  { day: 6, short: "S" },
];

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
}

interface CheckInRoomPromptState {
  appointmentId: string;
  withEncounter: boolean;
}

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

function toMinutes(time: string) {
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

function toTimeValue(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(1439, totalMinutes));
  const hours = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minutes = String(clamped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDateLabel(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return value;
  }
  // Use UTC to match parseIsoDate which creates dates at UTC midnight.
  // Without this, US timezones shift the weekday name by -1 day.
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short weekday + US date, e.g. "Mon 04/14/2026" */
function formatUsDateWithWeekday(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) return formatUsDateFromIso(value);
  const weekday = parsed.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${formatUsDateFromIso(value)}`;
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

function buildTimeSlots(
  dayAppointments: ScheduleAppointmentRecord[],
  officeHour: ReturnType<typeof getOfficeHoursForDate>,
  slotIntervalMin: number,
) {
  const interval = Math.max(1, Math.round(slotIntervalMin));
  let start = 8 * 60;
  let end = 18 * 60;

  if (officeHour?.enabled) {
    start = toMinutes(officeHour.start) ?? start;
    end = toMinutes(officeHour.end) ?? end;
  }

  if (dayAppointments.length > 0) {
    const appointmentStartMin = dayAppointments
      .map((appointment) => toMinutes(appointment.startTime))
      .filter((value): value is number => typeof value === "number");
    if (appointmentStartMin.length > 0) {
      start = Math.min(start, Math.min(...appointmentStartMin));
    }

    const appointmentEndMin = dayAppointments
      .map((appointment) => {
        const startMin = toMinutes(appointment.startTime);
        if (startMin === null) {
          return null;
        }
        return startMin + appointment.durationMin;
      })
      .filter((value): value is number => typeof value === "number");
    if (appointmentEndMin.length > 0) {
      end = Math.max(end, Math.max(...appointmentEndMin));
    }
  }

  start = Math.floor(start / interval) * interval;
  end = Math.ceil(end / interval) * interval;

  if (end <= start) {
    end = start + interval;
  }

  const slotMinutes = new Set<number>();
  for (let current = start; current <= end; current += interval) {
    slotMinutes.add(current);
  }
  dayAppointments.forEach((appointment) => {
    const appointmentStart = toMinutes(appointment.startTime);
    if (appointmentStart !== null) {
      slotMinutes.add(appointmentStart);
    }
  });

  const slots = Array.from(slotMinutes)
    .sort((left, right) => left - right)
    .map((minutes) => toTimeValue(minutes));

  if (slots.length === 0) {
    return [toTimeValue(8 * 60)];
  }
  return slots;
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
  };
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

function getCardBackground(status: AppointmentStatus) {
  switch (status) {
    case "Check In":
      return "border-l-[var(--brand-primary)] bg-[rgba(13,121,191,0.08)]";
    case "Check Out":
      return "border-l-[#2e9b5d] bg-[rgba(46,155,93,0.11)]";
    case "Canceled":
      return "border-l-[#8698a7] bg-[rgba(134,152,167,0.16)]";
    case "Reschedule":
      return "border-l-[var(--brand-accent)] bg-[rgba(240,141,63,0.12)]";
    default:
      return "border-l-[#1aa0a2] bg-[rgba(26,160,162,0.12)]";
  }
}

export default function AppointmentsPage() {
  const router = useRouter();
  const { scheduleAppointments, addAppointments, updateAppointment, removeAppointment } = useScheduleAppointments();
  const { encountersByNewest, createEncounter, deleteEncounter } = useEncounterNotes();
  const { officeSettings } = useOfficeSettings();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { scheduleRooms } = useScheduleRooms();
  const { scheduleSettings } = useScheduleSettings();
  const { keyDates } = useKeyDates();
  const [mode, setMode] = useState<AppointmentMode>("schedule");
  const [selectedDate, setSelectedDate] = useState(() => getTodayIsoDate());
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
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
    // Hide list if exact match (already picked)
    if (attorneyContactOptions.some((c) => c.name.trim().toLowerCase() === q)) return [];
    return attorneyContactOptions.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [attorneyContactOptions, quickNewPatientDraft.attorney]);
  const [newAppointmentDraft, setNewAppointmentDraft] = useState<NewAppointmentDraft>(() =>
    createInitialDraft(getTodayIsoDate(), null),
  );
  const [schedulePatientSearch, setSchedulePatientSearch] = useState("");
  const [patientSearchDraft, setPatientSearchDraft] = useState("");
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [newAppointmentError, setNewAppointmentError] = useState("");
  const [scheduleAlert, setScheduleAlert] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<AppointmentStatus>("Scheduled");
  const [editDateDraft, setEditDateDraft] = useState(getTodayIsoDate());
  const [editTimeDraft, setEditTimeDraft] = useState("09:00");
  const [editRoomDraft, setEditRoomDraft] = useState("");
  const [editOverrideDraft, setEditOverrideDraft] = useState(false);
  const [editNoteDraft, setEditNoteDraft] = useState("");
  const [editTypeDraft, setEditTypeDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [checkInRoomPrompt, setCheckInRoomPrompt] = useState<CheckInRoomPromptState | null>(null);
  const [checkInRoomDraft, setCheckInRoomDraft] = useState("");
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState<string | null>(null);

  const patientById = useMemo(() => {
    const map = new Map<string, (typeof patients)[number]>();
    patients.forEach((patient) => {
      map.set(patient.id, patient);
    });
    return map;
  }, []);

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

  const selectedDraftType =
    appointmentTypeByName.get(newAppointmentDraft.appointmentType.toLowerCase()) ?? null;

  const filteredPatientSuggestions = useMemo(() => {
    const query = patientSearchDraft.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return patients
      .filter((patient) => patient.fullName.toLowerCase().includes(query))
      .slice(0, 12);
  }, [patientSearchDraft]);

  const schedulePatientSearchQuery = schedulePatientSearch.trim().toLowerCase();

  const selectedDayAppointments = useMemo(
    () => scheduleAppointments.filter((appointment) => appointment.date === selectedDate),
    [scheduleAppointments, selectedDate],
  );
  const selectedDayAppointmentsForView = useMemo(() => {
    if (!schedulePatientSearchQuery) {
      return selectedDayAppointments;
    }
    return selectedDayAppointments.filter((appointment) =>
      appointment.patientName.toLowerCase().includes(schedulePatientSearchQuery),
    );
  }, [schedulePatientSearchQuery, selectedDayAppointments]);

  const todayIso = getTodayIsoDate();
  const todaysAppointments = useMemo(
    () => scheduleAppointments.filter((appointment) => appointment.date === todayIso),
    [scheduleAppointments, todayIso],
  );
  const todaysAppointmentsForView = useMemo(() => {
    if (!schedulePatientSearchQuery) {
      return todaysAppointments;
    }
    return todaysAppointments.filter((appointment) =>
      appointment.patientName.toLowerCase().includes(schedulePatientSearchQuery),
    );
  }, [schedulePatientSearchQuery, todaysAppointments]);

  const searchedPatientAppointments = useMemo(() => {
    if (!schedulePatientSearchQuery) {
      return [];
    }
    return scheduleAppointments
      .filter((appointment) => appointment.patientName.toLowerCase().includes(schedulePatientSearchQuery))
      .sort((left, right) => {
        const byDate = left.date.localeCompare(right.date);
        if (byDate !== 0) {
          return byDate;
        }
        return left.startTime.localeCompare(right.startTime);
      });
  }, [scheduleAppointments, schedulePatientSearchQuery]);

  const appointmentsByStatusForToday = useMemo(() => {
    const grouped = new Map<AppointmentStatus, ScheduleAppointmentRecord[]>();
    appointmentStatusOptions.forEach((status) => grouped.set(status, []));
    todaysAppointmentsForView.forEach((appointment) => {
      grouped.get(appointment.status)?.push(appointment);
    });
    return grouped;
  }, [todaysAppointmentsForView]);

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

  const checkInPromptAppointment = useMemo(
    () =>
      checkInRoomPrompt
        ? scheduleAppointments.find((appointment) => appointment.id === checkInRoomPrompt.appointmentId) ?? null
        : null,
    [checkInRoomPrompt, scheduleAppointments],
  );

  const selectedOfficeHour = useMemo(
    () => getOfficeHoursForDate(scheduleSettings, selectedDate),
    [scheduleSettings, selectedDate],
  );
  const selectedDateKeyDates = useMemo(
    () => findKeyDatesForDate(keyDates, selectedDate),
    [keyDates, selectedDate],
  );
  const selectedDateClosedKeyDate = useMemo(
    () => findClosedKeyDateForDate(keyDates, selectedDate),
    [keyDates, selectedDate],
  );

  const openRecurringDays = useMemo(() => {
    const openDays = scheduleSettings.officeHours
      .filter((entry) => entry.enabled)
      .map((entry) => entry.dayOfWeek);
    return new Set(openDays);
  }, [scheduleSettings.officeHours]);

  const slots = useMemo(
    () =>
      buildTimeSlots(
        selectedDayAppointmentsForView,
        selectedOfficeHour,
        scheduleSettings.appointmentIntervalMin,
      ),
    [scheduleSettings.appointmentIntervalMin, selectedDayAppointmentsForView, selectedOfficeHour],
  );

  const selectedAppointment = useMemo(
    () => scheduleAppointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [scheduleAppointments, selectedAppointmentId],
  );

  const openAppointmentEditor = (appointmentId: string) => {
    const appointment = scheduleAppointments.find((entry) => entry.id === appointmentId);
    if (!appointment) {
      return;
    }
    setSelectedAppointmentId(appointment.id);
    setStatusDraft(appointment.status);
    setEditDateDraft(appointment.date);
    setEditTimeDraft(appointment.startTime);
    setEditRoomDraft(appointment.room);
    setEditOverrideDraft(appointment.overrideOfficeHours);
    setEditNoteDraft(appointment.note);
    setEditTypeDraft(appointment.appointmentType);
    setEditError("");
  };

  const openNewAppointmentModal = () => {
    setNewAppointmentDraft(createInitialDraft(selectedDate, defaultAppointmentType));
    setPatientSearchDraft("");
    setShowPatientSuggestions(false);
    setNewAppointmentError("");
    setScheduleAlert("");
    setShowNewAppointmentModal(true);
  };

  const handlePatientSearchChange = (value: string) => {
    setPatientSearchDraft(value);
    const normalizedValue = value.trim().toLowerCase();
    const exactMatch = patients.find((patient) => patient.fullName.toLowerCase() === normalizedValue);
    setNewAppointmentDraft((current) => ({
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
    setNewAppointmentDraft((current) => ({
      ...current,
      patientId: patient.id,
      caseLabel: buildCaseLabelFromPatient(patient),
    }));
    setShowPatientSuggestions(false);
    setNewAppointmentError("");
  };

  const resetQuickNewPatientPanel = () => {
    setShowQuickNewPatient(false);
    setQuickNewPatientDraft({ firstName: "", lastName: "", phone: "", attorney: "", dateOfLoss: "", notes: "" });
    setQuickNewPatientError("");
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
    // Select the new patient in the appointment draft
    handleSelectPatient(created);
    // Check attorney against contacts — prompt to add if missing
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

  const handleQuickStatusUpdate = (appointmentId: string, nextStatus: AppointmentStatus) => {
    if (nextStatus === "Reschedule") {
      openRescheduleModal(appointmentId);
      return;
    }
    const target = scheduleAppointments.find((entry) => entry.id === appointmentId);
    if (target && !confirmStatusChangeIfNeeded(target.status, nextStatus)) return;
    updateAppointment(appointmentId, (current) => ({
      ...current,
      status: nextStatus,
    }));
  };

  const openRescheduleModal = (appointmentId: string) => {
    setRescheduleAppointmentId(appointmentId);
  };

  const rescheduleAppointment = useMemo(
    () =>
      rescheduleAppointmentId
        ? scheduleAppointments.find((entry) => entry.id === rescheduleAppointmentId) ?? null
        : null,
    [rescheduleAppointmentId, scheduleAppointments],
  );

  const openCheckInRoomPrompt = (appointmentId: string, withEncounter: boolean) => {
    const appointment = scheduleAppointments.find((entry) => entry.id === appointmentId);
    if (!appointment) {
      return;
    }

    const shouldPromptForRoom =
      scheduleRooms.enableRoomSelectionOnCheckIn && configuredRooms.length > 0;

    if (!shouldPromptForRoom) {
      updateAppointment(appointmentId, (current) => ({
        ...current,
        status: "Check In",
      }));
      if (withEncounter) {
        openOrCreateEncounterForAppointment(appointment);
      }
      return;
    }

    setCheckInRoomDraft(appointment.room || "");
    setCheckInRoomPrompt({
      appointmentId,
      withEncounter,
    });
  };

  const completeCheckInWithRoom = (roomValue: string) => {
    if (!checkInRoomPrompt) {
      return;
    }

    const appointment = scheduleAppointments.find(
      (entry) => entry.id === checkInRoomPrompt.appointmentId,
    );
    if (!appointment) {
      setCheckInRoomPrompt(null);
      setCheckInRoomDraft("");
      return;
    }

    updateAppointment(appointment.id, (current) => ({
      ...current,
      status: "Check In",
      room: roomValue.trim(),
    }));

    if (checkInRoomPrompt.withEncounter) {
      openOrCreateEncounterForAppointment({
        ...appointment,
        status: "Check In",
        room: roomValue.trim(),
      });
    }

    setCheckInRoomPrompt(null);
    setCheckInRoomDraft("");
  };

  const openOrCreateEncounterForAppointment = (appointment: ScheduleAppointmentRecord) => {
    const resolvedPatient =
      patientById.get(appointment.patientId) ??
      patients.find((entry) => entry.fullName.toLowerCase() === appointment.patientName.toLowerCase()) ??
      null;
    if (!resolvedPatient) {
      setScheduleAlert("Could not resolve patient for this appointment.");
      return;
    }
    const encounterDate = formatUsDateFromIso(appointment.date);
    const existingEncounter =
      encountersByNewest.find(
        (entry) => entry.patientId === resolvedPatient.id && entry.encounterDate === encounterDate,
      ) ?? null;

    if (existingEncounter) {
      setScheduleAlert(`Opened existing encounter for ${appointment.patientName} on ${encounterDate}.`);
      router.push(
        `/encounters?patientId=${encodeURIComponent(resolvedPatient.id)}&encounterId=${encodeURIComponent(existingEncounter.id)}`,
      );
      return;
    }

    if (appointment.status !== "Check In" && appointment.status !== "Check Out") {
      setScheduleAlert(
        `Cannot start an encounter for ${appointment.patientName} — patient must be Checked In first.`,
      );
      return;
    }

    const createdEncounterId = createEncounter({
      patientId: resolvedPatient.id,
      patientName: resolvedPatient.fullName,
      provider: appointment.provider || officeSettings.doctorName || defaultScheduleProvider,
      appointmentType: appointment.appointmentType || "Personal Injury Office Visit",
      encounterDate,
    });
    if (!createdEncounterId) {
      setScheduleAlert("Could not create encounter from this appointment.");
      return;
    }
    setScheduleAlert(`Encounter created for ${appointment.patientName} (${encounterDate}).`);
    router.push(
      `/encounters?patientId=${encodeURIComponent(resolvedPatient.id)}&encounterId=${encodeURIComponent(createdEncounterId)}`,
    );
  };

  const handleSubmitNewAppointment = () => {
    const draft = newAppointmentDraft;
    const selectedPatient = patientById.get(draft.patientId);
    if (!selectedPatient) {
      setNewAppointmentError("Select a patient.");
      return;
    }
    if (!draft.provider.trim() || !draft.location.trim() || !draft.appointmentType.trim()) {
      setNewAppointmentError("Patient, provider, location, and appointment type are required.");
      return;
    }
    if (!draft.startDate || !draft.startTime) {
      setNewAppointmentError("Start date and start time are required.");
      return;
    }
    if (!isStartTimeAlignedToInterval(draft.startTime, scheduleSettings.appointmentIntervalMin)) {
      setNewAppointmentError(
        `Start time must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
      );
      return;
    }

    const sanitizedDraft: NewAppointmentDraft =
      draft.isRecurring && draft.recurUnit === "weeks"
        ? {
            ...draft,
            recurDays: draft.recurDays.filter((day) => openRecurringDays.has(day)),
          }
        : draft;

    if (sanitizedDraft.isRecurring && sanitizedDraft.recurUnit === "weeks" && sanitizedDraft.recurDays.length === 0) {
      setNewAppointmentError("Pick at least one open office day for recurring weekly appointments.");
      return;
    }

    if (
      sanitizedDraft.isRecurring &&
      sanitizedDraft.recurrenceEndMode === "visits" &&
      (!Number.isFinite(sanitizedDraft.recurVisitCount) || sanitizedDraft.recurVisitCount < 1)
    ) {
      setNewAppointmentError("Visits must be at least 1.");
      return;
    }

    if (
      sanitizedDraft.isRecurring &&
      sanitizedDraft.recurrenceEndMode === "date" &&
      sanitizedDraft.recurEndDate < sanitizedDraft.startDate
    ) {
      setNewAppointmentError("End date must be on or after start date.");
      return;
    }

    const durationMin = getDurationMinutes(sanitizedDraft.durationHours, sanitizedDraft.durationMinutes);
    const caseLabel = sanitizedDraft.caseLabel.trim() || buildCaseLabelFromPatient(selectedPatient);
    const scheduleDates = getDatesForDraft(sanitizedDraft);
    if (!scheduleDates.length) {
      setNewAppointmentError("Recurring rule did not generate any appointment dates.");
      return;
    }

    const slotCapacity = Math.max(1, scheduleSettings.maxAppointmentsPerSlot);
    const overbookedDates = scheduleDates.filter((dateIso) => {
      const countAtSlot = scheduleAppointments.filter(
        (entry) => entry.date === dateIso && entry.startTime === sanitizedDraft.startTime,
      ).length;
      return countAtSlot >= slotCapacity;
    });
    if (overbookedDates.length) {
      setNewAppointmentError(
        `Time slot ${formatTimeLabel(sanitizedDraft.startTime)} is full (max ${slotCapacity}) on: ${overbookedDates
          .slice(0, 5)
          .map((dateIso) => formatUsDateFromIso(dateIso))
          .join(", ")}${overbookedDates.length > 5 ? "..." : ""}`,
      );
      return;
    }

    const closedDate = scheduleDates.find((dateIso) => Boolean(findClosedKeyDateForDate(keyDates, dateIso)));
    if (closedDate) {
      const closedEntry = findClosedKeyDateForDate(keyDates, closedDate);
      const reasonSuffix = closedEntry?.reason ? ` (${closedEntry.reason})` : "";
      setNewAppointmentError(
        `Cannot schedule on CLOSED key date ${formatUsDateFromIso(closedDate)}${reasonSuffix}.`,
      );
      return;
    }

    if (scheduleSettings.enforceOfficeHours) {
      const outsideOfficeHoursDate = scheduleDates.find(
        (dateIso) =>
          !isAppointmentWithinOfficeHours(scheduleSettings, dateIso, sanitizedDraft.startTime, durationMin),
      );
      if (
        outsideOfficeHoursDate &&
        (!scheduleSettings.allowOverride || !sanitizedDraft.overrideOfficeHours)
      ) {
        setNewAppointmentError(
          `Outside office hours on ${outsideOfficeHoursDate}. Enable override or adjust office hours.`,
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
      startTime: sanitizedDraft.startTime,
      durationMin,
      status: "Scheduled",
      note: sanitizedDraft.note.trim(),
      overrideOfficeHours: Boolean(sanitizedDraft.overrideOfficeHours),
      recurringSeriesId: seriesId,
    }));

    addAppointments(records);
    const coveredDates = scheduleDates.filter((dateIso) =>
      findKeyDatesForDate(keyDates, dateIso).some((row) => row.officeStatus === "Covered"),
    );
    if (coveredDates.length) {
      setScheduleAlert(
        `Warning: Added appointment(s) on COVERED key date(s): ${coveredDates
          .map((dateIso) => formatUsDateFromIso(dateIso))
          .join(", ")}.`,
      );
    } else {
      setScheduleAlert("");
    }
    setShowNewAppointmentModal(false);
    setSelectedDate(records[0]?.date ?? selectedDate);
  };

  const handleSaveAppointmentUpdates = () => {
    if (!selectedAppointment) {
      return;
    }
    if (!editDateDraft || !editTimeDraft) {
      setEditError("Date and time are required.");
      return;
    }
    if (!isStartTimeAlignedToInterval(editTimeDraft, scheduleSettings.appointmentIntervalMin)) {
      setEditError(
        `Start time must align to ${scheduleSettings.appointmentIntervalMin}-minute intervals.`,
      );
      return;
    }

    const closedEntry = findClosedKeyDateForDate(keyDates, editDateDraft);
    if (closedEntry) {
      const reasonSuffix = closedEntry.reason ? ` (${closedEntry.reason})` : "";
      setEditError(
        `This date is marked CLOSED in Key Dates: ${formatKeyDateRange(closedEntry)}${reasonSuffix}.`,
      );
      return;
    }

    if (
      scheduleSettings.enforceOfficeHours &&
      !isAppointmentWithinOfficeHours(
        scheduleSettings,
        editDateDraft,
        editTimeDraft,
        selectedAppointment.durationMin,
      ) &&
      (!scheduleSettings.allowOverride || !editOverrideDraft)
    ) {
      setEditError("Selected time is outside office hours. Enable override or change the time.");
      return;
    }

    const slotCapacity = Math.max(1, scheduleSettings.maxAppointmentsPerSlot);
    const countAtSlot = scheduleAppointments.filter(
      (entry) =>
        entry.id !== selectedAppointment.id &&
        entry.date === editDateDraft &&
        entry.startTime === editTimeDraft,
    ).length;
    if (countAtSlot >= slotCapacity) {
      setEditError(
        `Time slot ${formatTimeLabel(editTimeDraft)} is full for ${formatUsDateFromIso(editDateDraft)} (max ${slotCapacity}).`,
      );
      return;
    }

    updateAppointment(selectedAppointment.id, (current) => ({
      ...current,
      status: statusDraft,
      date: editDateDraft,
      startTime: editTimeDraft,
      room: editRoomDraft.trim(),
      overrideOfficeHours: editOverrideDraft,
      note: editNoteDraft.trim(),
      appointmentType: editTypeDraft.trim() || current.appointmentType,
    }));

    const coveredOnEdit = findKeyDatesForDate(keyDates, editDateDraft).some(
      (entry) => entry.officeStatus === "Covered",
    );
    if (coveredOnEdit) {
      setScheduleAlert(
        `Warning: ${selectedAppointment.patientName} is scheduled on a COVERED key date (${formatUsDateFromIso(
          editDateDraft,
        )}).`,
      );
    } else {
      setScheduleAlert("");
    }
    setSelectedAppointmentId(null);
  };

  const getStatusCount = (status: AppointmentStatus) =>
    appointmentsByStatusForToday.get(status)?.length ?? 0;

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Schedule</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Click a patient card to check in, check out, reschedule, or update appointment status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold">
              Date
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                onChange={(event) => setSelectedDate(event.target.value)}
                type="date"
                value={selectedDate}
              />
            </label>
            <button className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner" type="button">
              Day
            </button>
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={openNewAppointmentModal}
              type="button"
            >
              New Appointment
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              mode === "schedule" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setMode("schedule")}
            type="button"
          >
            Schedule View
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              mode === "patient-flow" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setMode("patient-flow")}
            type="button"
          >
            Patient Flow View
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[240px] flex-1 gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Quick Patient Search</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setSchedulePatientSearch(event.target.value)}
                placeholder="Type patient name to find appointments"
                value={schedulePatientSearch}
              />
            </label>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!schedulePatientSearchQuery}
              onClick={() => setSchedulePatientSearch("")}
              type="button"
            >
              Clear
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Filters cards below and shows matching appointments across all dates.
          </p>
          {schedulePatientSearchQuery && (
            <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-white p-2">
              <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Matches: {searchedPatientAppointments.length}
              </p>
              <div className="mt-2 max-h-44 space-y-2 overflow-auto">
                {searchedPatientAppointments.length ? (
                  searchedPatientAppointments.slice(0, 30).map((appointment) => (
                    <button
                      key={`schedule-search-match-${appointment.id}`}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] px-3 py-2 text-left hover:border-[var(--brand-primary)] hover:bg-[rgba(13,121,191,0.06)]"
                      onClick={() => {
                        setMode("schedule");
                        setSelectedDate(appointment.date);
                        openAppointmentEditor(appointment.id);
                      }}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{appointment.patientName}</span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {formatUsDateWithWeekday(appointment.date)} • {formatTimeLabel(appointment.startTime)} •{" "}
                          {appointment.appointmentType}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(appointment.status)}`}>
                        {formatAppointmentStatusLabel(appointment.status)}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-1 text-sm text-[var(--text-muted)]">No appointments found for this patient name.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {scheduleAlert && (
          <div className="mt-4 rounded-xl border border-[rgba(240,141,63,0.5)] bg-[rgba(240,141,63,0.12)] px-3 py-2 text-sm font-semibold text-[#8d4c12]">
            {scheduleAlert}
          </div>
        )}
      </section>

      {mode === "schedule" && (
        <section className="panel-card p-4">
          <h4 className="text-lg font-semibold">Calendar / Schedule</h4>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{formatDateLabel(selectedDate)}</p>
          <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
            <span className="font-semibold">Office Hours:</span> {getOfficeHoursLabel(scheduleSettings, selectedDate)}
            {selectedOfficeHour && !selectedOfficeHour.enabled && (
              <span className="ml-2 text-[#b43b34]">Office closed (override required to add appointments).</span>
            )}
          </div>
          {selectedDateKeyDates.length > 0 && (
            <div
              className={`mt-2 rounded-xl border px-3 py-2 text-sm ${
                selectedDateClosedKeyDate
                  ? "border-[rgba(201,66,58,0.5)] bg-[rgba(201,66,58,0.11)] text-[#9f2f2a]"
                  : "border-[rgba(13,121,191,0.45)] bg-[rgba(13,121,191,0.1)] text-[#0f5d92]"
              }`}
            >
              <span className="font-semibold">Key Date Notice:</span>{" "}
              {selectedDateKeyDates
                .map((entry) => `${entry.officeStatus}${entry.reason ? ` - ${entry.reason}` : ""}`)
                .join("; ")}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[920px]">
              {slots.map((slot) => {
                const inSlot = selectedDayAppointmentsForView.filter((appointment) => appointment.startTime === slot);
                return (
                  <div
                    key={slot}
                    className="grid grid-cols-[110px_1fr] border-t border-[var(--line-soft)] py-3 first:border-t-0"
                  >
                    <div className="text-sm font-semibold text-[var(--text-muted)]">{formatTimeLabel(slot)}</div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {inSlot.length > 0 ? (
                        inSlot.map((appointment) => (
                          <article
                            key={appointment.id}
                            className={`cursor-pointer rounded-xl border border-[var(--line-soft)] border-l-4 px-3 py-3 ${getCardBackground(appointment.status)}`}
                            onClick={() => openAppointmentEditor(appointment.id)}
                          >
                            <p className="font-semibold">{appointment.patientName}</p>
                            <p className="inline-flex items-center gap-2 text-sm">
                              <span
                                aria-hidden
                                className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--line-soft)]"
                                style={{
                                  backgroundColor:
                                    appointmentTypeByName.get(appointment.appointmentType.toLowerCase())?.color ??
                                    "#d0dce7",
                                }}
                              />
                              {appointment.appointmentType}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {formatTimeLabel(appointment.startTime)} • {appointment.durationMin} min
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {appointment.provider} • {appointment.location}
                            </p>
                            {appointment.room && (
                              <p className="text-xs font-semibold text-[var(--text-muted)]">
                                Room: {appointment.room}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(appointment.status)}`}>
                                {formatAppointmentStatusLabel(appointment.status)}
                              </span>
                              {appointment.status === "Scheduled" && (
                                <>
                                  <button
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCheckInRoomPrompt(appointment.id, false);
                                    }}
                                    type="button"
                                  >
                                    Check In
                                  </button>
                                  <button
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCheckInRoomPrompt(appointment.id, true);
                                    }}
                                    type="button"
                                  >
                                    Check In + Encounter
                                  </button>
                                </>
                              )}
                              {appointment.status === "Check In" && (
                                <>
                                  <button
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleQuickStatusUpdate(appointment.id, "Check Out");
                                    }}
                                    type="button"
                                  >
                                    Check Out
                                  </button>
                                  <button
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openOrCreateEncounterForAppointment(appointment);
                                    }}
                                    type="button"
                                  >
                                    + Encounter
                                  </button>
                                </>
                              )}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="text-sm text-[var(--text-muted)]">No appointments</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {mode === "patient-flow" && (
        <div className="space-y-5">
          <section className="grid gap-5 xl:grid-cols-3">
            {flowSections.map((section) => {
              const cards =
                appointmentsByStatusForToday
                  .get(section.status)
                  ?.sort((left, right) => left.startTime.localeCompare(right.startTime)) ?? [];

              return (
                <div key={`flow-${section.status}`} className="panel-card p-4">
                  <h4 className="text-lg font-semibold">
                    {section.title} ({cards.length})
                  </h4>
                  <div className="mt-3 space-y-2">
                    {cards.map((appointment) => (
                      <article
                        key={appointment.id}
                        className={`cursor-pointer rounded-xl border border-[var(--line-soft)] border-l-4 px-3 py-3 ${getCardBackground(appointment.status)}`}
                        onClick={() => openAppointmentEditor(appointment.id)}
                      >
                        <p className="font-semibold">{appointment.patientName}</p>
                        <p className="text-sm">
                          {formatTimeLabel(appointment.startTime)} • {appointment.durationMin} min
                        </p>
                        <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
                          <span
                            aria-hidden
                            className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--line-soft)]"
                            style={{
                              backgroundColor:
                                appointmentTypeByName.get(appointment.appointmentType.toLowerCase())?.color ??
                                "#d0dce7",
                            }}
                          />
                          {appointment.appointmentType}
                        </p>
                        {appointment.room && (
                          <p className="text-xs font-semibold text-[var(--text-muted)]">
                            Room: {appointment.room}
                          </p>
                        )}
                      </article>
                    ))}
                    {cards.length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">No patients in this status.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="panel-card p-4">
            <div className="grid gap-3 text-center md:grid-cols-3 xl:grid-cols-7">
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{todaysAppointmentsForView.length}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Total Appointments</p>
              </div>
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{getStatusCount("Scheduled")}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Scheduled</p>
              </div>
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{getStatusCount("Check In")}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Checked In</p>
              </div>
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{getStatusCount("Check Out")}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Seen</p>
              </div>
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{getStatusCount("Reschedule")}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Rescheduled</p>
              </div>
              <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <p className="text-3xl font-semibold">{getStatusCount("Canceled")}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">Canceled</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {showNewAppointmentModal && (
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
                onClick={() => setShowNewAppointmentModal(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="relative grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient *</span>
                  <button
                    className="text-xs font-semibold text-[var(--brand-primary)] underline"
                    onClick={() => setShowQuickNewPatient((v) => !v)}
                    type="button"
                  >
                    {showQuickNewPatient ? "Cancel new patient" : "+ New Patient"}
                  </button>
                </div>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onBlur={() => window.setTimeout(() => setShowPatientSuggestions(false), 120)}
                  onChange={(event) => handlePatientSearchChange(event.target.value)}
                  onFocus={() => setShowPatientSuggestions(Boolean(patientSearchDraft.trim()))}
                  placeholder="Search patient by name"
                  value={patientSearchDraft}
                />
                {showPatientSuggestions && patientSearchDraft.trim() && (
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

              {showQuickNewPatient && (
                <div className="rounded-xl border border-dashed border-[var(--brand-primary)] bg-[rgba(13,121,191,0.05)] p-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-sm font-semibold">Quick New Patient</h5>
                    <span className="text-xs text-[var(--text-muted)]">Complete the rest of the chart later</span>
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
                        onBlur={() => window.setTimeout(() => setQuickAttorneyFocused(false), 120)}
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
                                <span className="text-xs text-[var(--text-muted)]">{entry.phone || ""}</span>
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
                          if (raw.length > 4) formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
                          else if (raw.length > 2) formatted = `${raw.slice(0, 2)}/${raw.slice(2)}`;
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
                  list="schedule-provider-list"
                  onChange={(event) =>
                    setNewAppointmentDraft((current) => ({ ...current, provider: event.target.value }))
                  }
                  value={newAppointmentDraft.provider}
                />
                <datalist id="schedule-provider-list">
                  {providers.map((provider) => (
                    <option key={`provider-option-${provider}`} value={provider} />
                  ))}
                </datalist>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Location *</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  list="schedule-location-list"
                  onChange={(event) =>
                    setNewAppointmentDraft((current) => ({ ...current, location: event.target.value }))
                  }
                  value={newAppointmentDraft.location}
                />
                <datalist id="schedule-location-list">
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
                    setNewAppointmentDraft((current) => {
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
                  value={newAppointmentDraft.appointmentType}
                >
                  {appointmentTypes.map((type) => (
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
                    setNewAppointmentDraft((current) => ({ ...current, caseLabel: event.target.value }))
                  }
                  placeholder="Auto-filled from DOI + patient name (example: 072726DOJO)"
                  value={newAppointmentDraft.caseLabel}
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Scheduled Room</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setNewAppointmentDraft((current) => ({ ...current, room: event.target.value }))
                  }
                  value={newAppointmentDraft.room}
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
                  !newAppointmentDraft.isRecurring
                    ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                    : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                }`}
                onClick={() => setNewAppointmentDraft((current) => ({ ...current, isRecurring: false }))}
                type="button"
              >
                One-Time Appointment
              </button>
              <button
                className={`rounded-xl border px-4 py-3 text-left font-semibold ${
                  newAppointmentDraft.isRecurring
                    ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                    : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                }`}
                onClick={() =>
                  setNewAppointmentDraft((current) => {
                    const startDay = getDayOfWeek(current.startDate);
                    const seededDays =
                      current.recurDays.length > 0
                        ? current.recurDays
                        : openRecurringDays.has(startDay)
                          ? [startDay]
                          : [];
                    return {
                      ...current,
                      isRecurring: true,
                      recurUnit: "weeks",
                      recurInterval: 1,
                      recurDays: seededDays,
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
                    setNewAppointmentDraft((current) => ({
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
                  value={newAppointmentDraft.startDate}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Start Time *</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setNewAppointmentDraft((current) => ({ ...current, startTime: event.target.value }))
                  }
                  step={scheduleSettings.appointmentIntervalMin * 60}
                  type="time"
                  value={newAppointmentDraft.startTime}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Duration</span>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-2 py-2"
                    onChange={(event) =>
                      setNewAppointmentDraft((current) => ({
                        ...current,
                        durationHours: Number(event.target.value),
                      }))
                    }
                    value={newAppointmentDraft.durationHours}
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
                      setNewAppointmentDraft((current) => ({
                        ...current,
                        durationMinutes: Math.max(0, Math.min(59, Number(event.target.value) || 0)),
                      }))
                    }
                    type="number"
                    value={newAppointmentDraft.durationMinutes}
                  />
                </div>
              </label>
            </div>

            {newAppointmentDraft.isRecurring && (
              <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Ends By</span>
                    <select
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewAppointmentDraft((current) => {
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
                      value={newAppointmentDraft.recurrenceEndMode}
                    >
                      <option value="date">Date</option>
                      <option value="visits">Visits</option>
                    </select>
                  </label>
                  {newAppointmentDraft.recurrenceEndMode === "date" ? (
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-sm font-semibold text-[var(--text-muted)]">End Date *</span>
                      <input
                        className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                        min={newAppointmentDraft.startDate}
                        onChange={(event) =>
                          setNewAppointmentDraft((current) => ({
                            ...current,
                            recurEndDate: event.target.value,
                          }))
                        }
                        type="date"
                        value={newAppointmentDraft.recurEndDate}
                      />
                    </label>
                  ) : (
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-sm font-semibold text-[var(--text-muted)]">Visits *</span>
                      <input
                        className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                        min={1}
                        onChange={(event) =>
                          setNewAppointmentDraft((current) => ({
                            ...current,
                            recurVisitCount: Math.max(1, Number(event.target.value) || 1),
                          }))
                        }
                        type="number"
                        value={newAppointmentDraft.recurVisitCount}
                      />
                    </label>
                  )}
                </div>

                {newAppointmentDraft.recurUnit === "weeks" && (
                  <div className="mt-3">
                    <p className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Recurs Every</p>
                    <div className="flex flex-wrap gap-2">
                      {dayToggleOptions.map((option) => {
                        const isOpenDay = openRecurringDays.has(option.day);
                        const isSelected =
                          isOpenDay && newAppointmentDraft.recurDays.includes(option.day);
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
                              setNewAppointmentDraft((current) => {
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
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  checked={newAppointmentDraft.walkIn}
                  onChange={(event) =>
                    setNewAppointmentDraft((current) => ({ ...current, walkIn: event.target.checked }))
                  }
                  type="checkbox"
                />
                Walk-In
              </label>

              {scheduleSettings.allowOverride && (
                <label className="inline-flex items-center gap-2 text-sm font-semibold">
                  <input
                    checked={newAppointmentDraft.overrideOfficeHours}
                    onChange={(event) =>
                      setNewAppointmentDraft((current) => ({
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
                  setNewAppointmentDraft((current) => ({ ...current, note: event.target.value }))
                }
                value={newAppointmentDraft.note}
              />
            </label>

            {newAppointmentError && (
              <p className="mt-3 text-sm font-semibold text-[#b43b34]">{newAppointmentError}</p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => setShowNewAppointmentModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={handleSubmitNewAppointment}
                type="button"
              >
                Save Appointment
              </button>
            </div>
          </section>
        </div>
      )}

      <RescheduleAppointmentModal
        appointment={rescheduleAppointment}
        onClose={() => setRescheduleAppointmentId(null)}
        onRescheduled={(oldAppointment, newAppointment) => {
          setScheduleAlert(
            `Rescheduled ${oldAppointment.patientName} to ${formatUsDateWithWeekday(newAppointment.date)} at ${formatTimeLabel(newAppointment.startTime)}.`,
          );
          setSelectedAppointmentId(null);
        }}
        open={Boolean(rescheduleAppointment)}
      />

      {checkInRoomPrompt && checkInPromptAppointment && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.45)] px-4 py-8">
          <section className="w-full max-w-2xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-xl font-semibold">Assign Room on Check-In</h4>
                <p className="text-sm text-[var(--text-muted)]">
                  {checkInPromptAppointment.patientName} •{" "}
                  {formatUsDateWithWeekday(checkInPromptAppointment.date)} •{" "}
                  {formatTimeLabel(checkInPromptAppointment.startTime)}
                </p>
              </div>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                onClick={() => {
                  setCheckInRoomPrompt(null);
                  setCheckInRoomDraft("");
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-sm font-semibold text-[var(--text-muted)]">Tap a room (optional)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {configuredRooms.map((room) => {
                  const selected = checkInRoomDraft === room.name;
                  return (
                    <button
                      key={`checkin-room-${room.id}`}
                      className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                        selected
                          ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)]"
                          : "border-[var(--line-soft)] bg-white"
                      }`}
                      onClick={() => setCheckInRoomDraft(room.name)}
                      type="button"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                          style={{ backgroundColor: room.color }}
                        />
                        {room.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => {
                  setCheckInRoomPrompt(null);
                  setCheckInRoomDraft("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => completeCheckInWithRoom("")}
                type="button"
              >
                Check In Without Room
              </button>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={() => completeCheckInWithRoom(checkInRoomDraft)}
                type="button"
              >
                Check In
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedAppointment && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.45)] px-4 py-8">
          <section className="w-full max-w-2xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-xl font-semibold">{selectedAppointment.patientName}</h4>
                <p className="text-sm text-[var(--text-muted)]">
                  {selectedAppointment.appointmentType} • {selectedAppointment.provider}
                </p>
              </div>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                onClick={() => setSelectedAppointmentId(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Appointment Status</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => {
                    const nextStatus = event.target.value as AppointmentStatus;
                    if (nextStatus === "Reschedule" && selectedAppointment) {
                      openRescheduleModal(selectedAppointment.id);
                      return;
                    }
                    if (selectedAppointment && !confirmStatusChangeIfNeeded(selectedAppointment.status, nextStatus)) {
                      return;
                    }
                    setStatusDraft(nextStatus);
                  }}
                  value={statusDraft}
                >
                  {appointmentStatusOptions.map((status) => (
                    <option key={`status-option-${status}`} value={status}>
                      {formatAppointmentStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Date</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setEditDateDraft(event.target.value)}
                  type="date"
                  value={editDateDraft}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Start Time</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setEditTimeDraft(event.target.value)}
                  step={scheduleSettings.appointmentIntervalMin * 60}
                  type="time"
                  value={editTimeDraft}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Room</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setEditRoomDraft(event.target.value)}
                  value={editRoomDraft}
                >
                  <option value="">No room</option>
                  {roomOptions.map((roomName) => (
                    <option key={`edit-room-option-${roomName}`} value={roomName}>
                      {roomName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Duration</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2"
                  disabled
                  value={`${selectedAppointment.durationMin} minutes`}
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Appointment Type</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setEditTypeDraft(event.target.value)}
                  value={editTypeDraft}
                >
                  {!appointmentTypeByName.has(editTypeDraft.toLowerCase()) && editTypeDraft && (
                    <option value={editTypeDraft}>{editTypeDraft}</option>
                  )}
                  {appointmentTypes.map((type) => (
                    <option key={`edit-appointment-type-${type.id}`} value={type.name}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {quickStatusActions.map((status) => {
                const selectable = isAppointmentStatusSelectable(status, selectedAppointment?.status ?? "Scheduled");
                return (
                <button
                  key={`quick-status-${status}`}
                  className={`rounded-lg border px-3 py-1 text-sm font-semibold ${
                    !selectable
                      ? "cursor-not-allowed border-[var(--line-soft)] bg-[var(--bg-soft)] text-[var(--text-muted)] opacity-50"
                      : statusDraft === status
                      ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                      : "border-[var(--line-soft)] bg-white"
                  }`}
                  disabled={!selectable}
                  onClick={() => {
                    if (status === "Reschedule" && selectedAppointment) {
                      openRescheduleModal(selectedAppointment.id);
                      return;
                    }
                    if (selectedAppointment && !confirmStatusChangeIfNeeded(selectedAppointment.status, status)) return;
                    setStatusDraft(status);
                  }}
                  title={!selectable ? "Patient must be Checked In first" : undefined}
                  type="button"
                >
                  {formatAppointmentStatusLabel(status)}
                </button>
                );
              })}
              {(() => {
                const canStart = statusDraft === "Check In" || statusDraft === "Check Out";
                return (
                  <button
                    className={`rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold ${
                      canStart ? "bg-white" : "cursor-not-allowed bg-[var(--bg-soft)] text-[var(--text-muted)]"
                    }`}
                    disabled={!canStart}
                    onClick={() =>
                      openOrCreateEncounterForAppointment({
                        ...selectedAppointment,
                        status: statusDraft,
                      })
                    }
                    title={
                      canStart
                        ? "Start encounter"
                        : "Patient must be Checked In before starting an encounter"
                    }
                    type="button"
                  >
                    + Add Encounter
                  </button>
                );
              })()}
            </div>

            {scheduleSettings.allowOverride && (
              <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  checked={editOverrideDraft}
                  onChange={(event) => setEditOverrideDraft(event.target.checked)}
                  type="checkbox"
                />
                Override office hours for this appointment
              </label>
            )}

            <label className="mt-3 grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Note</span>
              <textarea
                className="min-h-[88px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setEditNoteDraft(event.target.value)}
                value={editNoteDraft}
              />
            </label>

            <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm">
              <span className="font-semibold">Office Hours on {weekdayLabels[getDayOfWeek(editDateDraft)]}:</span>{" "}
              {getOfficeHoursLabel(scheduleSettings, editDateDraft)}
            </div>

            {editError && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{editError}</p>}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                className="rounded-xl border border-[rgba(201,66,58,0.4)] bg-[rgba(201,66,58,0.08)] px-4 py-2 font-semibold text-[#b43b34]"
                onClick={() => {
                  if (!selectedAppointment) {
                    return;
                  }
                  const dateLabel = formatUsDateFromIso(selectedAppointment.date);
                  const linkedEncounter = encountersByNewest.find(
                    (entry) =>
                      entry.patientId === selectedAppointment.patientId &&
                      entry.encounterDate === dateLabel,
                  );
                  if (linkedEncounter) {
                    const chargeCount = linkedEncounter.charges.length;
                    const proceed = window.confirm(
                      `This appointment has an attached encounter${
                        linkedEncounter.signed ? " (CLOSED)" : ""
                      } on ${dateLabel}${chargeCount > 0 ? ` with ${chargeCount} charge${chargeCount === 1 ? "" : "s"}` : ""}.\n\n` +
                        `Click OK to delete BOTH the appointment AND the encounter (and any attached charges).\n` +
                        `Click Cancel to keep everything.`,
                    );
                    if (!proceed) {
                      return;
                    }
                    deleteEncounter(linkedEncounter.id);
                    removeAppointment(selectedAppointment.id);
                    setScheduleAlert(
                      `Appointment for ${selectedAppointment.patientName} on ${dateLabel} and its encounter${
                        chargeCount > 0 ? ` (${chargeCount} charge${chargeCount === 1 ? "" : "s"})` : ""
                      } deleted.`,
                    );
                    setSelectedAppointmentId(null);
                    return;
                  }

                  const confirmed = window.confirm(
                    `Delete the ${selectedAppointment.appointmentType} appointment for ${selectedAppointment.patientName} on ${dateLabel} at ${formatTimeLabel(selectedAppointment.startTime)}? This cannot be undone.`,
                  );
                  if (!confirmed) {
                    return;
                  }
                  removeAppointment(selectedAppointment.id);
                  setScheduleAlert(
                    `Appointment for ${selectedAppointment.patientName} on ${dateLabel} deleted.`,
                  );
                  setSelectedAppointmentId(null);
                }}
                type="button"
              >
                Delete Appointment
              </button>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={() => setSelectedAppointmentId(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  onClick={handleSaveAppointmentUpdates}
                  type="button"
                >
                  Save Status
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <ContactGapPrompt gap={contactGap} onClose={() => setContactGap(null)} />
    </div>
  );
}

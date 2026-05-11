import { appointments as legacyAppointments } from "@/lib/mock-data";

export type AppointmentStatus =
  | "Scheduled"
  | "Check In"
  | "Check Out"
  | "Canceled"
  | "Reschedule";

export interface ScheduleAppointmentRecord {
  id: string;
  patientId: string;
  patientName: string;
  provider: string;
  location: string;
  appointmentType: string;
  caseLabel: string;
  room: string;
  date: string;
  startTime: string;
  durationMin: number;
  status: AppointmentStatus;
  note: string;
  overrideOfficeHours: boolean;
  recurringSeriesId?: string;
}

const STORAGE_KEY = "casemate.schedule-appointments.v1";
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const appointmentStatusOptions: AppointmentStatus[] = [
  "Scheduled",
  "Check In",
  "Check Out",
  "Canceled",
  "Reschedule",
];

/**
 * Display label for an appointment status. The underlying enum stays as
 * "Check In" / "Check Out" (changing it would invalidate every stored
 * appointment), but the UI reads "Checked In" / "Checked Out" because
 * that's the natural English for the state — the patient HAS BEEN
 * checked in, not is currently in the act of checking in.
 */
export function formatAppointmentStatusLabel(status: AppointmentStatus | string): string {
  if (status === "Check In") return "Checked In";
  if (status === "Check Out") return "Checked Out";
  return status;
}


/**
 * Whether a given target status is allowed given the current status. Used to
 * disable invalid transitions in the status dropdowns. Specifically: a patient
 * cannot be moved to "Check Out" unless they were already "Check In" (or are
 * already checked out, in which case the option is left visible so the
 * dropdown still shows the current value).
 */
export function isAppointmentStatusSelectable(
  option: AppointmentStatus,
  current: AppointmentStatus,
): boolean {
  if (option === "Check Out") {
    return current === "Check In" || current === "Check Out";
  }
  return true;
}

/**
 * Returns true if changing from `current` → `next` should show a
 * confirmation warning. Currently warns when leaving "Canceled" or
 * "Reschedule" status, since those are typically final.
 */
export function shouldWarnStatusChange(
  current: AppointmentStatus,
  next: AppointmentStatus,
): boolean {
  if (current === next) return false;
  return current === "Canceled" || current === "Reschedule";
}

/**
 * Shows a confirm dialog if the status transition is risky.
 * Returns true if the change should proceed.
 */
export function confirmStatusChangeIfNeeded(
  current: AppointmentStatus,
  next: AppointmentStatus,
): boolean {
  if (!shouldWarnStatusChange(current, next)) return true;
  return window.confirm(
    `This appointment is currently "${formatAppointmentStatusLabel(current)}". Are you sure you want to change it to "${formatAppointmentStatusLabel(next)}"?`,
  );
}

export const appointmentTypeOptions = [
  "Personal Injury Office Visit",
  "Spinal Decompression - C/S",
  "PI Re-Exam",
  "PI Discharge Visit",
  "Follow-Up Visit",
];

// Blank defaults only — any hardcoded office-name / doctor-name here
// would leak into the "Location" / "Provider" dropdowns on new user
// accounts. Each user fills these in from Settings → Office /
// Account or their first appointment form. See
// src/lib/office-settings.ts for the tenant-isolation rationale.
export const defaultScheduleLocation = "";
export const defaultScheduleProvider = "";

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDate(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  return datePattern.test(candidate) ? candidate : fallback;
}

function to24HourTime(value: string) {
  const normalized = value.trim();
  if (timePattern.test(normalized)) {
    return normalized;
  }

  const legacy = normalized.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (!legacy) {
    return null;
  }

  let hours = Number(legacy[1]);
  const minutes = Number(legacy[2]);
  const meridiem = legacy[3].toUpperCase();
  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }
  if (meridiem === "PM" && hours < 12) {
    hours += 12;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeTime(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = to24HourTime(value);
  return normalized && timePattern.test(normalized) ? normalized : fallback;
}

function normalizeStatus(value: unknown): AppointmentStatus {
  if (typeof value !== "string") {
    return "Scheduled";
  }
  const candidate = value.trim().toLowerCase();
  if (candidate === "check in" || candidate === "checked in") {
    return "Check In";
  }
  if (candidate === "check out" || candidate === "checked out" || candidate === "seen") {
    return "Check Out";
  }
  if (candidate === "no show") {
    return "Canceled"; // legacy: No Show mapped to Canceled
  }
  if (candidate === "canceled" || candidate === "cancelled") {
    return "Canceled";
  }
  if (candidate === "reschedule" || candidate === "rescheduled") {
    return "Reschedule";
  }
  return "Scheduled";
}

function toInt(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(5, Math.min(720, Math.round(value)));
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const candidate = value.trim();
  return candidate ? candidate : undefined;
}

function normalizeRecord(value: unknown, fallbackDate: string): ScheduleAppointmentRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<ScheduleAppointmentRecord>;
  const id = normalizeText(row.id);
  const patientName = normalizeText(row.patientName);

  if (!id || !patientName) {
    return null;
  }

  const startTime = normalizeTime(row.startTime, "08:00");

  return {
    id,
    patientId: normalizeText(row.patientId),
    patientName,
    provider: normalizeText(row.provider, defaultScheduleProvider),
    location: normalizeText(row.location, defaultScheduleLocation),
    appointmentType: normalizeText(row.appointmentType, "Personal Injury Office Visit"),
    caseLabel: normalizeText(row.caseLabel),
    room: normalizeText(row.room),
    date: normalizeDate(row.date, fallbackDate),
    startTime,
    durationMin: toInt(row.durationMin, 30),
    status: normalizeStatus(row.status),
    note: normalizeText(row.note),
    overrideOfficeHours: Boolean(row.overrideOfficeHours),
    recurringSeriesId: normalizeOptionalText(row.recurringSeriesId),
  };
}

function compareAppointments(left: ScheduleAppointmentRecord, right: ScheduleAppointmentRecord) {
  const leftKey = `${left.date} ${left.startTime}`;
  const rightKey = `${right.date} ${right.startTime}`;
  return leftKey.localeCompare(rightKey);
}

export function normalizeScheduleAppointments(value: unknown): ScheduleAppointmentRecord[] {
  const fallbackDate = getTodayIsoDate();
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const records: ScheduleAppointmentRecord[] = [];

  value.forEach((entry) => {
    const normalized = normalizeRecord(entry, fallbackDate);
    if (!normalized || seen.has(normalized.id)) {
      return;
    }
    seen.add(normalized.id);
    records.push(normalized);
  });

  return records.sort(compareAppointments);
}

function mapLegacyStatus(value: string): AppointmentStatus {
  if (value === "Checked In") {
    return "Check In";
  }
  if (value === "Seen") {
    return "Check Out";
  }
  return "Scheduled";
}

export function getDefaultScheduleAppointments(): ScheduleAppointmentRecord[] {
  const today = getTodayIsoDate();
  return legacyAppointments
    .map((entry) => ({
      id: entry.id,
      patientId: entry.patientId,
      patientName: entry.patientName,
      provider: entry.provider || defaultScheduleProvider,
      location: defaultScheduleLocation,
      appointmentType: entry.appointmentType,
      caseLabel: "",
      room: "",
      date: today,
      startTime: to24HourTime(entry.start) ?? "08:00",
      durationMin: toInt(entry.durationMin, 30),
      status: mapLegacyStatus(entry.status),
      note: "",
      overrideOfficeHours: false,
    }))
    .sort(compareAppointments);
}

export function loadScheduleAppointments(): ScheduleAppointmentRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizeScheduleAppointments(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Previous snapshot for diff-based dual-write. */
let previousAppointmentsById: Map<string, ScheduleAppointmentRecord> = new Map();

export function saveScheduleAppointments(records: ScheduleAppointmentRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  const next = [...records].sort(compareAppointments);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  // Phase-2 dual-write. Async — now awaits every op and reports failures
  // via reportCloudWriteError (which flips the UI sync indicator to "error").
  // `.catch` here routes any error that ESCAPED the dual-write's internal
  // reporting (e.g. module import failure) into the same reporter so the
  // user still sees the red pill — no silent swallowing.
  dualWriteAppointmentsToCloud(next, previousAppointmentsById).catch((err) => {
    void import("@/lib/storage-sync-interceptor").then(({ reportCloudWriteError }) => {
      reportCloudWriteError("appointments dual-write (pre-run)", err);
    });
  });
  previousAppointmentsById = new Map(next.map((a) => [a.id, a]));
}

async function dualWriteAppointmentsToCloud(
  nextRecords: ScheduleAppointmentRecord[],
  prevById: Map<string, ScheduleAppointmentRecord>,
): Promise<void> {
  const [{ isCloudEntityEnabled }, { upsertAppointmentToTable, deleteAppointmentFromTable }, { reportCloudWriteError }] =
    await Promise.all([
      import("@/lib/feature-flags"),
      import("@/lib/appointments-cloud"),
      import("@/lib/storage-sync-interceptor"),
    ]);
  if (!isCloudEntityEnabled("scheduleAppointments")) return;

  const nextById = new Map(nextRecords.map((a) => [a.id, a]));
  const ops: Promise<unknown>[] = [];

  for (const appt of nextRecords) {
    const prev = prevById.get(appt.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(appt)) {
      ops.push(upsertAppointmentToTable(appt));
    }
  }
  for (const prevId of prevById.keys()) {
    if (!nextById.has(prevId)) {
      ops.push(deleteAppointmentFromTable(prevId));
    }
  }
  if (ops.length === 0) return;

  const results = await Promise.allSettled(ops);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === 0) return;

  const aggregate = new Error(
    `[schedule-appointments] ${failures.length} of ${ops.length} cloud op(s) failed — ` +
      `first reason: ${failures[0].reason instanceof Error ? failures[0].reason.message : String(failures[0].reason)}`,
  );
  reportCloudWriteError("appointments dual-write", aggregate);
  throw aggregate;
}

/**
 * Replace the in-memory appointment cache from the cloud table.
 * Called by the bootstrap — does NOT trigger a dual-write.
 */
export function replaceAppointmentsFromCloud(records: ScheduleAppointmentRecord[]) {
  if (typeof window === "undefined") return;
  const sorted = [...records].sort(compareAppointments);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  // Update the diff baseline so the next save doesn't re-push everything.
  previousAppointmentsById = new Map(sorted.map((a) => [a.id, a]));
}

export function createAppointmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getStatusBadgeClass(status: AppointmentStatus) {
  switch (status) {
    case "Check In":
      return "bg-[rgba(13,121,191,0.14)] text-[#0d79bf]";
    case "Check Out":
      return "bg-[rgba(31,157,96,0.14)] text-[#1f9d60]";
    case "Canceled":
      return "bg-[rgba(124,141,158,0.2)] text-[#516578]";
    case "Reschedule":
      return "bg-[rgba(240,141,63,0.18)] text-[#9d5f1e]";
    default:
      return "bg-[rgba(26,160,162,0.16)] text-[#1a6f70]";
  }
}

export function formatTimeLabel(value: string) {
  const match = timePattern.exec(value);
  if (!match) {
    return value;
  }
  const rawHours = Number(match[1]);
  const minutes = match[2];
  const meridiem = rawHours >= 12 ? "PM" : "AM";
  const hour12 = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return `${String(hour12).padStart(2, "0")}:${minutes} ${meridiem}`;
}

/**
 * Permissive time-string parser for quick-edit inputs. Accepts the
 * shapes a user actually types when reading "4:45 PM" off a calendar:
 *
 *   "4:45pm"  → "16:45"   "4:45 PM"  → "16:45"
 *   "4:45p"   → "16:45"   "4:45a"    → "04:45"
 *   "445p"    → "16:45"   "445pm"    → "16:45"
 *   "4p"      → "16:00"   "4pm"      → "16:00"
 *   "12p"     → "12:00"   "12am"     → "00:00"
 *   "16:45"   → "16:45"   "1645"     → "16:45"
 *
 * With no AM/PM suffix the input is treated as 24-hour ("4:45" →
 * "04:45"); office software conventions vary on how to disambiguate
 * a bare "4:45", and choosing a side silently is the kind of "smart"
 * that bites someone every couple of months. The fix: require the
 * "p" / "pm" suffix to mean PM. The shorthand "4p" still works, so
 * total keystrokes are nearly the same as the old 16:45 routine.
 *
 * Returns null for unparseable input — callers should leave the
 * existing value in place rather than guess.
 */
export function parseTimeFlexible(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  // Detect and strip a trailing am/pm marker (with or without a space).
  let meridiem: "am" | "pm" | null = null;
  let body = raw;
  const ampmMatch = body.match(/\s*(a|am|p|pm)$/);
  if (ampmMatch) {
    const marker = ampmMatch[1];
    meridiem = marker.startsWith("p") ? "pm" : "am";
    body = body.slice(0, ampmMatch.index ?? body.length).trim();
  }

  let hours: number;
  let minutes: number;

  if (body.includes(":")) {
    const m = body.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    hours = Number(m[1]);
    minutes = Number(m[2]);
  } else {
    const digits = body.replace(/\D/g, "");
    if (digits.length === 0) return null;
    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else if (digits.length === 3) {
      // "445" → 4:45 — single-digit hour shorthand.
      hours = Number(digits.slice(0, 1));
      minutes = Number(digits.slice(1));
    } else if (digits.length === 4) {
      hours = Number(digits.slice(0, 2));
      minutes = Number(digits.slice(2));
    } else {
      return null;
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes >= 60) return null;
  if (hours < 0 || hours > 23) return null;

  if (meridiem === "am") {
    if (hours === 12) hours = 0;
    else if (hours > 12) return null; // "13am" is nonsense
  } else if (meridiem === "pm") {
    if (hours === 12) {
      // noon — 12:xx PM stays at 12
    } else if (hours < 12) {
      hours += 12;
    } else {
      return null; // "13pm" is nonsense
    }
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface DailyOfficeHours {
  dayOfWeek: number;
  enabled: boolean;
  start: string;
  end: string;
  /** Optional second block for a split day (e.g. lunch break): 10-1, 2-6. */
  start2?: string;
  end2?: string;
}

export interface ScheduleSettingsConfig {
  enforceOfficeHours: boolean;
  allowOverride: boolean;
  appointmentIntervalMin: number;
  maxAppointmentsPerSlot: number;
  officeHours: DailyOfficeHours[];
}

const STORAGE_KEY = "casemate.schedule-settings.v1";

export const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const appointmentIntervalOptions = [10, 15, 20, 30] as const;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string) {
  const match = timePattern.exec(time);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeTime(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  return timePattern.test(candidate) ? candidate : fallback;
}

function normalizeAppointmentInterval(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (appointmentIntervalOptions.includes(rounded as (typeof appointmentIntervalOptions)[number])) {
    return rounded;
  }
  return fallback;
}

function normalizeMaxAppointmentsPerSlot(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(20, Math.round(value)));
}

export function getDefaultScheduleSettings(): ScheduleSettingsConfig {
  return {
    enforceOfficeHours: true,
    allowOverride: true,
    appointmentIntervalMin: 15,
    maxAppointmentsPerSlot: 4,
    officeHours: [
      { dayOfWeek: 0, enabled: false, start: "08:00", end: "17:00" },
      { dayOfWeek: 1, enabled: true, start: "08:00", end: "18:00" },
      { dayOfWeek: 2, enabled: true, start: "08:00", end: "18:00" },
      { dayOfWeek: 3, enabled: true, start: "08:00", end: "18:00" },
      { dayOfWeek: 4, enabled: true, start: "08:00", end: "18:00" },
      { dayOfWeek: 5, enabled: true, start: "08:00", end: "16:00" },
      { dayOfWeek: 6, enabled: false, start: "08:00", end: "14:00" },
    ],
  };
}

export function normalizeScheduleSettings(value: unknown): ScheduleSettingsConfig {
  const defaults = getDefaultScheduleSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Partial<ScheduleSettingsConfig>;
  const officeHoursByDay = new Map<number, DailyOfficeHours>();

  if (Array.isArray(raw.officeHours)) {
    raw.officeHours.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const row = entry as Partial<DailyOfficeHours>;
      if (typeof row.dayOfWeek !== "number" || !Number.isInteger(row.dayOfWeek)) {
        return;
      }
      const dayOfWeek = Math.max(0, Math.min(6, row.dayOfWeek));
      const fallback = defaults.officeHours[dayOfWeek];
      const s2 = typeof row.start2 === "string" ? normalizeTime(row.start2, "") : "";
      const e2 = typeof row.end2 === "string" ? normalizeTime(row.end2, "") : "";
      const hasSecond = Boolean(s2 && e2 && (toMinutes(e2) ?? 0) > (toMinutes(s2) ?? 0));
      officeHoursByDay.set(dayOfWeek, {
        dayOfWeek,
        enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
        start: normalizeTime(row.start, fallback.start),
        end: normalizeTime(row.end, fallback.end),
        ...(hasSecond ? { start2: s2, end2: e2 } : {}),
      });
    });
  }

  const officeHours = defaults.officeHours.map((fallback) => {
    const saved = officeHoursByDay.get(fallback.dayOfWeek);
    if (!saved) {
      return fallback;
    }

    const startMinutes = toMinutes(saved.start);
    const endMinutes = toMinutes(saved.end);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      return {
        ...saved,
        start: fallback.start,
        end: fallback.end,
      };
    }

    return saved;
  });

  return {
    enforceOfficeHours:
      typeof raw.enforceOfficeHours === "boolean"
        ? raw.enforceOfficeHours
        : defaults.enforceOfficeHours,
    allowOverride: typeof raw.allowOverride === "boolean" ? raw.allowOverride : defaults.allowOverride,
    appointmentIntervalMin: normalizeAppointmentInterval(
      raw.appointmentIntervalMin,
      defaults.appointmentIntervalMin,
    ),
    maxAppointmentsPerSlot: normalizeMaxAppointmentsPerSlot(
      raw.maxAppointmentsPerSlot,
      defaults.maxAppointmentsPerSlot,
    ),
    officeHours,
  };
}

export function loadScheduleSettings(): ScheduleSettingsConfig {
  if (typeof window === "undefined") {
    return getDefaultScheduleSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultScheduleSettings();
    }
    return normalizeScheduleSettings(JSON.parse(raw));
  } catch {
    return getDefaultScheduleSettings();
  }
}

export function saveScheduleSettings(settings: ScheduleSettingsConfig) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "schedulingSettings", settings));
}

function getDayOfWeek(dateIso: string) {
  const [yearRaw, monthRaw, dayRaw] = dateIso.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(asDate.getTime())) {
    return null;
  }
  return asDate.getUTCDay();
}

export function getOfficeHoursForDate(settings: ScheduleSettingsConfig, dateIso: string) {
  const day = getDayOfWeek(dateIso);
  if (day === null) {
    return null;
  }
  return settings.officeHours.find((entry) => entry.dayOfWeek === day) ?? null;
}

export function isAppointmentWithinOfficeHours(
  settings: ScheduleSettingsConfig,
  dateIso: string,
  startTime: string,
  durationMin: number,
) {
  const officeHours = getOfficeHoursForDate(settings, dateIso);
  if (!officeHours || !officeHours.enabled) {
    return false;
  }

  const appointmentStart = toMinutes(startTime);
  if (appointmentStart === null) return false;
  const appointmentEnd = appointmentStart + Math.max(1, Math.round(durationMin));

  const withinBlock = (start: string | undefined, end: string | undefined) => {
    if (!start || !end) return false;
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s === null || e === null) return false;
    return appointmentStart >= s && appointmentEnd <= e;
  };

  // Fits in either the morning block or the optional afternoon block.
  return withinBlock(officeHours.start, officeHours.end) || withinBlock(officeHours.start2, officeHours.end2);
}

export function getOfficeHoursLabel(settings: ScheduleSettingsConfig, dateIso: string) {
  const officeHours = getOfficeHoursForDate(settings, dateIso);
  if (!officeHours || !officeHours.enabled) {
    return "Closed";
  }
  const first = `${officeHours.start} - ${officeHours.end}`;
  return officeHours.start2 && officeHours.end2
    ? `${first}, ${officeHours.start2} - ${officeHours.end2}`
    : first;
}

/**
 * Returns the next ISO date on or after `fromIso` that is a working business day,
 * i.e. office hours are enabled for that day of week and no CLOSED key-date covers it.
 * If `inclusive` is false (default), skips `fromIso` itself — useful for "next business day AFTER today".
 * Falls back to `fromIso` after 60 lookahead days to avoid infinite loops.
 */
export function getNextBusinessDayIso(
  settings: ScheduleSettingsConfig,
  closedIsoDates: Set<string>,
  fromIso: string,
  inclusive = false,
): string {
  const parts = fromIso.split("-");
  if (parts.length !== 3) return fromIso;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return fromIso;
  const startOffset = inclusive ? 0 : 1;
  for (let i = startOffset; i < 60 + startOffset; i += 1) {
    const probe = new Date(Date.UTC(y, m - 1, d + i));
    const iso = `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, "0")}-${String(probe.getUTCDate()).padStart(2, "0")}`;
    const dow = probe.getUTCDay();
    const hours = settings.officeHours.find((entry) => entry.dayOfWeek === dow);
    if (!hours || !hours.enabled) continue;
    if (closedIsoDates.has(iso)) continue;
    return iso;
  }
  return fromIso;
}

export function isStartTimeAlignedToInterval(startTime: string, intervalMin: number) {
  const minutes = toMinutes(startTime);
  if (minutes === null) {
    return false;
  }
  const safeInterval = Math.max(1, Math.round(intervalMin));
  return minutes % safeInterval === 0;
}

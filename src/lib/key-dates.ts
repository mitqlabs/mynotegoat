export type KeyDateOfficeStatus = "Closed" | "Covered";

export interface KeyDateRecord {
  id: string;
  startDate: string;
  endDate: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
}

const STORAGE_KEY = "casemate.key-dates.v1";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeDate(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  return datePattern.test(candidate) ? candidate : fallback;
}

function normalizeOfficeStatus(value: unknown): KeyDateOfficeStatus {
  if (value === "Covered") {
    return "Covered";
  }
  return "Closed";
}

function normalizeRecord(value: unknown): KeyDateRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<KeyDateRecord>;
  const id = normalizeText(row.id);
  const startDate = normalizeDate(row.startDate);
  const endDate = normalizeDate(row.endDate, startDate);
  const reason = normalizeText(row.reason);
  const officeStatus = normalizeOfficeStatus(row.officeStatus);

  if (!id || !startDate || !endDate || endDate < startDate) {
    return null;
  }

  return {
    id,
    startDate,
    endDate,
    officeStatus,
    reason,
  };
}

function compareByDate(left: KeyDateRecord, right: KeyDateRecord) {
  if (left.startDate !== right.startDate) {
    return right.startDate.localeCompare(left.startDate);
  }
  if (left.endDate !== right.endDate) {
    return right.endDate.localeCompare(left.endDate);
  }
  return left.id.localeCompare(right.id);
}

export function createKeyDateId() {
  return `KD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function getDefaultKeyDates(): KeyDateRecord[] {
  return [];
}

export function normalizeKeyDates(value: unknown): KeyDateRecord[] {
  if (!Array.isArray(value)) {
    return getDefaultKeyDates();
  }

  const rows = value
    .map((entry) => normalizeRecord(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort(compareByDate);

  return rows.length ? rows : getDefaultKeyDates();
}

export function loadKeyDates(): KeyDateRecord[] {
  if (typeof window === "undefined") {
    return getDefaultKeyDates();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultKeyDates();
    }
    return normalizeKeyDates(JSON.parse(raw));
  } catch {
    return getDefaultKeyDates();
  }
}

export function saveKeyDates(rows: KeyDateRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", rows));
}

export function isDateInRange(dateIso: string, startDate: string, endDate: string) {
  return dateIso >= startDate && dateIso <= endDate;
}

export function findKeyDatesForDate(rows: KeyDateRecord[], dateIso: string) {
  return rows.filter((row) => isDateInRange(dateIso, row.startDate, row.endDate));
}

export function findClosedKeyDateForDate(rows: KeyDateRecord[], dateIso: string) {
  return findKeyDatesForDate(rows, dateIso).find((row) => row.officeStatus === "Closed") ?? null;
}

export function formatUsDateFromIso(dateIso: string) {
  const [year, month, day] = dateIso.split("-");
  if (!year || !month || !day) {
    return dateIso;
  }
  return `${month}/${day}/${year}`;
}

export function formatKeyDateRange(row: Pick<KeyDateRecord, "startDate" | "endDate">) {
  const start = formatUsDateFromIso(row.startDate);
  const end = formatUsDateFromIso(row.endDate);
  return row.startDate === row.endDate ? start : `${start} - ${end}`;
}

/**
 * True when a CLOSED key date exists only because of the federal holiday
 * on that day — a single-day closure whose reason names that holiday ("Veterans Day",
 * "Independence Day (observed)", …). Holiday-sourced closures are booked
 * like a Closed holiday (Canceled placeholder + make-up visit) rather than
 * dropped like other closures.
 */
export function isHolidaySourcedKeyDate(row: KeyDateRecord, holidayName: string) {
  if (row.officeStatus !== "Closed" || row.startDate !== row.endDate) return false;
  const base = (value: string) => value.replace(/\s*\(observed\)\s*$/i, "").trim().toLowerCase();
  const reason = base(row.reason);
  if (!reason) return false;
  return holidayName
    .split(" / ")
    .some((name) => {
      const holiday = base(name);
      return Boolean(holiday) && (reason === holiday || reason.includes(holiday));
    });
}

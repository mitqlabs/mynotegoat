/**
 * Closed  — office closed; scheduling on it is blocked / skipped.
 * Covered — another provider covers; bookable, with a soft notice.
 * Open    — explicitly open (e.g. a federal holiday the office works);
 *           a normal day. Never treated as closed anywhere.
 */
export type KeyDateOfficeStatus = "Closed" | "Covered" | "Open";

export const keyDateOfficeStatusOptions: KeyDateOfficeStatus[] = ["Closed", "Covered", "Open"];

export interface KeyDateRecord {
  id: string;
  startDate: string;
  endDate: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
  /**
   * Special hours ("HH:MM", 24h). When either is set the office is open
   * ONLY inside [openStart, openEnd) that day: a "Closed" key date becomes a
   * partial-day closure (e.g. open until 14:00), "Open"/"Covered" get custom
   * hours. Visits outside are flagged and get no reminders. Empty/absent =
   * the whole day (old records keep working unchanged).
   */
  openStart?: string;
  openEnd?: string;
}

/** "9:5" → "09:05"; anything else → "". */
export function normalizeKeyDateTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function keyDateHasHours(row: Pick<KeyDateRecord, "openStart" | "openEnd">): boolean {
  return Boolean(normalizeKeyDateTime(row.openStart) || normalizeKeyDateTime(row.openEnd));
}

export interface KeyDateHours {
  /** "" = from the start of the day. */
  start: string;
  /** "" = until the end of the day. */
  end: string;
}

/**
 * The special hours in force on this date, or null for a normal / fully
 * closed day. With several, the narrowest window wins (latest start,
 * earliest end).
 */
export function keyDateHoursForDate(rows: KeyDateRecord[], dateIso: string): KeyDateHours | null {
  const withHours = findKeyDatesForDate(rows, dateIso).filter(keyDateHasHours);
  if (!withHours.length) return null;
  let start = "";
  let end = "";
  for (const row of withHours) {
    const s = normalizeKeyDateTime(row.openStart);
    const e = normalizeKeyDateTime(row.openEnd);
    if (s && s > start) start = s;
    if (e && (!end || e < end)) end = e;
  }
  return { start, end };
}

/** Is a visit at "HH:MM" inside these hours? Unknown times count as inside. */
export function isTimeWithinHours(time: string, hours: KeyDateHours | null): boolean {
  if (!hours) return true;
  const t = normalizeKeyDateTime(time);
  if (!t) return true;
  if (hours.start && t < hours.start) return false;
  if (hours.end && t >= hours.end) return false;
  return true;
}

function hhmmTo12(value: string): string {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** "Open until 2:00 PM", "Open 10:00 AM – 2:00 PM", "" when no hours. */
export function formatKeyDateHours(row: Pick<KeyDateRecord, "openStart" | "openEnd">): string {
  const s = normalizeKeyDateTime(row.openStart);
  const e = normalizeKeyDateTime(row.openEnd);
  if (s && e) return `Open ${hhmmTo12(s)} – ${hhmmTo12(e)}`;
  if (e) return `Open until ${hhmmTo12(e)}`;
  if (s) return `Open from ${hhmmTo12(s)}`;
  return "";
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
  if (value === "Open") {
    return "Open";
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

  const openStart = normalizeKeyDateTime(row.openStart);
  const openEnd = normalizeKeyDateTime(row.openEnd);
  return {
    id,
    startDate,
    endDate,
    officeStatus,
    reason,
    ...(openStart ? { openStart } : {}),
    ...(openEnd ? { openEnd } : {}),
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

/** An OPEN key date covering this date, or null. */
export function findOpenKeyDateForDate(rows: KeyDateRecord[], dateIso: string) {
  return findKeyDatesForDate(rows, dateIso).find((row) => row.officeStatus === "Open") ?? null;
}

/** A FULL-day closure on this date (a Closed key date with hours is partial). */
export function findClosedKeyDateForDate(rows: KeyDateRecord[], dateIso: string) {
  return findKeyDatesForDate(rows, dateIso).find((row) => row.officeStatus === "Closed" && !keyDateHasHours(row)) ?? null;
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

/** A visit that still counts as "on the books" (not Canceled, not a No Show). */
export function isBookedStatus(status: string | undefined | null): boolean {
  return status !== "Canceled" && status !== "No Show";
}

export interface KeyDateBookings {
  /** Visits on the books across the whole date or range. */
  booked: number;
  /** Of those, how many were "Cleared" from the warning list. */
  cleared: number;
}

/**
 * How many visits are booked on each key date (single day or range).
 * Counts every visit on the books regardless of "Clear" — clearing hides a
 * row from the warning list, it does not make the booking go away, so the
 * table must never read "None" for a day that has patients on it.
 */
export function summarizeKeyDateBookings(
  rows: KeyDateRecord[],
  appointments: Array<{ id: string; date: string; status?: string }>,
  dismissed: ReadonlySet<string> = new Set(),
): Map<string, KeyDateBookings> {
  const out = new Map<string, KeyDateBookings>();
  for (const row of rows) {
    let booked = 0;
    let cleared = 0;
    for (const appt of appointments) {
      if (!isBookedStatus(appt.status)) continue;
      if (!isDateInRange(appt.date, row.startDate, row.endDate)) continue;
      booked += 1;
      if (dismissed.has(appt.id)) cleared += 1;
    }
    out.set(row.id, { booked, cleared });
  }
  return out;
}

/**
 * Appointment ids whose earlier "Clear" must be forgotten because the key
 * date they sit on is now a full-day Closed. A visit cleared while the day
 * was Covered ("doctor away, someone covers") is a different thing from a
 * visit on a day the office is shut, and must show up again.
 */
export function dismissalsToResetForClosure(
  row: Pick<KeyDateRecord, "startDate" | "endDate" | "officeStatus" | "openStart" | "openEnd">,
  appointments: Array<{ id: string; date: string; status?: string }>,
  dismissed: ReadonlySet<string>,
  todayIso: string,
): string[] {
  if (row.officeStatus !== "Closed" || keyDateHasHours(row)) return [];
  return appointments
    .filter(
      (appt) =>
        dismissed.has(appt.id) &&
        isBookedStatus(appt.status) &&
        appt.date >= todayIso &&
        isDateInRange(appt.date, row.startDate, row.endDate),
    )
    .map((appt) => appt.id);
}

/** Today as YYYY-MM-DD in the browser's local time. */
export function todayIsoLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD → mm/dd/yy (for example 2026-10-29 → 10/29/26). Anything else passes through. */
export function formatShortDateFromIso(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  if (!year || !month || !day) return dateIso;
  return `${month}/${day}/${year.slice(-2)}`;
}

/** "10/29/26" or "12/24/26 - 01/03/27". */
export function formatKeyDateRangeShort(row: Pick<KeyDateRecord, "startDate" | "endDate">): string {
  const start = formatShortDateFromIso(row.startDate);
  return row.startDate === row.endDate ? start : `${start} - ${formatShortDateFromIso(row.endDate)}`;
}

/**
 * "Still booked" = the patient is still expected: Scheduled or Reschedule.
 * Canceled, No Show and anyone already seen (Check In / Check Out) are not.
 * A visit with no status is treated as Scheduled.
 */
export function isStillBookedStatus(status: string | undefined | null): boolean {
  return !status || status === "Scheduled" || status === "Reschedule";
}

export interface UpcomingClosedBookings {
  /** Still-booked visits dated today or later on this Closed date. */
  count: number;
  /** Of those, how many were hidden with "Clear". */
  cleared: number;
}

/**
 * The ONLY number the Key Dates table shows. Counts, per Closed key date that
 * has not ended yet, the Scheduled / Reschedule visits dated today or later
 * (for a date with special hours, only visits outside those hours). Past dates,
 * Open and Covered days and Closed days with nobody booked are simply absent
 * from the map, so the table shows a plain "—" for them.
 */
export function upcomingClosedBookings(
  rows: KeyDateRecord[],
  appointments: Array<{ id: string; date: string; startTime?: string; status?: string }>,
  todayIso: string,
  dismissed: ReadonlySet<string> = new Set(),
): Map<string, UpcomingClosedBookings> {
  const out = new Map<string, UpcomingClosedBookings>();
  for (const row of rows) {
    if (row.officeStatus !== "Closed" || row.endDate < todayIso) continue;
    let count = 0;
    let cleared = 0;
    for (const appt of appointments) {
      if (appt.date < todayIso || !isStillBookedStatus(appt.status)) continue;
      if (!isDateInRange(appt.date, row.startDate, row.endDate)) continue;
      if (
        keyDateHasHours(row) &&
        isTimeWithinHours(appt.startTime ?? "", {
          start: normalizeKeyDateTime(row.openStart),
          end: normalizeKeyDateTime(row.openEnd),
        })
      ) {
        continue;
      }
      count += 1;
      if (dismissed.has(appt.id)) cleared += 1;
    }
    if (count > 0) out.set(row.id, { count, cleared });
  }
  return out;
}

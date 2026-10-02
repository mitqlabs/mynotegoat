/**
 * US federal holidays, computed by rule for any year — no hardcoded
 * single-year table and no dependency. All dates are ISO `YYYY-MM-DD`
 * strings computed in UTC so they line up with the rest of the
 * scheduling code (which treats ISO dates as timezone-free calendar days).
 *
 * When a fixed-date holiday lands on a weekend, the federal government
 * observes it on the nearest weekday (Saturday → Friday, Sunday → Monday).
 * Both the actual day and the observed day are returned, because either
 * can be the day an office closes.
 */

export interface Holiday {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  name: string;
}

function toIso(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

/** The nth (1-based) given weekday (0 = Sun) of a month. */
function nthWeekday(year: number, monthIndex: number, weekday: number, n: number) {
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return toIso(year, monthIndex, day);
}

/** The last given weekday (0 = Sun) of a month. */
function lastWeekday(year: number, monthIndex: number, weekday: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, monthIndex, lastDay)).getUTCDay();
  return toIso(year, monthIndex, lastDay - ((lastDow - weekday + 7) % 7));
}

function fixed(year: number, monthIndex: number, day: number, name: string): Holiday[] {
  const actual: Holiday = { date: toIso(year, monthIndex, day), name };
  const dow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
  if (dow === 6) return [actual, { date: toIso(year, monthIndex, day - 1), name: `${name} (observed)` }];
  if (dow === 0) return [actual, { date: toIso(year, monthIndex, day + 1), name: `${name} (observed)` }];
  return [actual];
}

/** All US federal holidays for one calendar year, sorted by date. */
export function getUsFederalHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [
    ...fixed(year, 0, 1, "New Year's Day"),
    { date: nthWeekday(year, 0, 1, 3), name: "MLK Day" },
    { date: nthWeekday(year, 1, 1, 3), name: "Presidents Day" },
    { date: lastWeekday(year, 4, 1), name: "Memorial Day" },
    // Juneteenth became a federal holiday in 2021.
    ...(year >= 2021 ? fixed(year, 5, 19, "Juneteenth") : []),
    ...fixed(year, 6, 4, "Independence Day"),
    { date: nthWeekday(year, 8, 1, 1), name: "Labor Day" },
    { date: nthWeekday(year, 9, 1, 2), name: "Columbus / Indigenous Peoples' Day" },
    ...fixed(year, 10, 11, "Veterans Day"),
    { date: nthWeekday(year, 10, 4, 4), name: "Thanksgiving" },
    ...fixed(year, 11, 25, "Christmas Day"),
  ];
  return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * US federal holidays (actual and observed) between two ISO dates,
 * inclusive on both ends. Handles ranges that span years — including an
 * observed New Year's Day that falls on Dec 31 of the prior year.
 */
export function getUsFederalHolidaysInRange(startIso: string, endIso: string): Holiday[] {
  if (!startIso || !endIso || endIso < startIso) return [];
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) return [];
  const result: Holiday[] = [];
  // +1 so an observed New Year's Day on Dec 31 is picked up.
  for (let year = startYear; year <= endYear + 1; year += 1) {
    getUsFederalHolidays(year).forEach((holiday) => {
      if (holiday.date >= startIso && holiday.date <= endIso) result.push(holiday);
    });
  }
  return result.sort((left, right) => left.date.localeCompare(right.date));
}

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-26" → "Nov 26". */
export function formatHolidayShortDate(dateIso: string) {
  const [, month, day] = dateIso.split("-").map(Number);
  if (!month || !day) return dateIso;
  return `${shortMonths[month - 1]} ${day}`;
}

const shortWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11-26" → "Thu, Nov 26". */
export function formatHolidayWeekdayDate(dateIso: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (!year || !month || !day) return dateIso;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${shortWeekdays[weekday]}, ${formatHolidayShortDate(dateIso)}`;
}

const holidayNamesByYear = new Map<number, Map<string, string>>();

function holidayNamesForYear(year: number) {
  let names = holidayNamesByYear.get(year);
  if (!names) {
    names = new Map();
    for (const holiday of getUsFederalHolidays(year)) {
      const existing = names.get(holiday.date);
      names.set(holiday.date, existing ? `${existing} / ${holiday.name}` : holiday.name);
    }
    holidayNamesByYear.set(year, names);
  }
  return names;
}

/**
 * The US federal holiday (actual or observed) on an ISO date, or null.
 * Checks the following year too, so an observed New Year's Day that
 * lands on Dec 31 is found.
 */
export function getUsFederalHolidayName(dateIso: string): string | null {
  const year = Number(dateIso.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return holidayNamesForYear(year).get(dateIso) ?? holidayNamesForYear(year + 1).get(dateIso) ?? null;
}

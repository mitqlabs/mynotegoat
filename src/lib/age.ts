/**
 * Patient age as of a given date (the visit's date of service), not today.
 * Notes are often written days later; the age printed in a note must be the
 * age on the encounter date. Falls back to today only when no date is given.
 */

/** Parses "MM/DD/YYYY" or "YYYY-MM-DD" into a local Date (date only). */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const v = (value ?? "").trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (match) {
    [m, d, y] = [+match[1], +match[2], +match[3]];
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v))) {
    [y, m, d] = [+match[1], +match[2], +match[3]];
  } else {
    return null;
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Whole years between dob and asOf (defaults to today). null if unknown. */
export function ageOn(dob: string | null | undefined, asOf?: string | Date | null): number | null {
  const birth = parseDateOnly(dob);
  if (!birth) return null;
  const ref = asOf instanceof Date ? asOf : parseDateOnly(asOf ?? "") ?? new Date();
  let age = ref.getFullYear() - birth.getFullYear();
  if (ref.getMonth() < birth.getMonth() || (ref.getMonth() === birth.getMonth() && ref.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/** String form for the {{AGE}} macro token ("" when unknown or under 1). */
export function ageTokenOn(dob: string | null | undefined, asOf?: string | Date | null): string {
  const age = ageOn(dob, asOf);
  return age !== null && age > 0 ? String(age) : "";
}

/** Header subline: "Male · Married · 34" — missing parts skipped; age from DOB as of today (or asOf). */
export function demographicsLine(sex: string | null | undefined, marital: string | null | undefined, dob: string | null | undefined, asOf?: string | Date | null): string {
  const age = ageOn(dob, asOf);
  return [sex?.trim(), marital?.trim(), age === null ? "" : String(age)].filter(Boolean).join(" · ");
}

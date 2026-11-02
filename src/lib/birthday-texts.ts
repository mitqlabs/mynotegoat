/**
 * Daily birthday texts — deciding WHO gets one today and WHAT it says.
 *
 * Pure on purpose (no database, no sending), so it can be tested with mock
 * patients. The queue route calls it during the office's daily reminder run;
 * the send log (birthday_text_log) is what keeps it to once per patient per
 * year.
 *
 * Rules:
 *   * only patients whose case status is Active;
 *   * never anyone marked "no text reminders" (that includes a STOP reply);
 *   * birthday = month and day of the date of birth, in the office time zone;
 *   * a Feb 29 birthday is celebrated on Feb 28 in years that have no Feb 29;
 *   * no phone number on file, or no first name = no text.
 */

import { isActiveCaseStatus, splitPatientName, withOptOutLine } from "@/lib/reminder-automation";
import { BIRTHDAY_MESSAGE_MAX, DEFAULT_BIRTHDAY_MESSAGE } from "@/lib/sms-reminders";

export { DEFAULT_BIRTHDAY_MESSAGE, BIRTHDAY_MESSAGE_MAX };

/** A patient row as read for the birthday check. */
export interface BirthdayPatient {
  patientId: string;
  fullName: string;
  /** Date of birth as saved on the patient ("YYYY-MM-DD"). */
  dob: string;
  phone: string;
  caseStatus: string;
  optedOut?: boolean;
}

export interface BirthdayRecipient {
  patientId: string;
  /** E.164 (+1XXXXXXXXXX). */
  phone: string;
  text: string;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Month and day from "YYYY-MM-DD" (a real calendar date; Feb 29 is allowed). null when unreadable. */
export function birthdayMonthDay(dob: string): { month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dob ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysIn = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day > daysIn ? null : { month, day };
}

/** Is today (an office-local "YYYY-MM-DD") this person's birthday? Feb 29 → Feb 28 in non-leap years. */
export function isBirthdayToday(dob: string, todayIso: string): boolean {
  const bd = birthdayMonthDay(dob);
  const t = birthdayMonthDay(todayIso);
  if (!bd || !t) return false;
  if (bd.month === t.month && bd.day === t.day) return true;
  const year = Number(todayIso.slice(0, 4));
  return bd.month === 2 && bd.day === 29 && !isLeapYear(year) && t.month === 2 && t.day === 28;
}

/**
 * The "MM-DD" endings a stored date of birth can have today, for a database
 * filter. Feb 28 in a non-leap year also includes "02-29".
 */
export function birthdayDobSuffixes(todayIso: string): string[] {
  const t = birthdayMonthDay(todayIso);
  if (!t) return [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const out = [`${pad(t.month)}-${pad(t.day)}`];
  const year = Number(todayIso.slice(0, 4));
  if (t.month === 2 && t.day === 28 && !isLeapYear(year)) out.push("02-29");
  return out;
}

/** "JOHN" / "john" → "John"; "Mary-Ann" and "McDonald" are left alone. */
function tidyFirstName(first: string): string {
  const name = first.trim();
  if (!name) return "";
  const allUpper = name === name.toUpperCase();
  const allLower = name === name.toLowerCase();
  if (!allUpper && !allLower) return name;
  return name.toLowerCase().replace(/(^|[-'’\s])([a-z\u00c0-\u024f])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The patient's first name as it goes in the text ("" when there is none). */
export function birthdayFirstName(fullName: string): string {
  return tidyFirstName(splitPatientName(fullName).firstName);
}

const FIRST_NAME_TOKEN = /\{\{\s*first[\s_-]*name\s*\}\}|\{\s*first[\s_-]*name\s*\}/gi;

/** Fill `{first name}` (also `{{FIRST_NAME}}`) into the wording. Empty wording uses the default. */
export function renderBirthdayText(template: string, fullName: string): string {
  const body = (template ?? "").trim() || DEFAULT_BIRTHDAY_MESSAGE;
  return body.replace(FIRST_NAME_TOKEN, () => birthdayFirstName(fullName)).trim();
}

/** US phone as +1XXXXXXXXXX; "" when it is not a 10-digit (or 1 + 10) number. */
export function birthdayPhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/**
 * Everyone who should get a birthday text today: Active, not opted out, birthday
 * today, a usable phone and a first name. Sorted by name so the list is stable.
 */
export function pickBirthdayRecipients(
  patients: BirthdayPatient[],
  todayIso: string,
  settings: { birthdayMessage?: string; optOutLine?: boolean; optOutText?: string },
): BirthdayRecipient[] {
  const seen = new Set<string>();
  return patients
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }))
    .flatMap((p) => {
      if (!p.patientId || seen.has(p.patientId)) return [];
      if (p.optedOut || !isActiveCaseStatus(p.caseStatus)) return [];
      if (!isBirthdayToday(p.dob, todayIso)) return [];
      const phone = birthdayPhone(p.phone);
      if (!phone || !birthdayFirstName(p.fullName)) return [];
      seen.add(p.patientId);
      const text = withOptOutLine(renderBirthdayText(settings.birthdayMessage ?? "", p.fullName), settings);
      return text ? [{ patientId: p.patientId, phone, text }] : [];
    });
}

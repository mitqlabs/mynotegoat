/**
 * Duplicate cases: the same first and last name is not an alarm.
 * The same name AND the same date of loss is. Manual entry, Quick Fill,
 * and auto-add all call findDuplicateCases — never a name-only check.
 */

export type DuplicateCandidate = {
  id: string;
  fullName: string;
  dateOfLoss?: string;
  deleted?: boolean;
};

function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** ISO yyyy-mm-dd, or "" when the text isn't a real date. */
export function duplicateDateIso(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!us) return "";
  const month = us[1].padStart(2, "0");
  const day = us[2].padStart(2, "0");
  const date = new Date(Date.UTC(Number(us[3]), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return "";
  return `${us[3]}-${month}-${day}`;
}

export function splitPatientName(fullName: string): { first: string; last: string } {
  const [last = "", first = ""] = fullName.split(",").map((part) => part.trim());
  if (first) return { first, last };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: parts[0] ?? "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function findDuplicateCases<T extends DuplicateCandidate>(
  patients: T[],
  input: { firstName: string; lastName: string; dateOfLoss?: string },
): T[] {
  const first = normName(input.firstName);
  const last = normName(input.lastName);
  const doi = duplicateDateIso(input.dateOfLoss);
  // Name alone, or a name with no date of loss, never raises the alarm.
  if (!first || !last || !doi) return [];
  return patients.filter((patient) => {
    if (patient.deleted) return false;
    const name = splitPatientName(patient.fullName);
    return normName(name.first) === first && normName(name.last) === last && duplicateDateIso(patient.dateOfLoss) === doi;
  });
}

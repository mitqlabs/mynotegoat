/**
 * Office (location) filter rules shared by the Patients list and the Schedule.
 *
 * STRICT: picking an office shows only patients assigned to it. Patients with
 * no office (or a deleted one) show under "All" and under the separate
 * "No office set" picker option (NO_OFFICE_FILTER).
 */

export const NO_OFFICE_LABEL = "No office set";
/** Picker value for "No office set" (never a real location id). */
export const NO_OFFICE_FILTER = "__no-office__";

/** True when the patient's office is blank or not one of the account's offices. */
export function hasNoOffice(locationId: string | undefined | null, officeIds: Iterable<string>): boolean {
  const id = (locationId ?? "").trim();
  if (!id) return true;
  for (const known of officeIds) if (known === id) return false;
  return true;
}

/** Should this patient show while `selectedId` is the office in view ("" = All)? */
export function matchesOfficeFilter(
  locationId: string | undefined | null,
  selectedId: string,
  officeIds: Iterable<string>,
): boolean {
  if (!selectedId) return true;
  const ids = Array.from(officeIds);
  if (selectedId === NO_OFFICE_FILTER) return hasNoOffice(locationId, ids);
  return (locationId ?? "").trim() === selectedId;
}

/**
 * CSS width for the patient-file Location dropdown: wide enough for the
 * longest office label (or "No office set"/"Removed office"), plus room for
 * padding and the arrow. Clamped so one very long name can't take the row.
 */
export function locationFieldWidth(
  locations: ReadonlyArray<{ name?: string; nickname?: string }>,
): string {
  const labels = [NO_OFFICE_LABEL, "Removed office", ...locations.map((l) => (l.nickname || "").trim() || (l.name || "").trim())];
  const longest = labels.reduce((m, s) => Math.max(m, s.length), 0);
  const ch = Math.min(Math.max(longest, 12), 32);
  return `calc(${ch}ch + 3.5rem)`;
}

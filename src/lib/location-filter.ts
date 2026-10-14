/**
 * Office (location) filter rules shared by the Patients list and the Schedule.
 *
 * A patient with no office set — or one pointing at an office that no longer
 * exists — shows under EVERY office (labeled "No office set") until someone
 * assigns one. Hiding them made picking an office empty the lists for accounts
 * whose patients predate Locations.
 */

export const NO_OFFICE_LABEL = "No office set";

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
  if (hasNoOffice(locationId, ids)) return true;
  return (locationId ?? "").trim() === selectedId;
}

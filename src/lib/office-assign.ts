import { NO_OFFICE_LABEL } from "@/lib/location-filter";

type Loc = { id: string; name?: string; nickname?: string };

const labelOf = (l: Loc) => (l.nickname || "").trim() || (l.name || "").trim() || "Location";

/** The label for a patient's office cell: the office name, or "No office set"
 *  when blank or pointing at a deleted office. */
export function officeCellLabel(locationId: string | undefined | null, locations: ReadonlyArray<Loc>): string {
  const loc = locations.find((l) => l.id === (locationId ?? ""));
  return loc ? labelOf(loc) : NO_OFFICE_LABEL;
}

/** Menu choices for the office cell: each office, then "No office set" (clears). */
export function officeMenuChoices(locations: ReadonlyArray<Loc>): Array<{ id: string; label: string }> {
  return [...locations.map((l) => ({ id: l.id, label: labelOf(l) })), { id: "", label: NO_OFFICE_LABEL }];
}

/** Patient patch for choosing an office ("" clears it, stored as null in the cloud). */
export function officePatch(locationId: string): { locationId: string | undefined } {
  const id = locationId.trim();
  return { locationId: id || undefined };
}

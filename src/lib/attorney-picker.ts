/**
 * Office-attorney dropdown: alphabetical firms, with SELF pinned at the top.
 *
 * "The Grigoryan Law Firm" sorts with G, and "The Firm LA" with F. SELF is a
 * case value for someone representing themselves — not a contact, and not a
 * phone number to copy onto the case.
 */

export const SELF_ATTORNEY_VALUE = "SELF";
export const SELF_ATTORNEY_LABEL = "SELF (self-represented)";
export const ATTORNEY_PLACEHOLDER = "Select attorney…";
export const ATTORNEY_CUSTOM_LABEL = "Type a new attorney…";
export const ATTORNEY_CUSTOM_VALUE = "__custom__";

const SELF_ALIASES = new Set([
  "self",
  "pro se",
  "pro per",
  "in pro per",
  "self represented",
]);

/** "Self", "self", "pro se", "pro-se", and "self-represented" are the SELF option. */
export function isSelfRepresentedAttorney(value: string): boolean {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SELF_ALIASES.has(key);
}

/** Sort key: case-insensitive, and a leading "The " does not count. */
export function attorneyPickerSortKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/^the\s+/i, "");
}

export function compareAttorneyPickerNames(a: string, b: string): number {
  const primary = attorneyPickerSortKey(a).localeCompare(attorneyPickerSortKey(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (primary !== 0) return primary;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export type AttorneyFirmOption = { id: string; name: string; phone: string };

/**
 * Firms for the dropdown, A–Z. Drops blanks, exact-duplicate names, and
 * anything that is really the SELF option (so a contact named "Self" does
 * not show up as a firm or supply a phone).
 */
export function attorneyFirmOptions<T extends { id: string; name: string; phone?: string }>(
  contacts: T[],
): AttorneyFirmOption[] {
  const seen = new Set<string>();
  const firms: AttorneyFirmOption[] = [];
  for (const contact of contacts) {
    const name = contact.name.trim().replace(/\s+/g, " ");
    if (!name || isSelfRepresentedAttorney(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    firms.push({ id: contact.id, name, phone: contact.phone ?? "" });
  }
  firms.sort((a, b) => compareAttorneyPickerNames(a.name, b.name));
  return firms;
}

export function matchingAttorneyFirm<T extends { name: string }>(
  firms: T[],
  value: string,
): T | undefined {
  if (!value.trim() || isSelfRepresentedAttorney(value)) return undefined;
  const key = value.trim().replace(/\s+/g, " ").toLowerCase();
  return firms.find((firm) => firm.name.trim().replace(/\s+/g, " ").toLowerCase() === key);
}

/** A typed name that is neither blank, nor SELF, nor one of the office firms. */
export function isCustomAttorneyEntry(value: string, firms: { name: string }[]): boolean {
  const trimmed = value.trim();
  if (!trimmed || isSelfRepresentedAttorney(trimmed)) return false;
  return !matchingAttorneyFirm(firms, trimmed);
}

export type AttorneyPick =
  | { type: "empty" }
  | { type: "self" }
  | { type: "custom" }
  | { type: "firm"; name: string; phone: string };

/** What a dropdown choice means. SELF never carries a phone. */
export function resolveAttorneyPick(selectValue: string, firms: AttorneyFirmOption[]): AttorneyPick {
  if (!selectValue) return { type: "empty" };
  if (selectValue === ATTORNEY_CUSTOM_VALUE) return { type: "custom" };
  if (selectValue === SELF_ATTORNEY_VALUE || isSelfRepresentedAttorney(selectValue)) return { type: "self" };
  const firm = firms.find((entry) => entry.name === selectValue) ?? matchingAttorneyFirm(firms, selectValue);
  if (firm) return { type: "firm", name: firm.name, phone: firm.phone };
  return { type: "custom" };
}

/**
 * Which option is selected. "pro se" / "Self" select SELF. An unknown name
 * selects "Type a new attorney…" while `typingNew` is set.
 */
export function attorneySelectValue(attorney: string, firms: AttorneyFirmOption[], typingNew: boolean): string {
  if (typingNew) return ATTORNEY_CUSTOM_VALUE;
  if (isSelfRepresentedAttorney(attorney)) return SELF_ATTORNEY_VALUE;
  return matchingAttorneyFirm(firms, attorney)?.name ?? "";
}

/**
 * Single source of truth for the {{MR_MRS_MS_*}} salutation tokens.
 *
 * Rules (per user feedback 2026-05-05):
 *   - Male  → "Mr." always, regardless of marital status (filled or blank)
 *   - Female + Married → "Mrs."
 *   - Female + anything else (single, blank, divorced, etc.) → "Ms."
 *   - Sex unknown / "Other" / empty → "Mr./Ms." (no clinical "Mx.")
 *
 * Matching is case-insensitive and tolerant of single-letter inputs
 * ("M" / "F") and stray whitespace, so SQL-imported patients whose
 * sex field came in with mixed casing or short codes still resolve
 * correctly instead of silently falling through to the unknown branch.
 */
export function getFormalTitle(sex: string | undefined | null, maritalStatus: string | undefined | null): string {
  const s = (sex ?? "").trim().toLowerCase();
  const m = (maritalStatus ?? "").trim().toLowerCase();
  if (s === "male" || s === "m") return "Mr.";
  if (s === "female" || s === "f") return m === "married" ? "Mrs." : "Ms.";
  return "Mr./Ms.";
}

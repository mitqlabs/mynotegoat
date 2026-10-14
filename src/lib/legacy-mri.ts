/**
 * The old CaseMate import put the MRI FACILITY NAME (e.g. "BROADWAY IMAGING
 * CENTER") into the MRI / CT findings field. That text isn't findings, so
 * it must not show as findings, print in reports, or feed G.O.A.T.
 * Real findings text is always kept.
 */

const FINDING_WORDS =
  /\b(disc|disk|herniat\w*|bulg\w*|protru\w*|extru\w*|stenosis|narrow\w*|impinge\w*|tear|fracture|edema|spondyl\w*|degenerat\w*|annular|foramin\w*|thecal|cord|ligament|effusion|mm|impression|findings?|normal|unremarkable|[CTLS]\d)/i;
const FACILITY_WORDS = /\b(imaging|radiology|diagnostic\w*|center|centre|mri|open|medical|clinic|hospital|health|scan\w*|x-?ray|inc|llc)\b/i;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** True when the legacy findings text is just an imaging facility name. */
export function isFacilityOnlyMriText(text: string, centers: string[] = []): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  // Status words the import also dropped in here — not findings either.
  if (/^(n\/?a|none|-+|patient refused|refused|completed prior care|prior care|no mri( \/ ct)?|not needed|pending)$/i.test(t)) return true;
  if (t.length > 80 || /\n/.test(t) || FINDING_WORDS.test(t)) return false;
  const n = norm(t);
  if (centers.some((c) => c && norm(c) === n)) return true;
  if (FACILITY_WORDS.test(t)) return true;
  // All-caps short label with no finding words (how the import wrote names).
  return !/[a-z]/.test(t) && t.split(/\s+/).length <= 6;
}

/** The legacy findings text to use, or "" when it's only a facility name. */
export function usableLegacyMriFindings(text: string, centers: string[] = []): string {
  const t = (text ?? "").trim();
  return isFacilityOnlyMriText(t, centers) ? "" : t;
}

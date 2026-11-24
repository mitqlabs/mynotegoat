/**
 * Additional dates of injury (pure, no React / storage).
 *
 * A patient keeps ONE primary Date Of Injury (`dateOfLoss`, which builds the Case #).
 * When they are hurt again during care (a second accident), the extra dates are
 * added to the same record. They are stored as one comma-separated string of ISO
 * dates under `matrix.additionalDois` (the patients.matrix jsonb column), so they
 * ride the existing cloud sync and the patient page's field-level merge, and no
 * database migration is needed.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIso(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The saved string → sorted, de-duplicated, valid ISO dates. Anything unreadable is dropped. */
export function parseAdditionalDois(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const v = part.trim();
    if (validIso(v)) out.add(v);
  }
  return [...out].sort();
}

/** The extra dates to show or print: saved extras, minus any that equal the primary DOI. */
export function extraDoisFor(primaryIso: string, raw: string | null | undefined): string[] {
  return parseAdditionalDois(raw).filter((d) => d !== primaryIso);
}

/** ISO dates → the saved string ("" when there are none, so the field clears cleanly). */
export function serializeAdditionalDois(list: string[]): string {
  return parseAdditionalDois(list.join(",")).join(",");
}

/** What was typed (mm/dd/yy, mm/dd/yyyy or an ISO date) → ISO, or "" if it is not a real date. */
export function usInputToIso(input: string): string {
  const t = input.trim();
  if (validIso(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return validIso(iso) ? iso : "";
}

/** ISO → mm/dd/yy (screen display). Anything else passes through. */
export function isoToShortUs(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : iso;
}

/** ISO → mm/dd/yyyy (reports and letters, matching the Date Of Injury token). */
export function isoToLongUs(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

export type AddDoiResult = { list: string[]; error?: string };

/** Add a typed date to the list; refuses blanks, bad dates, repeats and the primary DOI. */
export function addAdditionalDoi(current: string[], primaryIso: string, typed: string): AddDoiResult {
  const iso = usInputToIso(typed);
  if (!iso) return { list: current, error: "Enter a real date, like 11/02/26." };
  if (iso === primaryIso) return { list: current, error: "That is already the main date of injury." };
  if (current.includes(iso)) return { list: current, error: "That date is already added." };
  return { list: [...current, iso].sort() };
}

/** Report / letter tokens, mm/dd/yy, comma-separated ("01/05/26, 02/20/26"). ALL lists the main DOI first. */
export function doiTokens(primaryIso: string, additionalRaw: string | null | undefined): {
  ADDITIONAL_DATES_OF_INJURY: string;
  ALL_DATES_OF_INJURY: string;
} {
  const extras = extraDoisFor(primaryIso, additionalRaw).map(isoToShortUs);
  const primary = primaryIso ? [isoToShortUs(primaryIso)] : [];
  return {
    ADDITIONAL_DATES_OF_INJURY: extras.join(", "),
    ALL_DATES_OF_INJURY: [...primary, ...extras].join(", "),
  };
}

/**
 * A letter / MRI request / referral that prints "Date of Injury: {{DATE_OF_INJURY}}" should list EVERY
 * date of injury when the patient has more than one. This rewrites just that label + token pair (offices'
 * saved templates included, no template edit needed) to "Dates of Injury: {{ALL_DATES_OF_INJURY}}".
 * Only the "Label: token" form is rewritten; sentences like "related to date of injury {{DATE_OF_INJURY}}" are left alone.
 */
export function withAllDoisLabel(body: string): string {
  const gap = "(?:\\s|&nbsp;|<\\/?[a-z][^>]*>)*";
  const pattern = new RegExp(`\\b(Date of Injury)(${gap}:${gap})\\{\\{DATE_OF_INJURY\\}\\}`, "gi");
  return body.replace(pattern, (_m, label: string, between: string) =>
    `${label.replace(/^date/i, (d) => (d === d.toUpperCase() ? `${d}S` : `${d}s`))}${between}{{ALL_DATES_OF_INJURY}}`);
}

/** Union of two saved strings (used when two patient records are merged, so no accident is lost). */
export function unionAdditionalDois(a: string | null | undefined, b: string | null | undefined): string {
  return serializeAdditionalDois([...parseAdditionalDois(a), ...parseAdditionalDois(b)]);
}

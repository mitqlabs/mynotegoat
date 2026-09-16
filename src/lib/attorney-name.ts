/**
 * Attorney name matching.
 *
 * "John Smith", "John Smith Law" and "John Smith Attorneys at Law" are one
 * firm typed three ways. "John Smith" and "John Doe" are two people who
 * happen to share a first name. The difference is the CORE of the name —
 * what's left after the firm boilerplate comes off.
 */

const ENTITY_WORDS =
  /\b(llp|llc|pllc|pc|inc|ltd|esq|esquire|pa|plc|co)\b/g;
const FIRM_WORDS =
  /\b(law|laws|firm|lawyer|lawyers|attorney|attorneys|attorneyatlaw|associates|associate|office|offices|legal|group|partners|practice|counsel|counselors|chartered|injury|accident|at|of|and|the)\b/g;

/** The distinctive part of a firm name, lowercased ("john smith"). */
export function normalizeAttorneyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(ENTITY_WORDS, " ")
    .replace(FIRM_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function attorneyCoreTokens(value: string): string[] {
  return normalizeAttorneyKey(value).split(/\s+/).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Same firm? Deliberately strict — it only groups names it can defend:
 *   * the cores match exactly ("John Smith Law" vs "John Smith")
 *   * one core's words are all inside the other's, and the shorter one is
 *     a full name, not a bare surname ("John Smith" vs "John Smith Injury")
 *   * a near-identical core: a typo, not a different name ("Smth" vs "Smith")
 * Anything looser was grouping unrelated people who shared a surname.
 */
export function attorneysSimilar(a: string, b: string): boolean {
  const na = normalizeAttorneyKey(a);
  const nb = normalizeAttorneyKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = attorneyCoreTokens(a);
  const tb = attorneyCoreTokens(b);
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length >= 2) {
    const bigSet = new Set(big);
    if (small.every((t) => bigSet.has(t))) return true;
  }

  // Typo tolerance, tight: ~1 character in 8, and never on short names.
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen < 8) return false;
  return levenshtein(na, nb) / maxLen < 0.13;
}

/**
 * Shared name matching for patient search boxes and G.O.A.T.
 * A word followed by a space is a WHOLE word ("armen " finds Armen, not
 * Armenuhi); only the last word, while still being typed, matches part of a name.
 * A finished one-letter word next to another word matches the start of a name part ("j gallardo").
 */
export function searchWords(rawQuery: string): Array<{ word: string; whole: boolean }> {
  const words = rawQuery.toLowerCase().replace(/[,.:;]/g, " ").split(/\s+/).filter(Boolean);
  const open = /[^\s]$/.test(rawQuery);
  return words.map((word, i) => ({ word, whole: i < words.length - 1 || !open }));
}

/** True when every typed word is in the text (whole words as above). */
export function nameSearchMatches(text: string, rawQuery: string): boolean {
  const ws = searchWords(rawQuery);
  if (!ws.length) return true;
  const hay = text.toLowerCase().replace(/[,.:;]/g, " ");
  const tokens = hay.split(/[^a-z0-9'-]+/).filter(Boolean);
  return ws.every(({ word, whole }) => {
    if (!whole) return hay.includes(word);
    if (tokens.includes(word)) return true;
    // "j gallardo" — a finished one-letter word beside another word starts a name
    // part. A one-letter word by itself stays whole ("j " is not every J name).
    if (word.length === 1 && ws.length > 1 && /[a-z]/.test(word) && tokens.some((token) => token.startsWith(word))) return true;
    return /[^a-z0-9'-]/.test(word) && hay.includes(word);
  });
}

/**
 * Patient List and Case List search. Both call this so a multi-word name
 * matches the same way in either box: split on spaces and commas, then every
 * word must hit the joined fields (name, and DOB / phone / case number /
 * attorney when that box searches them). A word followed by a space is a
 * whole word; the last word, while still being typed, matches part of a field.
 * A blank query matches every row.
 */
export function matchesPatientListQuery(query: string, fields: Array<string | null | undefined>): boolean {
  if (!query.trim()) return true;
  const haystack = fields.map((field) => (field ?? "").trim()).filter(Boolean).join(" ");
  return nameSearchMatches(haystack, query);
}

/** Active cases first; the rest only when no active one matches (else behind "show inactive"). */
export function activeFirst<T>(list: T[], isActive: (x: T) => boolean): { shown: T[]; hidden: T[] } {
  const active = list.filter(isActive);
  if (!active.length) return { shown: list, hidden: [] };
  return { shown: active, hidden: list.filter((x) => !isActive(x)) };
}

export const isActiveCase = (status: string | undefined) => !status || status === "Active";

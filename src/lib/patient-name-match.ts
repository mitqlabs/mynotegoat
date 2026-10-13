/**
 * Shared name matching for patient search boxes and G.O.A.T.
 * A word followed by a space is a WHOLE word ("armen " finds Armen, not
 * Armenuhi); only the last word, while still being typed, matches part of a name.
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
  return ws.every(({ word, whole }) => (whole ? tokens.includes(word) || (/[^a-z0-9'-]/.test(word) && hay.includes(word)) : hay.includes(word)));
}

/** Active cases first; the rest only when no active one matches (else behind "show inactive"). */
export function activeFirst<T>(list: T[], isActive: (x: T) => boolean): { shown: T[]; hidden: T[] } {
  const active = list.filter(isActive);
  if (!active.length) return { shown: list, hidden: [] };
  return { shown: active, hidden: list.filter((x) => !isActive(x)) };
}

export const isActiveCase = (status: string | undefined) => !status || status === "Active";

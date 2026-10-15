/**
 * Field-level merge for long-open forms (the patient page).
 *
 * baseline = what the form showed when it loaded (or last saved / last took in).
 * - A save sends ONLY fields the user changed since the baseline, so a stale
 *   tab can never put old values back over newer ones written elsewhere.
 * - An outside change (G.O.A.T., another tab, another user) replaces a field
 *   on screen only when the user hasn't touched that field.
 */

export type Flat = Record<string, string>;

const enc = (v: unknown) => (v === undefined ? "\u0000undef" : JSON.stringify(v));

/** { a: 1, matrix: { x: "2" } } → { "a": "1", "matrix.x": "\"2\"" } (one level of nesting for `matrix`). */
export function flatten(obj: Record<string, unknown>, nested: string[] = ["matrix"]): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj)) {
    if (nested.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[`${k}.${k2}`] = enc(v2);
    } else out[k] = enc(v);
  }
  return out;
}

/** Keys whose value differs from the baseline (the user's edits). */
export function editedKeys(current: Flat, baseline: Flat, ignore: string[] = []): string[] {
  return Object.keys(current).filter((k) => !ignore.includes(k) && current[k] !== baseline[k]);
}

/** Only the edited fields of `full`, rebuilt with nested `matrix`. */
export function editedPatch<T extends Record<string, unknown>>(full: T, baseline: Flat, opts: { ignore?: string[]; always?: string[] } = {}): Partial<T> | null {
  const cur = flatten(full);
  const keys = editedKeys(cur, baseline, [...(opts.ignore ?? []), ...(opts.always ?? [])]);
  if (!keys.length) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const dot = k.indexOf(".");
    if (dot > 0) {
      const top = k.slice(0, dot);
      const sub = k.slice(dot + 1);
      out[top] = { ...((out[top] as Record<string, unknown>) ?? {}), [sub]: (full[top] as Record<string, unknown>)[sub] };
    } else out[k] = full[k];
  }
  for (const k of opts.always ?? []) if (k in full) out[k] = full[k];
  return out as Partial<T>;
}

/**
 * Which outside values to take in: those that changed (vs the baseline) on
 * fields the user hasn't edited. Edited fields are left alone (the user's
 * pending edit wins when they save).
 */
export function takeExternal(baseline: Flat, current: Flat, incoming: Flat): { take: string[]; conflicts: string[] } {
  const take: string[] = [];
  const conflicts: string[] = [];
  for (const k of Object.keys(incoming)) {
    if (incoming[k] === baseline[k]) continue;
    if (current[k] === baseline[k] || current[k] === incoming[k]) take.push(k);
    else conflicts.push(k);
  }
  return { take, conflicts };
}

export const decodeFlat = (s: string): unknown => (s === "\u0000undef" ? undefined : JSON.parse(s));

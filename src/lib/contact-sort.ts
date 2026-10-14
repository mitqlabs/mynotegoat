/** Contacts list sorting + per-category colors. Pure, testable. */

export type ContactSortKey = "name" | "category";
export type ContactSortDir = "asc" | "desc";
export type ContactSort = { key: ContactSortKey; dir: ContactSortDir };

export const CONTACT_SORT_STORAGE_KEY = "casemate.contacts-sort.v1";
export const DEFAULT_CONTACT_SORT: ContactSort = { key: "name", dir: "asc" };

const cmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * Name sort: A–Z (or Z–A). Category sort: categories A–Z (or Z–A), and
 * names inside each category are ALWAYS A–Z.
 */
export function sortContacts<T extends { name: string; category: string }>(list: T[], sort: ContactSort): T[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    if (sort.key === "category") {
      const c = cmp(a.category || "", b.category || "");
      if (c !== 0) return c * sign;
      return cmp(a.name || "", b.name || "");
    }
    return cmp(a.name || "", b.name || "") * sign;
  });
}

export function parseContactSort(raw: string | null): ContactSort {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<ContactSort> | null;
    if (v && (v.key === "name" || v.key === "category") && (v.dir === "asc" || v.dir === "desc")) {
      return { key: v.key, dir: v.dir };
    }
  } catch {
    // fall through
  }
  return DEFAULT_CONTACT_SORT;
}

/** Clicking a header: same column flips direction; new column starts A–Z. */
export function nextContactSort(current: ContactSort, key: ContactSortKey): ContactSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

const PALETTE = [
  { bg: "#e8f1fb", fg: "#2b6aa6" },
  { bg: "#eaf6ef", fg: "#2f7a52" },
  { bg: "#fbefe6", fg: "#a6602b" },
  { bg: "#f1ecfa", fg: "#6a4fa6" },
  { bg: "#fbeaf0", fg: "#a63f68" },
  { bg: "#e9f5f6", fg: "#2a7c84" },
  { bg: "#f7f3e3", fg: "#8a6d1f" },
  { bg: "#eef0f3", fg: "#55606e" },
];

/** Stable pastel color for a string (same category → same color). */
export function pastelFor(value: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of value.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialsFor(name: string): string {
  const words = name.replace(/^dr\.?\s+/i, "").split(/[\s&,.-]+/).filter((w) => /[a-z0-9]/i.test(w));
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

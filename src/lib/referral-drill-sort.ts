/** Sorting for the dashboard referral drill-down patient list. */
export type DrillSort = { key: "name" | "sent" | "attorney" | "dol"; dir: "asc" | "desc" };
const KEYS: DrillSort["key"][] = ["name", "sent", "attorney", "dol"];
export const DRILL_SORT_KEY = "casemate.referral-drill-sort.v1";
export const DEFAULT_DRILL_SORT: DrillSort = { key: "name", dir: "asc" };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** "MM/DD/YYYY" or "YYYY-MM-DD" → sortable "YYYY-MM-DD". */
function iso(value: string): string {
  const raw = (value ?? "").trim();
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : raw;
}

/**
 * Name / Attorney: A–Z, case-insensitive. Sent / Date of Loss: newest first by
 * default. Blanks always last; ties by name.
 */
export function sortDrillPatients<T extends { name: string; sentDate: string; attorney?: string; dateOfLoss?: string }>(rows: T[], sort: DrillSort): T[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sort.key === "sent" || sort.key === "dol") {
      const ad = iso(sort.key === "sent" ? a.sentDate : a.dateOfLoss ?? "");
      const bd = iso(sort.key === "sent" ? b.sentDate : b.dateOfLoss ?? "");
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      if (ad !== bd) return sign * ad.localeCompare(bd);
      return byName(a.name, b.name);
    }
    if (sort.key === "attorney") {
      const aa = (a.attorney ?? "").trim();
      const ba = (b.attorney ?? "").trim();
      if (aa && !ba) return -1;
      if (!aa && ba) return 1;
      const c = byName(aa, ba);
      return c ? sign * c : byName(a.name, b.name);
    }
    return sign * byName(a.name, b.name);
  });
}

export function parseDrillSort(raw: string | null): DrillSort {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<DrillSort> | null;
    if (v && v.key && KEYS.includes(v.key) && (v.dir === "asc" || v.dir === "desc")) return { key: v.key, dir: v.dir };
  } catch {
    // default
  }
  return DEFAULT_DRILL_SORT;
}

/** Same header flips direction; a new header starts at its natural order (names A–Z, dates newest first). */
export function nextDrillSort(cur: DrillSort, key: DrillSort["key"]): DrillSort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "sent" || key === "dol" ? "desc" : "asc" };
}

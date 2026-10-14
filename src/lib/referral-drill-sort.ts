/** Sorting for the dashboard referral drill-down patient list. */
export type DrillSort = { key: "name" | "sent"; dir: "asc" | "desc" };
export const DRILL_SORT_KEY = "casemate.referral-drill-sort.v1";
export const DEFAULT_DRILL_SORT: DrillSort = { key: "name", dir: "asc" };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** "MM/DD/YYYY" or "YYYY-MM-DD" → sortable "YYYY-MM-DD". */
function iso(value: string): string {
  const raw = (value ?? "").trim();
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : raw;
}

/** Name: A–Z (Last, First as stored), case-insensitive. Sent: newest first by default; undated last; ties by name. */
export function sortDrillPatients<T extends { name: string; sentDate: string }>(rows: T[], sort: DrillSort): T[] {
  return [...rows].sort((a, b) => {
    if (sort.key === "sent") {
      const ad = iso(a.sentDate);
      const bd = iso(b.sentDate);
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      if (ad !== bd) return (sort.dir === "desc" ? -1 : 1) * ad.localeCompare(bd);
      return byName(a.name, b.name);
    }
    return (sort.dir === "desc" ? -1 : 1) * byName(a.name, b.name);
  });
}

export function parseDrillSort(raw: string | null): DrillSort {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<DrillSort> | null;
    if (v && (v.key === "name" || v.key === "sent") && (v.dir === "asc" || v.dir === "desc")) return { key: v.key, dir: v.dir };
  } catch {
    // default
  }
  return DEFAULT_DRILL_SORT;
}

/** Same header flips direction; a new header starts at its natural order (name A–Z, sent newest first). */
export function nextDrillSort(cur: DrillSort, key: DrillSort["key"]): DrillSort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "sent" ? "desc" : "asc" };
}

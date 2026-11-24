/**
 * A visit that lands on a full-day CLOSED key date (a sick day, a holiday
 * the office already marked closed) is still saved. It is marked Canceled
 * and the user is told — the schedule never drops it quietly and never
 * refuses the save.
 */
import { findClosedKeyDateForDate, formatUsDateFromIso, type KeyDateRecord } from "@/lib/key-dates";

export type ClosedDateHit = { dateIso: string; reason: string };

export function closedDateHit(rows: KeyDateRecord[], dateIso: string): ClosedDateHit | null {
  const row = findClosedKeyDateForDate(rows, dateIso);
  if (!row) return null;
  return { dateIso, reason: (row.reason ?? "").trim() };
}

export function closedDateNote(reason: string, existing = ""): string {
  const tag = reason.trim() ? `Closed: ${reason.trim()}` : "Closed";
  const rest = existing.trim();
  if (!rest) return tag;
  if (rest.startsWith(tag)) return rest;
  return `${tag} — ${rest}`;
}

/** One popup for every closed day in the save, so nothing is quiet. */
export function closedDateNotice(hits: ClosedDateHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((hit) => {
    const when = formatUsDateFromIso(hit.dateIso);
    return hit.reason ? `${when} (${hit.reason})` : when;
  });
  if (hits.length === 1) {
    return `${lines[0]} is a closed day.\n\nThe appointment was still scheduled and marked Canceled.`;
  }
  return `These days are closed:\n• ${lines.join("\n• ")}\n\nThose appointments were still scheduled and marked Canceled.`;
}

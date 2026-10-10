/**
 * Fill Treatment Plan — which later visits it may touch (pure, unit-tested).
 *
 * "That day is done": a Checked Out visit or a closed note is never changed,
 * and nothing dated on or before the open (source) note is ever looked at.
 *
 *   • New note   — visit dated AFTER the source note, Checked In, no note yet.
 *                  Past dates are allowed here: the patient came and nobody
 *                  charted it yet, which is exactly what Fill is for.
 *   • Refresh S/O/A of an existing note (re-exam) — only when the visit is
 *                  Checked In, the note is still open, and it's dated today or
 *                  later. A past day with a note is left alone even if open.
 *   • Everything else is skipped, with a reason.
 */

export type FillVisitStatus = "Scheduled" | "Check In" | "Check Out" | "Canceled" | "No Show" | string;

export type FillDecision =
  | { action: "fill" }
  | { action: "refresh" }
  | { action: "skip"; kind: "done" | "past" | "inactive" | "notCheckedIn"; reason: string };

export function decideFillVisit(input: {
  /** ISO YYYY-MM-DD of the visit, the source note, and today (local). */
  dateIso: string;
  sourceIso: string;
  todayIso: string;
  status: FillVisitStatus;
  /** The note already on that visit, if any. */
  note: { signed: boolean } | null;
}): FillDecision | null {
  const { dateIso, sourceIso, todayIso, status, note } = input;
  // On or before the open note: never part of a fill.
  if (!dateIso || !sourceIso || dateIso <= sourceIso) return null;
  if (status === "Canceled") return { action: "skip", kind: "inactive", reason: "Canceled" };
  if (status === "No Show") return { action: "skip", kind: "inactive", reason: "No Show" };
  if (status === "Check Out") return { action: "skip", kind: "done", reason: "Checked Out — that day is done" };
  if (note?.signed) return { action: "skip", kind: "done", reason: "Note is closed — that day is done" };
  if (status !== "Check In") return { action: "skip", kind: "notCheckedIn", reason: "Not checked in yet" };
  if (!note) return { action: "fill" };
  if (dateIso < todayIso) return { action: "skip", kind: "past", reason: "Past visit already has a note — open it to edit" };
  return { action: "refresh" };
}

/** "10/02–10/30" (or one date) from US MM/DD/YYYY dates in order. */
export function fillDateSpan(datesUs: string[]): string {
  if (!datesUs.length) return "";
  const short = (d: string) => d.slice(0, 5);
  const first = short(datesUs[0]);
  const last = short(datesUs[datesUs.length - 1]);
  return first === last ? first : `${first}–${last}`;
}

/** The confirm text shown before anything is written. */
export function fillConfirmText(input: {
  fillDatesUs: string[];
  doneCount: number;
  pastWithNoteCount: number;
  examDatesUs: string[];
  sourceDateUs: string;
}): string {
  const n = input.fillDatesUs.length;
  const lines = [
    `Will fill ${n} upcoming visit${n === 1 ? "" : "s"}${n ? ` (${fillDateSpan(input.fillDatesUs)})` : ""}. Skipping ${input.doneCount} already checked out/closed.`,
  ];
  if (input.pastWithNoteCount) {
    lines.push(`Also skipping ${input.pastWithNoteCount} past visit${input.pastWithNoteCount === 1 ? "" : "s"} that already ${input.pastWithNoteCount === 1 ? "has a note" : "have notes"}.`);
  }
  if (input.examDatesUs.length) {
    lines.push(`Exam visits are left for you to chart: ${input.examDatesUs.join(", ")}.`);
  }
  lines.push(
    `Only visits after ${input.sourceDateUs} that are Checked In are filled, then closed + checked out. Earlier dates, checked-out visits and closed notes are never changed.`,
  );
  return lines.join("\n\n");
}

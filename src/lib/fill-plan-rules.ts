/**
 * Fill Treatment Plan — which later visits it may touch (pure, unit-tested).
 *
 * "That day is done": a Checked Out visit or a closed note is never changed,
 * and nothing dated on or before the open (source) note is ever looked at.
 *
 *   • New note   — visit dated AFTER the source note, Checked In, no note yet,
 *                  dated today or later.
 *   • Past visit (before today) Checked In with no note — rare / accidental,
 *                  so never filled silently ("fillPast"): Fill's one prompt
 *                  lists them on their own line, and Cancel changes nothing.
 *   • Refresh S/O/A of an existing note (re-exam) — only when the visit is
 *                  Checked In, the note is still open, and it's dated today or
 *                  later. A past day with a note is left alone even if open.
 *   • Everything else is skipped, with a reason.
 */

export type FillVisitStatus = "Scheduled" | "Check In" | "Check Out" | "Canceled" | "No Show" | string;

export type FillDecision =
  | { action: "fill" }
  | { action: "fillPast" }
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
  if (!note) return dateIso < todayIso ? { action: "fillPast" } : { action: "fill" };
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

/** "09/03" from "09/03/2026". */
const shortUs = (d: string) => d.slice(0, 5);

/**
 * The ONE prompt Fill Treatment Plan shows before anything is written.
 * Lists exactly the visits it will fill; zero counts are left out.
 *   • kind "confirm": ask Fill / Cancel.
 *   • kind "nothing": a short notice (OK only), nothing qualifies.
 * `text` is the same prompt as plain text (window.confirm / tests).
 */
export type FillPrompt = {
  kind: "confirm" | "nothing";
  title: string;
  lines: string[];
  text: string;
};

export const FILL_NOTHING_TEXT = "Nothing to fill. All visits are already done or checked out.";
export const FILL_UNCHANGED_LINE = "Checked-out visits won't change.";

export function fillPromptText(input: {
  /** Checked In visits dated today or later with no note (MM/DD/YYYY, in order). */
  upcomingDatesUs: string[];
  /** Past Checked In visits with no note (MM/DD/YYYY, in order). */
  pastDatesUs: string[];
}): FillPrompt {
  const upcoming = input.upcomingDatesUs;
  const past = input.pastDatesUs;
  const n = upcoming.length + past.length;
  if (!n) return { kind: "nothing", title: FILL_NOTHING_TEXT, lines: [], text: FILL_NOTHING_TEXT };
  const title = `Fill ${n} visit${n === 1 ? "" : "s"} from the treatment plan?`;
  const list = (dates: string[]) => dates.map(shortUs).join(", ");
  const lines =
    upcoming.length && past.length
      ? [`Upcoming: ${list(upcoming)}`, `Past, checked in with no note: ${list(past)}`]
      : [list(upcoming.length ? upcoming : past)];
  lines.push(FILL_UNCHANGED_LINE);
  return { kind: "confirm", title, lines, text: [title, ...lines].join("\n") };
}

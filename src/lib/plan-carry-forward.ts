/**
 * "…for the rest of this plan?" — which already-OPEN future notes may have
 * their Plan section rebuilt from the updated treatment plan (pure,
 * unit-tested).
 *
 *   • Only notes dated AFTER the note being edited.
 *   • Never a closed (signed) note, never a Checked Out / Canceled / No Show
 *     visit.
 *   • Only a Plan that is UNTOUCHED — it still reads exactly what the
 *     treatment plan prefilled. Anything edited by hand (e.g. the adjustment
 *     unticked until the x-ray is reviewed) is skipped and named in the prompt.
 *   • An empty Plan is left alone: auto-fill on open fills it from the
 *     (updated) plan anyway.
 */

/** Plan text with the HTML, run ids and spacing stripped, for comparing. */
export function planTextFingerprint(html: string): string {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type OpenNoteUpdateDecision = "update" | "edited" | null;

export function decideOpenNoteUpdate(input: {
  /** ISO YYYY-MM-DD of the open note and of the note being edited. */
  dateIso: string;
  currentIso: string;
  signed: boolean;
  /** Status of the note's visit, if one is found. */
  appointmentStatus?: string | null;
  /** The note's Plan section as it is now. */
  planHtml: string;
  /** What the treatment plan (before this change) prefills for that date. */
  prefilledPlanHtml: string;
}): OpenNoteUpdateDecision {
  const { dateIso, currentIso, signed, appointmentStatus, planHtml, prefilledPlanHtml } = input;
  if (!dateIso || !currentIso || dateIso <= currentIso) return null;
  if (signed) return null;
  if (appointmentStatus === "Check Out" || appointmentStatus === "Canceled" || appointmentStatus === "No Show") {
    return null;
  }
  const now = planTextFingerprint(planHtml);
  if (!now) return null;
  const prefilled = planTextFingerprint(prefilledPlanHtml);
  return prefilled && now === prefilled ? "update" : "edited";
}

const shortUs = (d: string) => d.slice(0, 5);
const list = (dates: string[]) => dates.map(shortUs).join(", ");

/**
 * The lines folded into the "…for the rest of this plan?" prompt.
 * e.g. "Also updates 2 open notes (10/15, 10/22). 10/17 was edited by hand and won't change."
 */
export function carryForwardNoteText(updateDatesUs: string[], editedDatesUs: string[]): string {
  const parts: string[] = [];
  const n = updateDatesUs.length;
  const k = editedDatesUs.length;
  if (n) {
    parts.push(`Also updates ${n} open note${n === 1 ? "" : "s"} (${list(updateDatesUs)}).`);
  }
  if (k) {
    parts.push(`${list(editedDatesUs)} ${k === 1 ? "was" : "were"} edited by hand and won't change.`);
  }
  parts.push(
    n
      ? "Closed and checked-out notes are never changed."
      : "Notes already written (including closed and checked-out ones) are not changed.",
  );
  return `\n\nThis changes the treatment plan for visits that aren't charted yet. ${parts.join(" ")}`;
}

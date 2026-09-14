/**
 * Built-in review statuses for review follow-up.
 *
 * These used to be editable in Settings, which is how stored values drifted
 * ("REQUESTED", "RECEIVED", "Not Requested", "Incomplete" from the CaseMate
 * import). They are now fixed. Rename a label here and normalizeReviewStatus
 * keeps accepting the old spelling, so stored data never needs migrating.
 */

export const REVIEW_REQUEST = "Request";
export const REVIEW_REQUESTED = "Requested";
export const REVIEW_RECEIVED = "Received";
/** Don't ask this patient. Working name — may become "Ignore". */
export const REVIEW_REFRAIN = "Refrain";

export const REVIEW_STATUSES = [REVIEW_REQUEST, REVIEW_REQUESTED, REVIEW_RECEIVED, REVIEW_REFRAIN] as const;

/** Case statuses that are NOT ready to be asked for a review. */
const NOT_READY_CASE_STATUSES = new Set(["active", "dropped"]);

/**
 * Map any stored value onto a built-in status. Unrecognised legacy values
 * (e.g. "Incomplete") are returned trimmed and unchanged rather than guessed
 * at, so nothing is silently reclassified.
 */
export function normalizeReviewStatus(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  switch (value.toLowerCase()) {
    case "":
    case "request":
    case "not requested":
    case "not set":
      return REVIEW_REQUEST;
    case "requested":
      return REVIEW_REQUESTED;
    case "received":
      return REVIEW_RECEIVED;
    case "refrain":
    case "ignore":
    case "ignored":
      return REVIEW_REFRAIN;
    default:
      return value;
  }
}

/** Ready to be asked: still at Request, and the case isn't Active or Dropped. */
export function isReadyToRequestReview(caseStatus: string, review: string | null | undefined): boolean {
  return (
    normalizeReviewStatus(review) === REVIEW_REQUEST &&
    !NOT_READY_CASE_STATUSES.has(caseStatus.trim().toLowerCase())
  );
}

/** Pill colours for a review status. */
export function reviewStatusTone(review: string | null | undefined): string {
  switch (normalizeReviewStatus(review)) {
    case REVIEW_REQUESTED:
      return "border-amber-300 bg-amber-50 text-amber-800";
    case REVIEW_RECEIVED:
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case REVIEW_REFRAIN:
      return "border-slate-300 bg-slate-100 text-slate-500";
    default:
      return "border-[var(--line-soft)] bg-white text-[var(--text-muted)]";
  }
}

/** Options for a select: the built-ins, plus an unrecognised current value. */
export function reviewSelectOptionsFor(current: string | null | undefined): string[] {
  const value = normalizeReviewStatus(current);
  return (REVIEW_STATUSES as readonly string[]).includes(value)
    ? [...REVIEW_STATUSES]
    : [value, ...REVIEW_STATUSES];
}

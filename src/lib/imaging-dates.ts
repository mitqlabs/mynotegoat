import { toUsDateCanonical } from "@/lib/follow-up-queue";

/** Date fields on X-ray / MRI / specialist entries. */
export const REFERRAL_DATE_FIELDS = [
  "sentDate",
  "scheduledDate",
  "doneDate",
  "completedDate",
  "reportReceivedDate",
  "reportReviewedDate",
] as const;

/**
 * Show and save imaging dates as MM/DD/YYYY. ISO (YYYY-MM-DD) and short
 * US dates are converted; anything else (blank, free text) is kept as-is.
 */
export function normalizeReferralDates<T extends object>(entry: T): T {
  const rec = entry as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const f of REFERRAL_DATE_FIELDS) {
    const v = rec[f];
    if (typeof v !== "string" || !v.trim()) continue;
    const us = toUsDateCanonical(v);
    if (us && us !== v) {
      out ??= { ...rec };
      out[f] = us;
    }
  }
  return (out ?? entry) as T;
}

export function normalizeReferralList<T extends object>(list: T[]): T[] {
  return list.map(normalizeReferralDates);
}

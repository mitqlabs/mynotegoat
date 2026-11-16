/**
 * % Paid from completed cases only. Display math — nothing is written
 * back to a patient or a billing record.
 *
 * A case counts only when its status is Paid and a paid amount was entered
 * (greater than zero). Those paid dollars divided by those cases' billed
 * dollars is the percent. A Paid case with no paid amount is left out and
 * counted so the screen can say so. No Paid cases, or nothing to divide,
 * is N/A rather than 0%.
 */

export type PaidCaseMoney = {
  caseStatus: string;
  /** Dollars already resolved from the billing record or the saved field. */
  billed: number;
  paid: number;
};

export type PaidCasePercent = {
  /** Null means show N/A. */
  percent: number | null;
  /** Paid cases that had no paid amount, so they were left out of the percent. */
  missingAmount: number;
  paidCases: number;
};

export function paidCasePercent(cases: PaidCaseMoney[]): PaidCasePercent {
  let paidCases = 0;
  let missingAmount = 0;
  let paidSum = 0;
  let billedSum = 0;
  for (const row of cases) {
    if (row.caseStatus.trim() !== "Paid") continue;
    paidCases += 1;
    const paid = Number.isFinite(row.paid) && row.paid > 0 ? row.paid : 0;
    if (paid <= 0) {
      missingAmount += 1;
      continue;
    }
    paidSum += paid;
    const billed = Number.isFinite(row.billed) && row.billed > 0 ? row.billed : 0;
    billedSum += billed;
  }
  if (paidCases === 0 || billedSum <= 0) {
    return { percent: null, missingAmount, paidCases };
  }
  return { percent: (paidSum / billedSum) * 100, missingAmount, paidCases };
}

export function paidCaseMissingLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 paid case missing amount";
  return `${count} paid cases missing amount`;
}

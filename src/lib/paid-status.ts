/**
 * Additional Details "paid" state: both Paid Date and a positive $ Paid Amount
 * are filled. Drives the money-green header and summary panel.
 */
export function isPaidFilled(paidDate: string, paidAmount: string | number): boolean {
  const amount = typeof paidAmount === "number" ? paidAmount : Number.parseFloat(String(paidAmount).replace(/[^0-9.]/g, ""));
  return paidDate.trim().length > 0 && Number.isFinite(amount) && amount > 0;
}

/** Money green; white header text on it passes WCAG AA (≈5.4:1). */
export const PAID_GREEN = {
  header: "bg-[#1e7b4c]",
  panel: "border-[#9fd3b2] bg-[#e9f7ee]",
} as const;

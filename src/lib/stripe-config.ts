import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

// My Note Goat is a single all-access plan billed monthly or annually.
// The Stripe Price IDs are NOT hardcoded here — they live in environment
// variables so they can be rotated (archive + recreate in Stripe) without
// a code change. Set these in Vercel → Environment Variables:
//   STRIPE_PRICE_MONTHLY = price_...   ($199.99 / month)
//   STRIPE_PRICE_ANNUAL  = price_...   ($1999.99 / year)
export type BillingPeriod = "monthly" | "annual";

export function priceIdForPeriod(period: BillingPeriod): string | null {
  const monthly = process.env.STRIPE_PRICE_MONTHLY?.trim();
  const annual = process.env.STRIPE_PRICE_ANNUAL?.trim();
  const id = period === "annual" ? annual : monthly;
  return id && id.length > 0 ? id : null;
}

// One plan → every subscriber is on the full-access tier. (The plan_tier
// column is kept for historical/compat reasons but no longer gates
// features.)
export const SINGLE_PLAN_TIER = "complete";

export function tierFromPriceId(_priceId: string): string {
  return SINGLE_PLAN_TIER;
}

import { NextRequest, NextResponse } from "next/server";
import { getStripe, priceIdForPeriod, SINGLE_PLAN_TIER, type BillingPeriod } from "@/lib/stripe-config";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { period, userId, email } = body as {
      period?: string;
      userId?: string;
      email?: string;
    };

    if (!period || !userId || !email) {
      return NextResponse.json(
        { error: "Missing period, userId, or email" },
        { status: 400 },
      );
    }

    if (period !== "monthly" && period !== "annual") {
      return NextResponse.json({ error: "Invalid billing period" }, { status: 400 });
    }

    const priceId = priceIdForPeriod(period as BillingPeriod);
    if (!priceId) {
      return NextResponse.json(
        { error: "Pricing is not configured. Set STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL." },
        { status: 500 },
      );
    }

    // Find or create Stripe customer for this user
    const existing = await getStripe().customers.list({
      email,
      limit: 1,
    });

    let customerId: string;
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await getStripe().customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
    }

    // Store customer ID on the profile
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await supabase
        .from("account_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", userId);
    }

    const origin = request.headers.get("origin") || "http://localhost:3000";

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/auth/login?checkout=success`,
      cancel_url: `${origin}/auth/login?checkout=cancel`,
      metadata: { supabase_user_id: userId, plan_tier: SINGLE_PLAN_TIER, billing_period: period },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan_tier: SINGLE_PLAN_TIER, billing_period: period },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[Stripe Checkout]", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}

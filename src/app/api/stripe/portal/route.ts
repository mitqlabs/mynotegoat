import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-config";
import { DEMO_NOT_SENT, isDemoPrincipal } from "@/lib/demo-office";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId } = body as { customerId?: string };

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (token && url && anon) {
      const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await auth.auth.getUser(token);
      if (isDemoPrincipal(data.user)) {
        return NextResponse.json({ error: DEMO_NOT_SENT, message: DEMO_NOT_SENT, demo: true }, { status: 403 });
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "Missing customerId" },
        { status: 400 },
      );
    }

    const origin = request.headers.get("origin") || "http://localhost:3000";

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[Stripe Portal]", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isDemoPrincipal } from "@/lib/demo-office";

export const dynamic = "force-dynamic";

/**
 * One-click demo sign-in. The password stays in server environment variables.
 * The account must already be marked demo_office in app_metadata, so this
 * route cannot hand out a session for a real office.
 */
export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const email = process.env.DEMO_USER_EMAIL?.trim();
  const password = process.env.DEMO_USER_PASSWORD;
  if (!url || !anon || !email || !password) {
    return NextResponse.json({ error: "Demo login is not set up yet." }, { status: 503 });
  }
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return NextResponse.json({ error: "Demo login failed." }, { status: 401 });
  }
  if (!isDemoPrincipal(data.user)) {
    return NextResponse.json({ error: "That account is not the demo office." }, { status: 403 });
  }
  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}

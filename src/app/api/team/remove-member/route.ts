import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Owner removes a staff member: deletes the membership link (revoking
 * access to the owner's workspace) and the member's auth user + profile.
 * The owner is verified from their Bearer token, and we only allow
 * removing a member that actually belongs to THIS owner.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user: owner },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !owner) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { memberId?: string };
  const memberId = (body.memberId ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Confirm this member actually belongs to this owner before deleting.
  const { data: membership, error: findError } = await admin
    .from("workspace_members")
    .select("member_user_id")
    .eq("workspace_owner_id", owner.id)
    .eq("member_user_id", memberId)
    .maybeSingle();
  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "That member isn't on your team." }, { status: 404 });
  }

  await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_owner_id", owner.id)
    .eq("member_user_id", memberId);
  await admin.from("account_profiles").delete().eq("user_id", memberId);
  await admin.auth.admin
    .deleteUser(memberId)
    .catch((e) => console.error("[team] deleteUser failed:", e));

  return NextResponse.json({ ok: true });
}

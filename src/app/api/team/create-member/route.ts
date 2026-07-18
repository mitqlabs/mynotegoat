import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePermissions } from "@/lib/team-permissions";

/**
 * Owner creates a staff (team member) login.
 *
 * Auth: the OWNER's access token must be sent as a Bearer header. We
 * verify it to get the owner's uid — a caller can only add members to
 * their OWN workspace. Then, with the service-role key, we:
 *   1. create the member's auth user (email confirmed, owner-set password)
 *   2. mark their account_profiles approved (no separate billing / approval)
 *   3. link them to the owner in workspace_members with permissions
 *
 * Requires the team_members_and_audit.sql migration to have been run.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  // 1. Verify the caller (owner) from their Bearer token.
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

  // 2. Validate input.
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    label?: string;
    permissions?: unknown;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const label = (body.label ?? "Team Member").trim() || "Team Member";
  const permissions = normalizePermissions(body.permissions);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Create the member's auth user (email pre-confirmed).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { created_by_owner: owner.id, team_label: label },
  });
  if (createError || !created?.user) {
    const msg = createError?.message || "Could not create the user.";
    const status = /already registered|already exists/i.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
  const memberId = created.user.id;

  // 4. Approve their profile (so they aren't stuck at pending-approval)
  //    and 5. link them to this owner's workspace with permissions.
  const nowIso = new Date().toISOString();
  const { error: profileError } = await admin.from("account_profiles").upsert(
    {
      user_id: memberId,
      email,
      approval_status: "approved",
      plan_tier: "complete",
      approved_at: nowIso,
      approved_by: owner.id,
      is_admin: false,
    },
    { onConflict: "user_id" },
  );
  if (profileError) {
    // Roll back the auth user so a half-created member doesn't linger.
    await admin.auth.admin
      .deleteUser(memberId)
      .catch((e) => console.error("[team] rollback deleteUser failed:", e));
    return NextResponse.json({ error: `Profile setup failed: ${profileError.message}` }, { status: 500 });
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_owner_id: owner.id,
    member_user_id: memberId,
    email,
    label,
    permissions,
  });
  if (memberError) {
    await admin.auth.admin
      .deleteUser(memberId)
      .catch((e) => console.error("[team] rollback deleteUser failed:", e));
    return NextResponse.json(
      { error: `Membership link failed: ${memberError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, memberId, email, label });
}

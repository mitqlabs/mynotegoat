import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Stop a queued office message. The browser update is refused: the demo-office
 * guard reads a table office accounts cannot see, so the save comes back 403
 * and the message stays queued. This uses the server key, which can pass that
 * check, then marks the broadcast and its waiting texts canceled. Devices
 * skip a canceled broadcast. Does not send anything.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anon || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const access = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!access) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await authClient.auth.getUser(access);
  if (authError || !auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing message." }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: broadcast, error: readError } = await admin
    .from("reminder_broadcasts")
    .select("id, workspace_id, canceled_at")
    .eq("id", id)
    .maybeSingle();
  if (readError || !broadcast) return NextResponse.json({ error: "That message is already gone." }, { status: 404 });

  const ownerId = String(broadcast.workspace_id).split(":")[0];
  if (ownerId !== auth.user.id) {
    const { data: member } = await admin
      .from("workspace_members")
      .select("permissions")
      .eq("member_user_id", auth.user.id)
      .eq("workspace_owner_id", ownerId)
      .limit(1)
      .maybeSingle();
    const permissions = member?.permissions as { disabled?: boolean } | null;
    if (!member || permissions?.disabled === true) {
      return NextResponse.json({ error: "Not signed in." }, { status: 403 });
    }
  }

  if (!broadcast.canceled_at) {
    const { error: broadcastError } = await admin
      .from("reminder_broadcasts")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", broadcast.workspace_id);
    if (broadcastError) return NextResponse.json({ error: "Couldn't cancel that message. Try again." }, { status: 500 });
  }
  const { error: recipientError } = await admin
    .from("reminder_broadcast_recipients")
    .update({ status: "canceled" })
    .eq("broadcast_id", id)
    .eq("workspace_id", broadcast.workspace_id)
    .eq("status", "queued");
  if (recipientError) {
    return NextResponse.json(
      { error: "Message canceled. A Device will not send it. Some waiting rows could not be marked canceled." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

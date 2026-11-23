import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { shortcutWithToken } from "@/lib/shortcut-file";
import { buildNamedShortcut } from "@/lib/shortcut-plist";
import { openShortcutToken, saveShortcutToken } from "@/lib/reminder-server";
import { isDeviceToken, openDeviceToken, sealDeviceToken } from "@/lib/shortcut-ticket";
import { DEMO_NOT_SENT, isDemoWorkspaceId } from "@/lib/demo-office";

export const dynamic = "force-dynamic";

function serverKeys(): { url: string; anon: string; service: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return url && anon && service ? { url, anon, service } : null;
}

function shortcutName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[\r\n]/g, " ").trim().slice(0, 80) : "";
  return name.startsWith("NoteGoat") ? name : "NoteGoat";
}

function ruleIdOf(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : "";
}

async function canUseWorkspace(admin: SupabaseClient, userId: string, workspaceId: string): Promise<boolean> {
  const ownerId = workspaceId.split(":")[0];
  if (ownerId === userId) return true;
  const { data: member } = await admin
    .from("workspace_members")
    .select("workspace_owner_id")
    .eq("member_user_id", userId)
    .eq("workspace_owner_id", ownerId)
    .limit(1)
    .maybeSingle();
  return Boolean(member);
}

/** The signed-in office downloads a shortcut that already has its code. */
export async function POST(request: NextRequest) {
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const access = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!access) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const authClient = createClient(keys.url, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(access);
  if (error || !data.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; deviceId?: unknown; ruleId?: unknown; name?: unknown };
  const ruleId = ruleIdOf(body.ruleId);
  const name = shortcutName(body.name);
  let token = typeof body.token === "string" ? body.token.trim() : "";
  const admin = createClient(keys.url, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });

  if (ruleId) {
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!deviceId) return NextResponse.json({ error: "Missing Device." }, { status: 400 });
    const { data: device } = await admin
      .from("reminder_devices")
      .select("id, workspace_id, revoked_at")
      .eq("id", deviceId)
      .maybeSingle();
    if (!device || device.revoked_at) return NextResponse.json({ error: "That Device was removed." }, { status: 404 });
    if (!(await canUseWorkspace(admin, data.user.id, device.workspace_id))) {
      return NextResponse.json({ error: "Not signed in." }, { status: 403 });
    }
    if (isDemoWorkspaceId(device.workspace_id)) {
      return NextResponse.json({ error: DEMO_NOT_SENT, message: DEMO_NOT_SENT, demo: true }, { status: 403 });
    }
    const saved = await openShortcutToken(admin, device.workspace_id, device.id, keys.service);
    if (saved) token = saved;
    else if (!isDeviceToken(token)) return NextResponse.json({ needsToken: true }, { status: 409 });
    else await saveShortcutToken(admin, device.workspace_id, device.id, token, keys.service);
  } else if (!isDeviceToken(token)) {
    return NextResponse.json({ error: "Bad device code." }, { status: 400 });
  }

  const ticket = sealDeviceToken(token, keys.service);
  const fileUrl = ruleId
    ? `${request.nextUrl.origin}/api/reminders/shortcut?t=${encodeURIComponent(ticket)}&rule=${encodeURIComponent(ruleId)}&name=${encodeURIComponent(name)}`
    : `${request.nextUrl.origin}/api/reminders/shortcut?t=${encodeURIComponent(ticket)}`;
  const importUrl = `shortcuts://import-shortcut?url=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(ruleId ? name : "NoteGoat")}`;
  return NextResponse.json({ importUrl, fileUrl });
}

/** The Shortcuts app fetches this. The link lasts 24 hours. */
export async function GET(request: NextRequest) {
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const ticket = request.nextUrl.searchParams.get("t") ?? "";
  const token = openDeviceToken(ticket, keys.service);
  if (!token) return NextResponse.json({ error: "This link has expired. Use Add to this Device again." }, { status: 404 });
  const ruleId = ruleIdOf(request.nextUrl.searchParams.get("rule"));
  const name = shortcutName(request.nextUrl.searchParams.get("name"));
  try {
    if (ruleId) {
      const xml = buildNamedShortcut({ token, name, ruleId, origin: request.nextUrl.origin });
      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="${name.replace(/[^\w –-]+/g, "") || "NoteGoat"}.shortcut"`,
        },
      });
    }
    const file = shortcutWithToken(token);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline; filename=\"NoteGoat.shortcut\"",
      },
    });
  } catch {
    return NextResponse.json({ error: "Shortcut file is missing." }, { status: 500 });
  }
}

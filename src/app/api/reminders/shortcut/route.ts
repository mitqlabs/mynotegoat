import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { openShortcutToken, saveShortcutToken } from "@/lib/reminder-server";
import { isDeviceToken, sealDeviceToken } from "@/lib/shortcut-ticket";
import {
  buildShortcutLinks,
  genericShortcutLinks,
  icloudShortcutUrl,
  isSignedShortcut,
  shortcutFileHeaders,
  shortcutForTicket,
  UNSIGNED_SHORTCUT_ERROR,
} from "@/lib/shortcut-import";
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

  if (!ruleId) {
    const links = genericShortcutLinks(request.nextUrl.origin, process.env.NOTEGOAT_SHORTCUT_ICLOUD_URL);
    if (!links.importUrl) {
      return NextResponse.json({ error: links.error || UNSIGNED_SHORTCUT_ERROR, fileUrl: links.fileUrl }, { status: 422 });
    }
    return NextResponse.json({ importUrl: links.importUrl, fileUrl: links.fileUrl });
  }

  const ticket = sealDeviceToken(token, keys.service);
  const shown = ruleId ? name : "NoteGoat";
  const icloudUrl = process.env.NOTEGOAT_SHORTCUT_ICLOUD_URL;
  let signed = false;
  if (!icloudShortcutUrl(icloudUrl)) {
    const file = shortcutForTicket({
      ticket,
      secret: keys.service,
      ruleId,
      name: shown,
      origin: request.nextUrl.origin,
    });
    if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status });
    signed = isSignedShortcut(file.body);
  }
  const links = buildShortcutLinks({
    origin: request.nextUrl.origin,
    ticket,
    name: shown,
    signed,
    icloudUrl,
    ruleId,
  });
  if (!links.importUrl) {
    return NextResponse.json({ error: links.error || UNSIGNED_SHORTCUT_ERROR, fileUrl: links.fileUrl }, { status: 422 });
  }
  return NextResponse.json({ importUrl: links.importUrl, fileUrl: links.fileUrl });
}

/** The Shortcuts app fetches this. No login. The link lasts 24 hours. */
export async function GET(request: NextRequest) {
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const file = shortcutForTicket({
    ticket: request.nextUrl.searchParams.get("t") ?? "",
    secret: keys.service,
    ruleId: ruleIdOf(request.nextUrl.searchParams.get("rule")),
    name: shortcutName(request.nextUrl.searchParams.get("name")),
    origin: request.nextUrl.origin,
  });
  if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status });
  return new NextResponse(new Uint8Array(file.body), { headers: shortcutFileHeaders(file.filename) });
}

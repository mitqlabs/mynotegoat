import { NextRequest, NextResponse } from "next/server";
import { adminClient, NO_STORE, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { desktopOwns, desktopStatus, PHONE_SCAN_BUCKET, PHONE_SCAN_TABLE, phoneScanPath } from "@/lib/phone-scan";

export const runtime = "nodejs";

/**
 * The desktop Scan window, for a session it created:
 *   GET    ?workspaceId=…            → { status, pages, fileUrl? } (fileUrl = 2-min signed link once the phone sent it)
 *   POST   { workspaceId, action:"saved" } → filed in Patient Files; delete the temp copy
 *   DELETE ?workspaceId=…            → cancel; delete any temp copy
 */
type Ctx = { params: Promise<{ id: string }> };

async function load(request: NextRequest, ctx: Ctx, workspaceId: string) {
  const cfg = serverConfig();
  if (!cfg) return { error: NextResponse.json({ error: "Server not configured." }, { status: 500, headers: NO_STORE }) };
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE }) };
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE }) };
  const { data: row } = await admin
    .from(PHONE_SCAN_TABLE)
    .select("id, status, expires_at, uploaded_at, created_by, workspace_id, page_count")
    .eq("id", id)
    .maybeSingle();
  if (!row || !desktopOwns(row, caller.userId, workspaceId)) {
    return { error: NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE }) };
  }
  return { admin, row };
}

async function close(admin: ReturnType<typeof adminClient>, id: string, status: "saved" | "revoked") {
  await admin.storage.from(PHONE_SCAN_BUCKET).remove([phoneScanPath(id)]);
  const now = new Date().toISOString();
  await admin
    .from(PHONE_SCAN_TABLE)
    .update(status === "saved" ? { status, saved_at: now } : { status, revoked_at: now })
    .eq("id", id)
    .in("status", ["waiting", "uploaded"]);
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const l = await load(request, ctx, request.nextUrl.searchParams.get("workspaceId") ?? "");
  if (l.error) return l.error;
  const { admin, row } = l;
  const status = desktopStatus(row);
  if (status === "expired") {
    await close(admin, row.id, "revoked");
    return NextResponse.json({ status: "expired" }, { headers: NO_STORE });
  }
  if (status !== "uploaded") return NextResponse.json({ status }, { headers: NO_STORE });
  const { data: signed } = await admin.storage.from(PHONE_SCAN_BUCKET).createSignedUrl(phoneScanPath(row.id), 120);
  return NextResponse.json({ status, pages: row.page_count ?? 0, fileUrl: signed?.signedUrl ?? null }, { headers: NO_STORE });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const l = await load(request, ctx, typeof body.workspaceId === "string" ? body.workspaceId : "");
  if (l.error) return l.error;
  if (body.action !== "saved" || l.row.status !== "uploaded") return NextResponse.json({ error: "Nothing to save." }, { status: 409, headers: NO_STORE });
  await close(l.admin, l.row.id, "saved");
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const l = await load(request, ctx, request.nextUrl.searchParams.get("workspaceId") ?? "");
  if (l.error) return l.error;
  await close(l.admin, l.row.id, "revoked");
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

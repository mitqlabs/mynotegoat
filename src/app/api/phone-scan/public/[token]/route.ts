import { NextRequest, NextResponse } from "next/server";
import { adminClient, ipBucket, NO_STORE, rateOk, serverConfig } from "@/lib/patient-forms-server";
import { looksLikePdf, PHONE_SCAN_BUCKET, PHONE_SCAN_MAX_PAGES, PHONE_SCAN_TABLE, phoneCanUpload, phoneScanPath, phoneView } from "@/lib/phone-scan";
import { hashScanToken, isScanTokenShape } from "@/lib/phone-scan-server";

export const runtime = "nodejs";

/**
 * The phone page talks only to this route. No login: the unguessable token is
 * the key, it opens exactly one session, and it can only ADD one PDF to it.
 * Nothing about the patient is ever read back (just the case label).
 *   GET                      → { status: ready|sent|inactive, label, expiresAt }
 *   POST { step:"start" }    → one signed upload slot { path, uploadToken }
 *   POST { step:"done", pages } → checks the file, marks it sent (link is then used up)
 */
type Ctx = { params: Promise<{ token: string }> };
const INACTIVE = { status: "inactive" };

async function setup(request: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!isScanTokenShape(token)) return { error: NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE }) };
  const cfg = serverConfig();
  if (!cfg) return { error: NextResponse.json({ error: "Unavailable." }, { status: 503, headers: NO_STORE }) };
  const admin = adminClient(cfg);
  if (!(await rateOk(admin, `scanip:${ipBucket(request)}`, 200, 600))) {
    return { error: NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429, headers: NO_STORE }) };
  }
  const { data: row } = await admin
    .from(PHONE_SCAN_TABLE)
    .select("id, status, expires_at, uploaded_at, created_by, workspace_id, label")
    .eq("token_hash", hashScanToken(token))
    .maybeSingle();
  return { admin, row };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const s = await setup(request, ctx);
  if (s.error) return s.error;
  const view = phoneView(s.row);
  if (view === "inactive" || !s.row) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  return NextResponse.json({ status: view, label: s.row.label, expiresAt: s.row.expires_at }, { headers: NO_STORE });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const s = await setup(request, ctx);
  if (s.error) return s.error;
  const { admin, row } = s;
  if (!row || !phoneCanUpload(row)) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const path = phoneScanPath(row.id);

  if (body.step === "start") {
    // No upsert: once a PDF is there it can't be replaced.
    const { data, error } = await admin.storage.from(PHONE_SCAN_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: "Could not start the upload." }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ path: data.path, uploadToken: data.token }, { headers: NO_STORE });
  }

  if (body.step === "done") {
    const pagesRaw = Math.round(Number(body.pages));
    const pages = Number.isFinite(pagesRaw) ? Math.max(1, Math.min(PHONE_SCAN_MAX_PAGES, pagesRaw)) : 1;
    const { data: signed } = await admin.storage.from(PHONE_SCAN_BUCKET).createSignedUrl(path, 60);
    let ok = false;
    if (signed?.signedUrl) {
      const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-7" } }).catch(() => null);
      const size = Number(res?.headers.get("content-range")?.split("/")[1] ?? res?.headers.get("content-length") ?? 0);
      const head = res && res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
      ok = looksLikePdf(head, size);
    }
    if (!ok) {
      await admin.storage.from(PHONE_SCAN_BUCKET).remove([path]);
      return NextResponse.json({ error: "The scan didn't arrive. Please try Send again." }, { status: 400, headers: NO_STORE });
    }
    const now = new Date().toISOString();
    const { data } = await admin
      .from(PHONE_SCAN_TABLE)
      .update({ status: "uploaded", uploaded_at: now, page_count: pages })
      .eq("id", row.id)
      .eq("status", "waiting")
      .gt("expires_at", now)
      .select("id");
    if (!data?.length) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
}

import { NextRequest, NextResponse } from "next/server";
import { adminClient, NO_STORE, ownsWorkspace, publicOrigin, rateOk, serverConfig, verifyStaff } from "@/lib/patient-forms-server";
import { PHONE_SCAN_BUCKET, PHONE_SCAN_PICKUP_MS, PHONE_SCAN_TABLE, PHONE_SCAN_TTL_MS, phoneScanLabel, phoneScanPath } from "@/lib/phone-scan";
import { hashScanToken, newScanToken } from "@/lib/phone-scan-server";

export const runtime = "nodejs";

/**
 * Staff → make a one-time phone scan link for ONE patient's files.
 * Body: { workspaceId, patientId, folderId, label }
 * Returns { id, url, expiresAt }. The token is only in the URL; we store its hash.
 */
export async function POST(request: NextRequest) {
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500, headers: NO_STORE });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  if (!(await rateOk(admin, `scan:${caller.userId}`, 60, 3600))) {
    return NextResponse.json({ error: "Too many phone scans in the last hour. Try again later." }, { status: 429, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const workspaceId = str(body.workspaceId);
  const patientId = str(body.patientId);
  const folderId = str(body.folderId);
  if (!ownsWorkspace(caller, workspaceId)) return NextResponse.json({ error: "Not your office." }, { status: 403, headers: NO_STORE });
  if (!patientId || patientId.length > 200 || !folderId || folderId.length > 200) {
    return NextResponse.json({ error: "Open a patient first." }, { status: 400, headers: NO_STORE });
  }

  // Tidy up this person's old sessions: expire unused links, delete uncollected temp files.
  const now = Date.now();
  const { data: old } = await admin
    .from(PHONE_SCAN_TABLE)
    .select("id, status, expires_at, uploaded_at")
    .eq("created_by", caller.userId)
    .in("status", ["waiting", "uploaded"])
    .limit(50);
  const stale = (old ?? []).filter((r) =>
    r.status === "waiting" ? Date.parse(r.expires_at) <= now : now - Date.parse(r.uploaded_at ?? r.expires_at) > PHONE_SCAN_PICKUP_MS,
  );
  if (stale.length) {
    await admin.storage.from(PHONE_SCAN_BUCKET).remove(stale.map((r) => phoneScanPath(r.id)));
    await admin.from(PHONE_SCAN_TABLE).update({ status: "revoked", revoked_at: new Date().toISOString() }).in("id", stale.map((r) => r.id));
  }

  const token = newScanToken();
  const expiresAt = new Date(now + PHONE_SCAN_TTL_MS).toISOString();
  const { data, error } = await admin
    .from(PHONE_SCAN_TABLE)
    .insert({
      token_hash: hashScanToken(token),
      owner_id: caller.ownerId,
      workspace_id: workspaceId,
      patient_id: patientId,
      folder_id: folderId,
      label: phoneScanLabel(body.label),
      expires_at: expiresAt,
      created_by: caller.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    const missing = /phone_scan_sessions|does not exist|schema cache/i.test(error?.message ?? "");
    return NextResponse.json(
      { error: missing ? "Phone scanning isn't set up on the server yet (run the phone_scan_sessions migration)." : "Could not make the link." },
      { status: missing ? 503 : 500, headers: NO_STORE },
    );
  }
  return NextResponse.json({ id: data.id, url: `${publicOrigin(request)}/s/${token}`, expiresAt }, { headers: NO_STORE });
}

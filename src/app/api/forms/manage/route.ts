import { NextRequest, NextResponse } from "next/server";
import { adminClient, FORM_TABLE, NO_STORE, rateOk, serverConfig, verifyStaff } from "@/lib/patient-forms-server";

export const runtime = "nodejs";

/**
 * Staff actions on one questionnaire link, recorded with who and when:
 *   { id, action: "revoke" }                      – link stops working now
 *   { id, action: "inserted", encounterId }        – answers put into a note
 *   { id, action: "dismissed" }                    – reviewed, not inserted
 *   { id, action: "reopen" }                       – back to "new" for review
 * The raw submission is never changed.
 */
export async function POST(request: NextRequest) {
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500, headers: NO_STORE });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  if (!(await rateOk(admin, `manage:${caller.userId}`, 300, 3600))) {
    return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown form." }, { status: 400, headers: NO_STORE });

  const { data: row } = await admin.from(FORM_TABLE).select("id, owner_id, status").eq("id", id).maybeSingle();
  if (!row || String(row.owner_id) !== caller.ownerId) return NextResponse.json({ error: "Unknown form." }, { status: 404, headers: NO_STORE });

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (action === "revoke") {
    if (row.status === "submitted") return NextResponse.json({ error: "Already submitted." }, { status: 409, headers: NO_STORE });
    patch = { status: "revoked", revoked_at: now, revoked_by: caller.userId };
  } else if (action === "inserted" || action === "dismissed" || action === "reopen") {
    if (row.status !== "submitted") return NextResponse.json({ error: "Not submitted yet." }, { status: 409, headers: NO_STORE });
    const encounterId = typeof body.encounterId === "string" ? body.encounterId.trim().slice(0, 200) : "";
    if (action === "inserted" && !encounterId) return NextResponse.json({ error: "Which visit?" }, { status: 400, headers: NO_STORE });
    patch =
      action === "reopen"
        ? { review_status: "new", reviewed_by: null, reviewed_by_label: null, reviewed_at: null, inserted_encounter_id: null }
        : {
            review_status: action,
            reviewed_by: caller.userId,
            reviewed_by_label: caller.label,
            reviewed_at: now,
            inserted_encounter_id: action === "inserted" ? encounterId : null,
          };
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: NO_STORE });
  }
  const { error } = await admin.from(FORM_TABLE).update({ ...patch, updated_at: now }).eq("id", id).eq("owner_id", caller.ownerId);
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ ok: true, by: caller.label, at: now }, { headers: NO_STORE });
}

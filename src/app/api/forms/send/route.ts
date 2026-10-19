import { NextRequest, NextResponse } from "next/server";
import { validateSnapshot } from "@/lib/patient-forms";
import {
  adminClient,
  DEFAULT_EXPIRY_DAYS,
  FORM_TABLE,
  hashFormToken,
  MAX_EXPIRY_DAYS,
  newFormToken,
  NO_STORE,
  ownsWorkspace,
  publicOrigin,
  rateOk,
  serverConfig,
  tableMissing,
  verifyStaff,
} from "@/lib/patient-forms-server";

export const runtime = "nodejs";

/**
 * Staff → create a questionnaire link for ONE patient.
 * Body: { workspaceId, patientId, snapshot, officeName?, expiresDays? }
 * Returns the link once ({ id, url, expiresAt }); only its hash is stored.
 */
export async function POST(request: NextRequest) {
  const cfg = serverConfig();
  if (!cfg) return NextResponse.json({ error: "Server not configured." }, { status: 500, headers: NO_STORE });
  const admin = adminClient(cfg);
  const caller = await verifyStaff(request, cfg, admin);
  if (!caller) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: NO_STORE });
  if (!(await rateOk(admin, `send:${caller.userId}`, 60, 3600))) {
    return NextResponse.json({ error: "Too many forms sent in the last hour. Try again later." }, { status: 429, headers: NO_STORE });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  if (!ownsWorkspace(caller, workspaceId)) return NextResponse.json({ error: "Not your office." }, { status: 403, headers: NO_STORE });
  if (!patientId || patientId.length > 200) return NextResponse.json({ error: "Pick a patient." }, { status: 400, headers: NO_STORE });
  const snapshot = validateSnapshot(body.snapshot);
  if (!snapshot || !snapshot.sections.some((s) => s.questions.length)) {
    return NextResponse.json({ error: "That form has no questions to send." }, { status: 400, headers: NO_STORE });
  }
  const daysRaw = Number(body.expiresDays);
  const days = Number.isFinite(daysRaw) ? Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.round(daysRaw))) : DEFAULT_EXPIRY_DAYS;
  const officeName = typeof body.officeName === "string" ? body.officeName.trim().slice(0, 200) : "";

  const token = newFormToken();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const { data, error } = await admin
    .from(FORM_TABLE)
    .insert({
      token_hash: hashFormToken(token),
      owner_id: caller.ownerId,
      workspace_id: workspaceId,
      patient_id: patientId,
      form_id: snapshot.formId || "form",
      form_name: snapshot.formName,
      office_name: officeName,
      snapshot,
      expires_at: expiresAt,
      created_by: caller.userId,
      created_by_label: caller.label,
    })
    .select("id")
    .single();
  if (error || !data) {
    const missing = tableMissing(error?.message);
    return NextResponse.json(
      { error: missing ? "Forms aren't set up on the server yet (run supabase/patient_form_requests.sql)." : "Could not create the link." },
      { status: missing ? 503 : 500, headers: NO_STORE },
    );
  }
  return NextResponse.json({ id: data.id, url: `${publicOrigin(request)}/f/${token}`, expiresAt }, { headers: NO_STORE });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { phoneMatchKey, UNMATCHED_PREFIX } from "@/lib/reminder-automation";

export const dynamic = "force-dynamic";

/**
 * The office taps a name on an unmatched STOP. Marks that patient
 * "no reminder texts" and clears the notice. Does not send a text.
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

  const body = (await request.json().catch(() => ({}))) as { patientId?: unknown; noticeId?: unknown; dismiss?: unknown };
  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  const noticeId = typeof body.noticeId === "string" || typeof body.noticeId === "number" ? String(body.noticeId) : "";
  if (!noticeId) return NextResponse.json({ error: "Missing notice." }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: notice, error: noticeError } = await admin
    .from("reminder_opt_outs")
    .select("id, workspace_id, patient_id")
    .eq("id", noticeId)
    .maybeSingle();
  if (noticeError || !notice) return NextResponse.json({ error: "That notice is already gone." }, { status: 404 });
  if (!String(notice.patient_id).startsWith(UNMATCHED_PREFIX)) {
    return NextResponse.json({ error: "That notice is already handled." }, { status: 400 });
  }
  const ownerId = String(notice.workspace_id).split(":")[0];
  if (ownerId !== auth.user.id) {
    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_owner_id")
      .eq("member_user_id", auth.user.id)
      .eq("workspace_owner_id", ownerId)
      .limit(1)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  }

  if (body.dismiss === true) {
    await admin.from("reminder_opt_outs").delete().eq("id", noticeId).eq("workspace_id", notice.workspace_id);
    return NextResponse.json({ ok: true });
  }
  if (!patientId) return NextResponse.json({ error: "Pick a patient." }, { status: 400 });
  const { data: patient, error: patientError } = await admin
    .from("patients")
    .select("id, phone, workspace_id")
    .eq("id", patientId)
    .eq("workspace_id", notice.workspace_id)
    .maybeSingle();
  if (patientError || !patient) return NextResponse.json({ error: "That patient is not in this office." }, { status: 404 });
  const { error: updateError } = await admin
    .from("patients")
    .update({ text_reminders_off: true })
    .eq("id", patientId)
    .eq("workspace_id", notice.workspace_id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  const phone = phoneMatchKey(patient.phone);
  await admin.from("reminder_opt_outs").insert({
    workspace_id: notice.workspace_id,
    patient_id: patientId,
    action: "stop",
    phone_last4: phone.slice(-4),
    source: "staff",
  });
  await admin.from("reminder_opt_outs").delete().eq("id", noticeId).eq("workspace_id", notice.workspace_id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { adminClient, authenticateDevice } from "@/lib/reminder-server";

export const dynamic = "force-dynamic";

type AckResult = { id?: unknown; status?: unknown; error?: unknown };

/**
 * POST /api/reminders/ack — the device reports what it sent.
 * Body: { visitDate: "YYYY-MM-DD", results: [{ id, status: "sent"|"failed"|"dry-run", error? }] }
 * Only appointment ids that exist in this workspace on that date are logged.
 * A second "sent" for the same appointment + date is ignored (unique index).
 */
export async function POST(request: NextRequest) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const device = await authenticateDevice(admin, request.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Invalid or revoked device token." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    visitDate?: unknown;
    results?: unknown;
    id?: unknown;
    status?: unknown;
    error?: unknown;
  };
  const visitDate = typeof body.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.visitDate) ? body.visitDate : "";
  // Batch form { results: [...] } or the single-item form { id, status }
  // (easier to build in an iPhone Shortcut).
  const results = Array.isArray(body.results)
    ? (body.results as AckResult[]).slice(0, 500)
    : body.id !== undefined
      ? [{ id: body.id, status: body.status, error: body.error }]
      : [];
  if (!visitDate) return NextResponse.json({ error: "Missing visitDate." }, { status: 400 });

  const ids = Array.from(new Set(results.map((r) => (typeof r.id === "string" ? r.id : "")).filter(Boolean)));
  const { data: appts } = ids.length
    ? await admin
        .from("schedule_appointments")
        .select("id, patient_id")
        .eq("workspace_id", device.workspace_id)
        .eq("date", visitDate)
        .in("id", ids)
    : { data: [] as { id: string; patient_id: string }[] };
  const patientByAppt = new Map((appts ?? []).map((a) => [a.id as string, a.patient_id as string]));
  const patientIds = Array.from(new Set(patientByAppt.values()));
  const { data: pts } = patientIds.length
    ? await admin.from("patients").select("id, phone").eq("workspace_id", device.workspace_id).in("id", patientIds)
    : { data: [] as { id: string; phone: string }[] };
  const last4 = new Map((pts ?? []).map((p) => [p.id as string, String(p.phone ?? "").replace(/\D/g, "").slice(-4)]));

  let logged = 0;
  let duplicates = 0;
  let ignored = 0;
  const counts: Record<string, number> = { sent: 0, failed: 0, "dry-run": 0 };
  for (const result of results) {
    const id = typeof result.id === "string" ? result.id : "";
    const status = result.status === "sent" || result.status === "failed" || result.status === "dry-run" ? result.status : "";
    if (!id || !status || !patientByAppt.has(id)) {
      ignored += 1;
      continue;
    }
    const { error } = await admin.from("reminder_log").insert({
      workspace_id: device.workspace_id,
      device_id: device.id,
      appointment_id: id,
      visit_date: visitDate,
      phone_last4: last4.get(patientByAppt.get(id) ?? "") ?? "",
      status,
      error: typeof result.error === "string" ? result.error.slice(0, 300) : null,
    });
    if (error) {
      if (error.code === "23505") duplicates += 1;
      else ignored += 1;
      continue;
    }
    logged += 1;
    counts[status] += 1;
  }
  const summary = `${visitDate}: ${counts.sent} sent, ${counts.failed} failed, ${counts["dry-run"]} dry-run`;
  await admin
    .from("reminder_devices")
    .update({ last_run_at: new Date().toISOString(), last_run_summary: summary, run_requested_until: null })
    .eq("id", device.id);
  return NextResponse.json({ logged, duplicates, ignored, summary });
}

import { NextRequest, NextResponse } from "next/server";
import { decodeQueueItemId } from "@/lib/reminder-automation";
import { ackBroadcast, adminClient, authenticateDevice } from "@/lib/reminder-server";

export const dynamic = "force-dynamic";

type AckResult = { id?: unknown; status?: unknown; error?: unknown };

/**
 * POST /api/reminders/ack — the device reports what it sent.
 * Body: { visitDate: "YYYY-MM-DD", results: [{ id, status: "sent"|"failed"|"dry-run", error? }] }
 * Ids: plain = appointment on visitDate; "r:<date>:<id>" = reminder for that
 * date; "b:<id>" = a Message-patients text. Only ids in this workspace count.
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
  const refs = results.map((r) => decodeQueueItemId(typeof r.id === "string" ? r.id : "", visitDate));
  const hasPlain = results.some((r) => typeof r.id === "string" && !/^(b|r):/.test(r.id));
  if (!visitDate && (hasPlain || !results.length)) return NextResponse.json({ error: "Missing visitDate." }, { status: 400 });

  const apptIds = Array.from(
    new Set(refs.flatMap((ref) => (ref?.kind === "reminder" ? [ref.appointmentId] : []))),
  );
  const { data: appts } = apptIds.length
    ? await admin
        .from("schedule_appointments")
        .select("id, patient_id, date")
        .eq("workspace_id", device.workspace_id)
        .in("id", apptIds)
    : { data: [] as { id: string; patient_id: string; date: string }[] };
  const apptById = new Map((appts ?? []).map((a) => [a.id as string, { patientId: a.patient_id as string, date: a.date as string }]));
  const patientIds = Array.from(new Set(Array.from(apptById.values()).map((a) => a.patientId)));
  const { data: pts } = patientIds.length
    ? await admin.from("patients").select("id, phone").eq("workspace_id", device.workspace_id).in("id", patientIds)
    : { data: [] as { id: string; phone: string }[] };
  const last4 = new Map((pts ?? []).map((p) => [p.id as string, String(p.phone ?? "").replace(/\D/g, "").slice(-4)]));

  let logged = 0;
  let duplicates = 0;
  let ignored = 0;
  let reminderResults = 0;
  const counts: Record<string, number> = { sent: 0, failed: 0, "dry-run": 0 };
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const ref = refs[i];
    const status = result.status === "sent" || result.status === "failed" || result.status === "dry-run" ? result.status : "";
    const errorText = typeof result.error === "string" ? result.error.slice(0, 300) : null;
    if (!ref || !status) {
      ignored += 1;
      continue;
    }
    if (ref.kind === "broadcast") {
      if (await ackBroadcast(admin, device, ref.recipientId, status, errorText)) {
        logged += 1;
        counts[status] += 1;
      } else duplicates += 1;
      continue;
    }
    const appt = apptById.get(ref.appointmentId);
    if (!appt || appt.date !== ref.visitDate) {
      ignored += 1;
      continue;
    }
    reminderResults += 1;
    const { error } = await admin.from("reminder_log").insert({
      workspace_id: device.workspace_id,
      device_id: device.id,
      appointment_id: ref.appointmentId,
      visit_date: ref.visitDate,
      phone_last4: last4.get(appt.patientId) ?? "",
      status,
      error: errorText,
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
  // Broadcast-only acks don't count as the day's reminder run.
  if (reminderResults > 0) await admin
    .from("reminder_devices")
    .update({ last_run_at: new Date().toISOString(), last_run_summary: summary, run_requested_until: null })
    .eq("id", device.id);
  return NextResponse.json({ logged, duplicates, ignored, summary });
}

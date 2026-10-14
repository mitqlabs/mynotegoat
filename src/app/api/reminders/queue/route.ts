import { NextRequest, NextResponse } from "next/server";
import {
  backupWaitReason,
  buildDeviceQueue,
  CLAIM_MINUTES,
  planReminderRun,
} from "@/lib/reminder-automation";
import {
  adminClient,
  alreadySentIds,
  authenticateDevice,
  claimReminders,
  otherPrimaryExists,
  loadVisitDay,
  loadWorkspaceConfig,
} from "@/lib/reminder-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders/queue — called by the office's sending device (Mac
 * script or iPhone Shortcut).
 * Auth: `Authorization: Bearer <device token>` (Settings → Text Reminders).
 *
 *   ?preview=1   list even on a non-run day (device must not send)
 *   ?force=1     "Send Now" from the device itself (skips run-day,
 *                send-hour and once-a-day checks; duplicates still blocked)
 *   ?format=shortcut  iPhone-friendly reply: `items` is non-empty ONLY when
 *                the phone should send right now; dry runs are logged here.
 *
 * Settings → "Send Now" sets run_requested_until (2 h) on the devices,
 * which counts as force=1 until a run completes.
 */
export async function GET(request: NextRequest) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const device = await authenticateDevice(admin, request.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Invalid or revoked device token." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const preview = params.get("preview") === "1";
  const shortcut = params.get("format") === "shortcut";
  const now = new Date();
  const requested = Boolean(device.run_requested_until && new Date(device.run_requested_until) > now);
  const selfForced = params.get("force") === "1";
  const force = selfForced || requested;

  const config = await loadWorkspaceConfig(admin, device.workspace_id);
  const plan = planReminderRun({
    now,
    settings: config.settings,
    officeHours: config.officeHours,
    closedIsoDates: config.closedIsoDates,
    force,
    // Once-a-day only matters for dry runs (real sends are deduped and
    // claimed), so a backup can still pick up what the primary missed.
    lastRunAt: device.last_run_at && config.settings.dryRun ? new Date(device.last_run_at) : null,
  });

  await admin.from("reminder_devices").update({ last_seen_at: now.toISOString() }).eq("id", device.id);

  const reply = (body: Record<string, unknown>) =>
    NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

  let items: ReturnType<typeof buildDeviceQueue> = [];
  let reason = plan.run ? "" : plan.reason;
  if ((plan.run || preview) && !config.templateBody.trim()) {
    reason = "No reminder template.";
  } else if (plan.run || preview) {
    const day = await loadVisitDay(admin, device.workspace_id, plan.visitDate);
    items = buildDeviceQueue({
      ...day,
      settings: config.settings,
      visitDate: plan.visitDate,
      templateBody: config.templateBody,
      office: config.office,
      alreadySentIds: await alreadySentIds(admin, device.workspace_id, plan.visitDate),
    });
  }
  const run = plan.run && !reason;
  const send = run && !config.settings.dryRun;

  // Two senders (e.g. iPhone primary, Mac backup): the backup waits for
  // the primary, and each device only gets reminders it has claimed.
  let held = false;
  if (send && !preview && items.length) {
    if (await otherPrimaryExists(admin, device)) {
      const wait = backupWaitReason({
        now,
        settings: config.settings,
        requestedAt: requested && device.run_requested_until
          ? new Date(new Date(device.run_requested_until).getTime() - 2 * 60 * 60 * 1000)
          : null,
        selfForced,
      });
      if (wait) {
        items = [];
        reason = wait;
        held = true;
      }
    }
    if (items.length) {
      const claimed = await claimReminders(admin, device, plan.visitDate, items.map((i) => i.id), CLAIM_MINUTES);
      items = items.filter((item) => claimed.has(item.id));
      if (!items.length) {
        reason = "Another device is sending these right now.";
        held = true;
      }
    }
  }

  // A run that has nothing left to do (or is a dry run for the phone) is
  // finished here, so the device doesn't repeat it on its next check.
  const finishRun = async (summary: string) => {
    await admin
      .from("reminder_devices")
      .update({ last_run_at: now.toISOString(), last_run_summary: summary, run_requested_until: null })
      .eq("id", device.id);
  };
  if (run && !preview && items.length === 0 && !held) {
    await finishRun(`${plan.visitDate}: nothing to send`);
  }

  if (shortcut) {
    let message = reason || (send ? `Sending ${items.length} reminder(s) for ${plan.visitDate}.` : "");
    let sendItems = send && !preview ? items : [];
    if (run && !send && !preview && items.length) {
      // Dry run on the phone: log what would go out; the phone sends nothing.
      await admin.from("reminder_log").insert(
        items.map((item) => ({
          workspace_id: device.workspace_id,
          device_id: device.id,
          appointment_id: item.id,
          visit_date: plan.visitDate,
          phone_last4: item.phone.slice(-4),
          status: "dry-run",
        })),
      );
      await finishRun(`${plan.visitDate}: ${items.length} dry-run`);
      message = `Dry run: ${items.length} reminder(s) logged, nothing sent.`;
      sendItems = [];
    }
    return reply({
      visitDate: plan.visitDate,
      send: sendItems.length > 0 ? "yes" : "no",
      message: message || "Nothing to send.",
      count: sendItems.length,
      items: sendItems,
    });
  }

  return reply({
    send: send && !held,
    run: run && !held,
    dryRun: config.settings.dryRun,
    forced: force,
    reason,
    visitDate: plan.visitDate,
    items,
  });
}

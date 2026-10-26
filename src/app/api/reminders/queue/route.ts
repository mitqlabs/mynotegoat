import { NextRequest, NextResponse } from "next/server";
import {
  backupWaitReason,
  broadcastBackupHold,
  buildDeviceQueue,
  CLAIM_MINUTES,
  encodeReminderItemId,
  isQuietNow,
  localHHMM,
  localNow,
  planCatchUp,
  planReminderRun,
  planScheduledRun,
  type DeviceQueueItem,
} from "@/lib/reminder-automation";
import {
  adminClient,
  alreadySentIds,
  authenticateDevice,
  claimBroadcasts,
  claimReminders,
  loadBroadcastQueue,
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
 *   (no flags)   the automatic run (from the send hour): today's unsent
 *                reminders for visits still ahead ("today" wording) plus
 *                tomorrow's on run days. Deduped like the catch-up.
 *   ?force=1     "Send Reminders Now" = catch-up backup: TODAY's reminders
 *                that never went out (visits still ahead, "today" wording)
 *                plus TOMORROW's if due. Quiet hours, closures, the sent
 *                log and claims still apply — nobody is texted twice.
 *   ?preview=1   list even on a non-run day (device must not send)
 *   ?format=shortcut  iPhone-friendly reply: `items` is non-empty ONLY when
 *                the phone should send right now; dry runs are logged here.
 *
 * Every call (outside quiet hours) also hands out queued "Message patients"
 * texts. Item ids: plain = appointment on `visitDate`; "r:<date>:<id>" =
 * reminder for another date; "b:<id>" = broadcast. /ack understands all.
 *
 * Legacy: run_requested_until (old Settings "Send now") still counts as
 * force=1 until a run completes.
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
  const { settings } = config;
  const todayIso = localNow(now, settings.timeZone).iso;

  // Which visit dates to work on, and how.
  type Group = { visitDate: string; sameDay: boolean; onlyAfter?: string; hours?: { start: string; end: string } };
  let groups: Group[] = [];
  let visitDate: string;
  let reason = "";
  let reminderRun = false;
  if (!preview) {
    // Both the automatic run and "Send Reminders Now" catch up: today's
    // unsent visits still ahead + tomorrow's when due. Forced skips only
    // the send-hour / once-a-day checks.
    const common = {
      now,
      settings,
      officeHours: config.officeHours,
      closedIsoDates: config.closedIsoDates,
      hoursByDate: config.hoursByDate,
    };
    const plan = force
      ? planCatchUp(common)
      : planScheduledRun({
          ...common,
          // Once-a-day only matters for dry runs (real sends are deduped and
          // claimed), so a backup can still pick up what the primary missed.
          lastRunAt: device.last_run_at && settings.dryRun ? new Date(device.last_run_at) : null,
        });
    visitDate = plan.visitDate;
    groups = plan.dates.map((d) => ({ visitDate: d.visitDate, sameDay: d.mode === "today", onlyAfter: d.onlyAfter, hours: d.hours }));
    reminderRun = groups.length > 0;
    reason = plan.reason;
  } else {
    const plan = planReminderRun({
      now,
      settings,
      officeHours: config.officeHours,
      closedIsoDates: config.closedIsoDates,
      force,
      // Once-a-day only matters for dry runs (real sends are deduped and
      // claimed), so a backup can still pick up what the primary missed.
      lastRunAt: device.last_run_at && settings.dryRun ? new Date(device.last_run_at) : null,
    });
    visitDate = plan.visitDate;
    reminderRun = plan.run;
    reason = plan.run ? "" : plan.reason;
    groups = [{ visitDate, sameDay: false, hours: config.hoursByDate.get(visitDate) }];
  }

  await admin.from("reminder_devices").update({ last_seen_at: now.toISOString() }).eq("id", device.id);

  const reply = (body: Record<string, unknown>) =>
    NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

  // Reminder items, per date (raw appointment ids for claiming).
  const byDate = new Map<string, DeviceQueueItem[]>();
  if (groups.length && !config.templateBody.trim()) {
    reason = "No reminder template.";
    reminderRun = false;
  } else {
    for (const g of groups) {
      const day = await loadVisitDay(admin, device.workspace_id, g.visitDate);
      byDate.set(
        g.visitDate,
        buildDeviceQueue({
          ...day,
          settings,
          visitDate: g.visitDate,
          templateBody: config.templateBody,
          office: config.office,
          alreadySentIds: await alreadySentIds(admin, device.workspace_id, g.visitDate),
          onlyAfter: g.onlyAfter,
          sameDay: g.sameDay,
          hours: g.hours,
        }),
      );
    }
  }

  // "Message patients" texts — any call outside quiet hours.
  const quiet = isQuietNow(now, settings);
  let broadcasts = quiet ? [] : await loadBroadcastQueue(admin, device, todayIso, now, localHHMM(now, settings.timeZone), settings);

  const dryRun = settings.dryRun;
  const willSend = !dryRun && !preview;
  let held = false;
  const isBackup = willSend ? await otherPrimaryExists(admin, device) : false;

  // Backup device: give the primary its chance first.
  if (willSend && reminderRun && isBackup) {
    const wait = backupWaitReason({
      now,
      settings,
      requestedAt: requested && device.run_requested_until
        ? new Date(new Date(device.run_requested_until).getTime() - 2 * 60 * 60 * 1000)
        : null,
      selfForced,
    });
    if (wait && Array.from(byDate.values()).some((v) => v.length)) {
      byDate.clear();
      reason = wait;
      held = true;
    }
  }
  if (willSend && isBackup && broadcasts.length) {
    const before = broadcasts.length;
    broadcasts = broadcasts.filter((b) => !broadcastBackupHold(b.createdAt, now, selfForced));
    if (broadcasts.length < before) held = true;
  }

  // Claims: each device only gets what it leased.
  if (willSend) {
    for (const [date, items] of byDate) {
      if (!items.length) continue;
      const claimed = await claimReminders(admin, device, date, items.map((i) => i.id), CLAIM_MINUTES);
      const kept = items.filter((i) => claimed.has(i.id));
      if (kept.length < items.length) held = true;
      byDate.set(date, kept);
    }
    if (broadcasts.length) {
      const claimed = await claimBroadcasts(admin, device, broadcasts.map((b) => b.recipientId), CLAIM_MINUTES, now);
      if (claimed.size < broadcasts.length) held = true;
      broadcasts = broadcasts.filter((b) => claimed.has(b.recipientId));
    }
  }

  const reminderItems: DeviceQueueItem[] = [];
  for (const [date, items] of byDate) {
    for (const item of items) reminderItems.push({ ...item, id: encodeReminderItemId(date, item.id, visitDate) });
  }
  const broadcastItems: DeviceQueueItem[] = broadcasts.map((b) => ({ id: `b:${b.recipientId}`, phone: b.phone, text: b.text }));
  const items = [...reminderItems, ...broadcastItems];
  if (held && !items.length && !reason) reason = "Another device is sending these right now.";

  const run = reminderRun || broadcastItems.length > 0;
  const send = run && !dryRun;

  // A reminder run with nothing left to do is finished here, so the
  // device doesn't repeat it on its next check.
  const finishRun = async (summary: string) => {
    await admin
      .from("reminder_devices")
      .update({ last_run_at: now.toISOString(), last_run_summary: summary, run_requested_until: null })
      .eq("id", device.id);
  };
  if (reminderRun && !preview && reminderItems.length === 0 && !held) {
    await finishRun(`${visitDate}: nothing to send`);
  }

  const describe = () => {
    const parts: string[] = [];
    const todayCount = byDate.get(todayIso)?.length ?? 0;
    const tomorrowCount = (byDate.get(visitDate)?.length ?? 0);
    if (todayCount) parts.push(`${todayCount} for today`);
    if (tomorrowCount) parts.push(`${tomorrowCount} for tomorrow`);
    if (broadcastItems.length) parts.push(`${broadcastItems.length} office message(s)`);
    return parts.join(", ");
  };

  if (shortcut) {
    let message = items.length ? `Sending ${describe()}.` : reason;
    let sendItems = send && !preview ? items : [];
    if (run && !send && !preview && items.length) {
      // Dry run on the phone: log what would go out; the phone sends nothing.
      const logRows: Record<string, unknown>[] = [];
      for (const [date, list] of byDate) {
        for (const item of list) {
          logRows.push({
            workspace_id: device.workspace_id,
            device_id: device.id,
            appointment_id: item.id,
            visit_date: date,
            phone_last4: item.phone.slice(-4),
            status: "dry-run",
          });
        }
      }
      if (logRows.length) await admin.from("reminder_log").insert(logRows);
      if (broadcasts.length) {
        await admin
          .from("reminder_broadcast_recipients")
          .update({ status: "dry-run", sent_at: now.toISOString(), device_id: device.id })
          .eq("workspace_id", device.workspace_id)
          .eq("status", "queued")
          .in("id", broadcasts.map((b) => b.recipientId));
      }
      if (reminderItems.length) await finishRun(`${visitDate}: ${reminderItems.length} dry-run`);
      message = `Dry run: ${describe()} logged, nothing sent.`;
      sendItems = [];
    }
    return reply({
      visitDate,
      send: sendItems.length > 0 ? "yes" : "no",
      message: message || "Nothing to send.",
      count: sendItems.length,
      items: sendItems,
    });
  }

  return reply({
    send: send && items.length > 0,
    run: run && (items.length > 0 || !held),
    dryRun,
    forced: force,
    reason,
    visitDate,
    items,
  });
}

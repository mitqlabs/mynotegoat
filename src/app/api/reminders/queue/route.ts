import { NextRequest, NextResponse } from "next/server";
import {
  backupWaitReason,
  broadcastBackupHold,
  buildDeviceQueue,
  CLAIM_MINUTES,
  encodeBirthdayItemId,
  encodeReminderItemId,
  isQuietNow,
  localHHMM,
  localNow,
  planCatchUp,
  planReminderRun,
  planScheduledRun,
  shortcutBatchSize,
  shortcutFetchDecision,
  withoutClosedDates,
  type DeviceQueueItem,
} from "@/lib/reminder-automation";
import { summaryAfterEmptyRun } from "@/lib/reminder-format";
import { dueScope } from "@/lib/text-rules";
import {
  adminClient,
  alreadySentIds,
  authenticateDevice,
  claimBirthdays,
  claimBroadcasts,
  claimReminders,
  loadBirthdayQueue,
  loadBroadcastQueue,
  otherPrimaryExists,
  loadVisitDay,
  loadWorkspaceConfig,
  ackBirthday,
  type BirthdayQueueRow,
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
 *   ?batch=5     with format=shortcut, hand out at most this many texts and
 *                claim only those. The shortcut asks again until send=no.
 *                Omitted = no limit (shortcuts installed before batching).
 *
 * Every call (outside quiet hours) also hands out queued "Message patients"
 * texts, including ones whose send day already passed. A closed day skips
 * appointment texts. It does not remove a broadcast, and the shortcut
 * message is the closed-day note only when this batch is empty. Item ids:
 * plain = appointment on `visitDate`; "r:<date>:<id>" =
 * reminder for another date; "b:<id>" = broadcast; "bd:<year>:<patient id>" =
 * birthday text. /ack understands all.
 *
 * Birthday texts go out at their own hour (older settings: the send hour),
 * outside quiet hours. Every patient whose birthday is today who is not
 * opted out gets one text, at most once per patient per year. Not tied to
 * office open days or Key Date closures: it is not about a visit.
 * Saved texts can also limit visits to open office days or the next 24 hours.
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
  type Group = { visitDate: string; sameDay: boolean; onlyAfter?: string; notAfter?: string; hours?: { start: string; end: string } };
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

  // Never text for a full-day Closed key date, whichever path planned it.
  const openGroups = withoutClosedDates(groups, config.closedIsoDates);
  if (openGroups.length < groups.length && !reason) reason = "The office is closed that day (Key Dates).";
  groups = openGroups;
  reminderRun = reminderRun && groups.length > 0;

  // Saved texts pick their own hour. Until the office saves that list, the
  // old send-hour path above is unchanged. A 9 AM birthday does not ride
  // the 8 AM run. Open days follow office hours and Key Dates.
  const scope = settings.rules
    ? dueScope({
        rules: settings.rules,
        now,
        timeZone: settings.timeZone,
        officeHours: config.officeHours,
        closedIsoDates: config.closedIsoDates,
      })
    : null;
  if (scope) {
    const hhmm = localHHMM(now, settings.timeZone);
    groups = groups
      .filter((g) => (g.sameDay ? scope.today : scope.tomorrow))
      .map((g) => (!g.sameDay && scope.limitTomorrowToNow ? { ...g, notAfter: hhmm } : g));
    reminderRun = groups.length > 0;
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
          notAfter: g.notAfter,
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

  // Birthday texts wait until their own hour. Older settings use the send hour.
  const localToday = localNow(now, settings.timeZone);
  const birthdayDue = scope ? scope.birthday : localToday.hour >= (settings.birthdayHour || settings.sendHour);
  let birthdays: BirthdayQueueRow[] =
    !quiet && birthdayDue
      ? await loadBirthdayQueue(admin, device, todayIso, settings, {
          retryDryRun: willSend || preview,
          reofferClaims: willSend,
          now,
          body: config.birthdayBody,
          office: config.office,
        })
      : [];
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
  if (willSend && isBackup && birthdays.length) {
    // The backup waits for the main sender, like reminders.
    const wait = backupWaitReason({ now, settings, requestedAt: null, selfForced });
    if (wait) {
      birthdays = [];
      held = true;
      if (!reason) reason = wait;
    }
  }
  if (willSend && isBackup && broadcasts.length) {
    const before = broadcasts.length;
    broadcasts = broadcasts.filter((b) => !broadcastBackupHold(b.createdAt, now, selfForced));
    if (broadcasts.length < before) held = true;
  }

  // A shortcut that passes batch= only leases what this call returns. The
  // rest stay unclaimed, so a run that dies after the GET does not stick
  // the whole morning. The next call (the shortcut's loop, or a later
  // automation) picks them up. Claims still expire, so a batch that was
  // leased and never acked comes back too.
  let truncated = false;
  const batchLimit = willSend && shortcut ? shortcutBatchSize(params.get("batch")) : 0;
  if (batchLimit > 0) {
    type Piece =
      | { kind: "bday"; row: BirthdayQueueRow }
      | { kind: "rem"; date: string; item: DeviceQueueItem }
      | { kind: "cast"; row: (typeof broadcasts)[number] };
    const pieces: Piece[] = [];
    for (const row of birthdays) pieces.push({ kind: "bday", row });
    for (const [date, list] of byDate) for (const item of list) pieces.push({ kind: "rem", date, item });
    for (const row of broadcasts) pieces.push({ kind: "cast", row });
    truncated = pieces.length > batchLimit;
    const kept = pieces.slice(0, batchLimit);
    birthdays = kept.flatMap((p) => (p.kind === "bday" ? [p.row] : []));
    const nextDates = new Map<string, DeviceQueueItem[]>();
    for (const p of kept) {
      if (p.kind !== "rem") continue;
      const list = nextDates.get(p.date) ?? [];
      list.push(p.item);
      nextDates.set(p.date, list);
    }
    byDate.clear();
    for (const [date, list] of nextDates) byDate.set(date, list);
    broadcasts = kept.flatMap((p) => (p.kind === "cast" ? [p.row] : []));
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
    if (birthdays.length) {
      const claimed = await claimBirthdays(admin, device, birthdays, now);
      if (claimed.size < birthdays.length) held = true;
      birthdays = birthdays.filter((b) => claimed.has(b.patientId));
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
  const birthdayItems: DeviceQueueItem[] = birthdays.map((b) => ({ id: encodeBirthdayItemId(b.year, b.patientId), phone: b.phone, text: b.text }));
  // Birthdays first: they are few, and a device that stops at its cap must not strand them.
  const items = [...birthdayItems, ...reminderItems, ...broadcastItems];
  if (held && !items.length && !reason) reason = "Another device is sending these right now.";

  const run = reminderRun || broadcastItems.length > 0 || birthdayItems.length > 0;
  const send = run && !dryRun;

  // A reminder run with nothing left to do is finished here, so the
  // device doesn't repeat it on its next check.
  const finishRun = async (summary: string) => {
    await admin
      .from("reminder_devices")
      .update({ last_run_at: now.toISOString(), last_run_summary: summary, run_requested_until: null })
      .eq("id", device.id);
  };
  if (reminderRun && !preview && reminderItems.length === 0 && !held && !truncated) {
    // Keep the day's real totals ("10/29/26: 14 sent") instead of overwriting them.
    await finishRun(summaryAfterEmptyRun(device.last_run_summary, visitDate));
  }

  const describe = () => {
    const parts: string[] = [];
    const todayCount = byDate.get(todayIso)?.length ?? 0;
    const tomorrowCount = (byDate.get(visitDate)?.length ?? 0);
    if (todayCount) parts.push(`${todayCount} for today`);
    if (tomorrowCount) parts.push(`${tomorrowCount} for tomorrow`);
    if (birthdayItems.length) parts.push(`${birthdayItems.length} birthday text(s)`);
    if (broadcastItems.length) parts.push(`${broadcastItems.length} office message(s)`);
    return parts.join(", ");
  };

  if (shortcut) {
    const summary = describe();
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
      for (const b of birthdays) await ackBirthday(admin, device, b.year, b.patientId, "dry-run", null, now);
      if (broadcasts.length) {
        await admin
          .from("reminder_broadcast_recipients")
          .update({ status: "dry-run", sent_at: now.toISOString(), device_id: device.id })
          .eq("workspace_id", device.workspace_id)
          .eq("status", "queued")
          .in("id", broadcasts.map((b) => b.recipientId));
      }
      if (reminderItems.length) await finishRun(`${visitDate}: ${reminderItems.length} dry-run`);
    }
    const decision = shortcutFetchDecision({
      itemCount: items.length,
      reason,
      summary,
      dryRun,
      preview,
    });
    const sendItems = decision.send === "yes" ? items : [];
    return reply({
      visitDate,
      send: decision.send,
      message: decision.message,
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

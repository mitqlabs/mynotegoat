import { NextRequest, NextResponse } from "next/server";
import { buildDeviceQueue, planReminderRun } from "@/lib/reminder-automation";
import {
  adminClient,
  alreadySentIds,
  authenticateDevice,
  loadVisitDay,
  loadWorkspaceConfig,
} from "@/lib/reminder-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders/queue — called by the office's sending device.
 * Auth: `Authorization: Bearer <device token>` (Settings → Text Reminders).
 * Returns ONLY appointment id, phone and rendered text for tomorrow's
 * sendable reminders, minus anything already sent. `?preview=1` returns
 * the list even on a non-run day (the device must still not send unless
 * `send` is true).
 */
export async function GET(request: NextRequest) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const device = await authenticateDevice(admin, request.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Invalid or revoked device token." }, { status: 401 });

  const config = await loadWorkspaceConfig(admin, device.workspace_id);
  const plan = planReminderRun({
    now: new Date(),
    settings: config.settings,
    officeHours: config.officeHours,
    closedIsoDates: config.closedIsoDates,
  });
  const preview = request.nextUrl.searchParams.get("preview") === "1";

  await admin.from("reminder_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  let items: ReturnType<typeof buildDeviceQueue> = [];
  if (plan.run || preview) {
    if (!config.templateBody.trim()) {
      return NextResponse.json(
        { send: false, dryRun: config.settings.dryRun, visitDate: plan.visitDate, reason: "No reminder template.", items: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
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
  return NextResponse.json(
    {
      send: plan.run && !config.settings.dryRun,
      run: plan.run,
      dryRun: config.settings.dryRun,
      reason: plan.run ? "" : plan.reason,
      visitDate: plan.visitDate,
      items,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

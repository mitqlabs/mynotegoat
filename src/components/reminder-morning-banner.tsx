"use client";

/**
 * Same-day warning when the office iPhone fetched this morning's texts and
 * didn't finish, or never ran. Reads the send log, devices, and open claims
 * from the cloud. Nothing about the warning is stored on this computer.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { patients } from "@/lib/mock-data";
import { loadScheduleAppointments } from "@/lib/schedule-appointments";
import { loadScheduleSettings } from "@/lib/schedule-settings";
import { defaultSmsReminderSettings, normalizeSmsReminderSettings, SMS_REMINDER_SETTINGS_KEY } from "@/lib/sms-reminders";
import { morningRunStatus, morningWorkDue, type MorningRunStatus } from "@/lib/reminder-automation-health";

/** The one iPhone shortcut. Tapping it with no message sends waiting texts. */
const SEND_NOW_URL = "shortcuts://run-shortcut?name=NoteGoat";

function readSettings() {
  if (typeof window === "undefined") return defaultSmsReminderSettings();
  try {
    return normalizeSmsReminderSettings(JSON.parse(window.localStorage.getItem(SMS_REMINDER_SETTINGS_KEY) ?? "null"));
  } catch {
    return defaultSmsReminderSettings();
  }
}

function onIphone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function ReminderMorningBanner() {
  const [status, setStatus] = useState<MorningRunStatus | null>(null);
  const [iphone, setIphone] = useState(false);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const client = getSupabaseBrowserClient();
      const workspaceId = getActiveWorkspaceIdSync();
      const settings = readSettings();
      const schedule = loadScheduleSettings();
      const now = new Date();
      if (!client || !workspaceId) {
        if (!cancel) setStatus(null);
        return;
      }
      const since = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();
      const [{ data: devices }, { data: logs }, { data: birthdays }, { data: broadcasts }] = await Promise.all([
        client
          .from("reminder_devices")
          .select("kind, last_seen_at, last_run_at, revoked_at")
          .eq("workspace_id", workspaceId),
        client.from("reminder_log").select("created_at").eq("workspace_id", workspaceId).gte("created_at", since).limit(500),
        client
          .from("birthday_text_log")
          .select("claimed_at, status")
          .eq("workspace_id", workspaceId)
          .eq("status", "claimed")
          .limit(50),
        client
          .from("reminder_broadcast_recipients")
          .select("claimed_until, status")
          .eq("workspace_id", workspaceId)
          .eq("status", "queued")
          .not("claimed_until", "is", null)
          .limit(50),
      ]);
      if (cancel) return;
      const active = (devices ?? []).filter((d) => !d.revoked_at);
      const iphones = active
        .filter((d) => d.kind === "iphone")
        .map((d) => ({ lastSeenAt: (d.last_seen_at as string | null) ?? null, lastRunAt: (d.last_run_at as string | null) ?? null }));
      const next = morningRunStatus({
        now,
        timeZone: settings.timeZone,
        sendHour: settings.sendHour,
        active: !settings.dryRun && (settings.enabled || settings.birthdayTexts),
        hasIphone: iphones.length > 0,
        dueToday: morningWorkDue({
          now,
          settings,
          officeHours: schedule.officeHours,
          appointments: loadScheduleAppointments(),
          patients,
        }),
        logTimes: ((logs ?? []) as { created_at: string }[]).map((r) => r.created_at),
        iphones,
        birthdayClaims: ((birthdays ?? []) as { claimed_at: string | null }[])
          .filter((r) => r.claimed_at)
          .map((r) => ({ claimedAt: r.claimed_at as string })),
        broadcastClaims: ((broadcasts ?? []) as { claimed_until: string | null }[]).map((r) => ({ claimedUntil: r.claimed_until })),
      });
      setStatus(next);
      setIphone(onIphone());
    };
    void load();
    const timer = window.setInterval(() => void load(), 2 * 60 * 1000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!status || (status.kind !== "unfinished" && status.kind !== "missed")) return null;
  return (
    <div className="border-b border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-950 lg:px-7" data-testid="morning-reminder-banner" role="alert">
      <p>
        <b>{status.lead}</b> {iphone ? null : status.action}
        {iphone ? (
          <a className="ml-2 inline-flex items-center rounded-lg bg-red-800 px-3 py-1 font-semibold text-white" href={SEND_NOW_URL}>
            Send Reminders Now
          </a>
        ) : null}
      </p>
    </div>
  );
}

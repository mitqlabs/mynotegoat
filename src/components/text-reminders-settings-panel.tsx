"use client";

/**
 * Settings → Text Reminders. Automatic day-before appointment texts sent
 * from the office Mac. Settings live in casemate.sms-reminders.v1
 * (this browser + the cloud copy); devices and the send log live in Supabase.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { DraftTextarea } from "@/components/draft-textarea";
import { markLocalWrite } from "@/lib/local-sync";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { createSmsTemplate, DEFAULT_REMINDER_BODY } from "@/lib/sms-templates";
import {
  buildReminderQueue,
  DEFAULT_OPT_OUT_TEXT,
  defaultSmsReminderSettings,
  normalizeSmsReminderSettings,
  sendableReminders,
  SMS_REMINDER_SETTINGS_KEY,
  type SmsReminderSettings,
} from "@/lib/sms-reminders";
import {
  autoRunDays,
  effectiveRunDays,
  generateDeviceToken,
  hashDeviceToken,
  renderReminderText,
  WEEKDAY_SHORT,
  withOptOutLine,
} from "@/lib/reminder-automation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useSimpleConfirm } from "@/components/fill-confirm-dialog";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { patients as patientDirectory } from "@/lib/mock-data";
import { appConfirm, appPrompt } from "@/components/app-dialog";
import { MessagePatientsComposer, SendFromIphoneButton, type MessagePatientsPrefill } from "@/components/message-patients-composer";
import { AutomationWarning, ReminderSetupChecklist } from "@/components/reminder-setup-checklist";
import { InnerFold, SetupCard } from "@/components/setup-card";
import { CollapsibleSection } from "@/components/collapsible-section";
import { devicesStatus, fmtDate, plainResult, senderRole, TEMPLATE_WORDS, fmtDateTime, imacStatus, iphoneStatus, lastCheckedText, lastRunText, officeMacSeen, optOutSummary, reminderSetupDone, sectionOpen, type ReminderSection } from "@/lib/reminder-format";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { automationHealth, AUTO_RUN_LOOKBACK_DAYS } from "@/lib/reminder-automation-health";

function loadSettings(): SmsReminderSettings {
  if (typeof window === "undefined") return defaultSmsReminderSettings();
  try {
    return normalizeSmsReminderSettings(JSON.parse(window.localStorage.getItem(SMS_REMINDER_SETTINGS_KEY) ?? "null"));
  } catch {
    return defaultSmsReminderSettings();
  }
}

function saveSettings(next: SmsReminderSettings) {
  markLocalWrite(SMS_REMINDER_SETTINGS_KEY);
  window.localStorage.setItem(SMS_REMINDER_SETTINGS_KEY, JSON.stringify(next));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(SMS_REMINDER_SETTINGS_KEY, "tasks", next));
}

type DeviceRow = {
  id: string;
  name: string;
  kind: string | null;
  is_primary: boolean | null;
  run_requested_until: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_run_at: string | null;
  last_run_summary: string | null;
  revoked_at: string | null;
};
type OptOutRow = { patientId: string; name: string; at: string; phoneLast4: string; source: string };
type LogRow = { id: number; visit_date: string; phone_last4: string; status: string; error: string | null; created_at: string };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3";
const rowBtn = "rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold";
const btn = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-4 text-sm font-semibold";

export function TextRemindersSettingsPanel() {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const { scheduleSettings } = useScheduleSettings();
  const { scheduleAppointments } = useScheduleAppointments();
  const [settings, setSettings] = useState<SmsReminderSettings>(() => loadSettings());
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  // Send history over the last two weeks (times + visit dates only), for the "8 AM automation may not be set up" check.
  const [history, setHistory] = useState<{ createdAt: string; visitDate: string }[]>([]);
  const [newToken, setNewToken] = useState("");
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenKind, setNewTokenKind] = useState<"mac" | "iphone">("iphone");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [optOuts, setOptOuts] = useState<OptOutRow[]>([]);
  const { ask, confirmDialog } = useSimpleConfirm();

  const update = (patch: Partial<SmsReminderSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const autoDays = useMemo(() => autoRunDays(scheduleSettings.officeHours), [scheduleSettings.officeHours]);
  const runDays = effectiveRunDays(settings, scheduleSettings.officeHours);
  const template =
    smsTemplates.find((t) => t.id === settings.templateId) ??
    smsTemplates.find((t) => /remind/i.test(t.name)) ??
    smsTemplates[0];

  const preview = template
    ? renderReminderText(
        template.body,
        { appointmentId: "x", patientId: "x", patientName: "Doe, Jane", phone: "5550100", date: "2026-04-20", time: "10:30", appointmentType: "Office Visit" },
        undefined,
        { officeName: officeSettings.officeName, doctorName: officeSettings.doctorName, phone: officeSettings.phone },
      )
    : "";
  const previewWithOptOut = withOptOutLine(preview, settings);

  const workspaceId = typeof window === "undefined" ? "" : getActiveWorkspaceIdSync();
  // Deep link from Key Dates ("Text affected patients"): a closure text for
  // that date / time window. No patient data travels in the URL.
  const [messagePrefill] = useState<MessagePatientsPrefill | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const date = q.get("msgDate") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const time = (v: string | null) => (v && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
    return { key: 1, date, message: (q.get("msgText") ?? "").slice(0, 640), startTime: time(q.get("msgStart")), endTime: time(q.get("msgEnd")) };
  });
  const origin = typeof window === "undefined" ? "https://www.mynotegoat.com" : window.location.origin;

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const [{ data: d }, { data: l }] = await Promise.all([
      client
        .from("reminder_devices")
        .select("id, name, kind, is_primary, run_requested_until, created_at, last_seen_at, last_run_at, last_run_summary, revoked_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      client
        .from("reminder_log")
        .select("id, visit_date, phone_last4, status, error, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    setDevices((d as DeviceRow[] | null) ?? []);
    setDevicesLoaded(true);
    setLog((l as LogRow[] | null) ?? []);
    const since = new Date(Date.now() - (AUTO_RUN_LOOKBACK_DAYS + 2) * 86_400_000).toISOString();
    const { data: h } = await client
      .from("reminder_log")
      .select("created_at, visit_date")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    setHistory(((h as { created_at: string; visit_date: string }[] | null) ?? []).map((r) => ({ createdAt: r.created_at, visitDate: r.visit_date })));
    // Patients who replied STOP (latest action per patient, still opted out).
    const { data: o } = await client
      .from("reminder_opt_outs")
      .select("patient_id, action, phone_last4, source, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300);
    const latest = new Map<string, { action: string; at: string; phoneLast4: string; source: string }>();
    for (const r of (o as { patient_id: string; action: string; phone_last4: string; source: string; created_at: string }[] | null) ?? []) {
      if (!latest.has(r.patient_id)) latest.set(r.patient_id, { action: r.action, at: r.created_at, phoneLast4: r.phone_last4, source: r.source });
    }
    const stopped = Array.from(latest.entries()).filter(([, v]) => v.action === "stop");
    if (!stopped.length) return setOptOuts([]);
    const { data: pts } = await client
      .from("patients")
      .select("id, full_name, text_reminders_off")
      .eq("workspace_id", workspaceId)
      .in("id", stopped.map(([id]) => id));
    const byId = new Map(((pts as { id: string; full_name: string | null; text_reminders_off: boolean | null }[] | null) ?? []).map((p) => [p.id, p]));
    setOptOuts(
      stopped
        .filter(([id]) => byId.get(id)?.text_reminders_off === true)
        .map(([id, v]) => ({ patientId: id, name: byId.get(id)?.full_name || "Unknown patient", at: v.at, phoneLast4: v.phoneLast4, source: v.source })),
    );
  }, [workspaceId]);

  const reEnable = async (row: OptOutRow) => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const ok = await ask({
      title: `Turn text reminders back on for ${row.name}?`,
      lines: ["They replied STOP. Only do this if they asked to get texts again."],
      confirmLabel: "Turn back on",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    const { error } = await client
      .from("patients")
      .update({ text_reminders_off: false })
      .eq("workspace_id", workspaceId)
      .eq("id", row.patientId);
    if (error) return setMessage(`Could not turn texts back on: ${error.message}`);
    await client.from("reminder_opt_outs").insert({
      workspace_id: workspaceId,
      patient_id: row.patientId,
      action: "start",
      source: "staff",
      phone_last4: row.phoneLast4,
    });
    await refresh();
  };

  useEffect(() => {
    // Async fetch on mount; state is set after the network round trip.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Opt-outs used to be saved only in the browser. Copy any this browser
  // knows about to the cloud so the sending device honors them. Only ever
  // sets the flag ON; never clears one.
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const ids = patientDirectory.filter((p) => p.textRemindersOff).map((p) => p.id);
    if (!ids.length) return;
    void client
      .from("patients")
      .update({ text_reminders_off: true })
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .then(({ error }) => {
        if (error) console.error("[text-reminders] opt-out sync failed:", error.message);
      });
  }, [workspaceId]);

  const addDevice = async (kind: "mac" | "iphone") => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return setMessage("Sign in to add a sender.");
    const name = (await appPrompt("Give this sender a name", { defaultValue: kind === "iphone" ? "Office iPhone" : "Office iMac" }))?.trim();
    if (!name) return;
    const token = generateDeviceToken();
    const firstActive = !devices.some((d) => !d.revoked_at);
    const { error } = await client.from("reminder_devices").insert({
      workspace_id: workspaceId,
      name,
      kind,
      // The first device is primary; the iPhone becomes primary when added.
      is_primary: firstActive || kind === "iphone",
      token_hash: await hashDeviceToken(token),
    });
    if (!error && (kind === "iphone" || firstActive)) {
      const others = devices.filter((d) => !d.revoked_at).map((d) => d.id);
      if (others.length) await client.from("reminder_devices").update({ is_primary: false }).in("id", others);
    }
    if (error) return setMessage(`Couldn't add the sender: ${error.message}`);
    setNewToken(token);
    setNewTokenName(name);
    setNewTokenKind(kind);
    setCopied(false);
    setMessage("");
    update({ sections: { ...settings.sections, devices: true } });
    void refresh();
  };

  const revokeDevice = async (id: string) => {
    if (!(await appConfirm("Remove this sender? It will stop sending texts right away. You can add it again later.", { confirmLabel: "Remove", cancelLabel: "Keep it", danger: true }))) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.from("reminder_devices").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) setMessage(`Couldn't remove it: ${error.message}`);
    void refresh();
  };

  const newCode = async (id: string) => {
    if (!(await appConfirm("Get a new setup code for this sender? The old code stops working, so you will need to paste the new one into the iPhone or iMac setup.", { confirmLabel: "Get new setup code", cancelLabel: "Cancel" }))) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const token = generateDeviceToken();
    const { error } = await client
      .from("reminder_devices")
      .update({ token_hash: await hashDeviceToken(token) })
      .eq("id", id);
    if (error) return setMessage(`Couldn't make a new setup code: ${error.message}`);
    const dev = devices.find((d) => d.id === id);
    setNewToken(token);
    setNewTokenName(dev?.name ?? "this sender");
    setNewTokenKind(dev?.kind === "mac" ? "mac" : "iphone");
    setCopied(false);
    setMessage("");
    update({ sections: { ...settings.sections, devices: true } });
    void refresh();
  };

  const makePrimary = async (id: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const others = devices.filter((d) => d.id !== id && !d.revoked_at).map((d) => d.id);
    if (others.length) await client.from("reminder_devices").update({ is_primary: false }).in("id", others);
    const { error } = await client.from("reminder_devices").update({ is_primary: true }).eq("id", id);
    if (error) setMessage(`Couldn't change the main sender: ${error.message}`);
    void refresh();
  };

  const toggleDay = (dow: number) => {
    const current = new Set(runDays);
    if (current.has(dow)) current.delete(dow);
    else current.add(dow);
    update({ runDays: Array.from(current).sort((a, b) => a - b) });
  };

  const activeDevices = devices.filter((d) => !d.revoked_at);
  const devicesCard = devicesStatus(devices, settings.timeZone);
  const iphoneCard = iphoneStatus(devices);
  const imacCard = imacStatus(devices);
  const hasIphone = activeDevices.some((d) => d.kind === "iphone");

  const setSection = (key: ReminderSection, open: boolean) =>
    update({ sections: { ...settings.sections, [key]: open } });

  // Set up starts collapsed once it is finished (box ticked AND a device has run). Until the devices
  // load, the ticked box alone decides, so the page doesn't open and then snap shut.
  const setupDone = devicesLoaded ? reminderSetupDone(settings.automationConfirmed, devices) : settings.automationConfirmed;
  const setupOpen = sectionOpen(settings.sections, "setup", !setupDone);

  const confirmAutomation = (confirmed: boolean) =>
    update({ automationConfirmed: confirmed, automationConfirmedAt: confirmed ? new Date().toISOString() : "" });

  // No automatic send near the send hour on the last two run days that had reminders due?
  const missedAutoRuns = useMemo(() => {
    if (!settings.enabled || !hasIphone) return [];
    const patientsById = new Map(patientDirectory.map((p) => [p.id, p]));
    const loggedVisitDates = new Set(history.map((r) => r.visitDate));
    const firstDevice = activeDevices.reduce<string | null>((min, d) => (!min || d.created_at < min ? d.created_at : min), null);
    const result = automationHealth({
      now: new Date(),
      timeZone: settings.timeZone,
      sendHour: settings.sendHour,
      runDays,
      logTimes: history.map((r) => r.createdAt),
      deviceAddedAt: firstDevice,
      // Due = something was texted for that visit date, or reminders are still waiting for it.
      hasDueReminders: (visitDate) =>
        loggedVisitDates.has(visitDate) ||
        sendableReminders(buildReminderQueue(scheduleAppointments, patientsById, settings, visitDate)).length > 0,
    });
    return result.warn ? result.missed : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, settings, runDays, scheduleAppointments, devices, hasIphone]);

  return (
    <div className="space-y-5" data-testid="text-reminders-panel">
      <AutomationWarning hasIphone={hasIphone} settings={settings} warning={missedAutoRuns} />

      <CollapsibleSection
        hint={setupDone ? "Done. Open to change senders, shortcuts or opt-out setup." : "Checklist, sending devices, shortcuts and opt-out setup."}
        onToggle={(next) => setSection("setup", next)}
        open={setupOpen}
        testId="section-setup"
        title="Set up"
      >
      <ReminderSetupChecklist
        onConfirm={confirmAutomation}
        onToggle={(next) => setSection("steps", next)}
        open={sectionOpen(settings.sections, "steps", !settings.automationConfirmed)}
        settings={settings}
      />

      <SetupCard
        actions={
          <>
            <button className={rowBtn} onClick={() => void addDevice("iphone")} type="button">
              + Add iPhone
            </button>
            <button className={rowBtn} onClick={() => void addDevice("mac")} type="button">
              + Add Mac
            </button>
          </>
        }
        onToggle={(next) => setSection("devices", next)}
        open={sectionOpen(settings.sections, "devices", true)}
        status={devicesCard.status}
        summary={devicesCard.summary}
        testId="section-devices"
        title="Sending devices"
      >
        {newToken && (
          <div className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3" data-testid="new-device-token">
            <p className="font-semibold">Your new setup code for {newTokenName}. Copy it now. It will not be shown again.</p>
            <code className="select-all break-all rounded-md bg-white px-2 py-1.5 font-mono text-sm">{newToken}</code>
            <p className="text-amber-900">
              <b>Do not share this setup code.</b> Anyone who has it can send texts as your office. Paste it into{" "}
              {newTokenKind === "mac" ? "the iMac setup" : "the iPhone setup"} below.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
                data-testid="copy-device-token"
                onClick={() => {
                  void navigator.clipboard?.writeText(newToken).then(() => setCopied(true));
                }}
                type="button"
              >
                {copied ? "✓ Copied" : "Copy setup code"}
              </button>
              <button className={rowBtn} data-testid="hide-device-token" onClick={() => { setNewToken(""); setCopied(false); }} type="button">
                Hide setup code
              </button>
            </div>
          </div>
        )}
        {activeDevices.length === 0 ? (
          <p className="text-[var(--text-muted)]">No sender yet. Click <b>+ Add iPhone</b> (or <b>+ Add Mac</b>) above.</p>
        ) : (
          <ul className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)]" data-testid="device-list">
            {activeDevices.map((d) => {
              const run = lastRunText(d.last_run_summary, d.last_run_at, settings.timeZone);
              return (
                <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3" key={d.id}>
                  <div className="min-w-0 grid gap-0.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.name}</span>
                      <span className="rounded-md bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-semibold">
                        {senderRole(d.is_primary)}
                      </span>
                    </p>
                    <p className="text-[var(--text-muted)]">{d.kind === "iphone" ? "iPhone" : "iMac"} · {lastCheckedText(d.last_seen_at, settings.timeZone)}</p>
                    {run && <p className="text-[var(--text-muted)]">{run}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!d.is_primary && (
                      <button className={rowBtn} onClick={() => void makePrimary(d.id)} type="button">
                        Make main sender
                      </button>
                    )}
                    <button className={rowBtn} onClick={() => void newCode(d.id)} type="button">
                      Get new setup code
                    </button>
                    <button className={`${rowBtn} text-red-700`} onClick={() => void revokeDevice(d.id)} type="button">
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {message && <p className="font-semibold text-red-700">{message}</p>}
      </SetupCard>

      <SetupCard
        onToggle={(next) => setSection("how", next)}
        open={sectionOpen(settings.sections, "how", false)}
        summary={`Who sends the texts, and when. Runs ${hourLabel(settings.sendHour)} on ${runDays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "no days"}.`}
        testId="section-how"
        title="How it works"
      >
        <ul className="list-disc space-y-1.5 pl-5" data-testid="how-it-works">
          <li>
            On each run day at {hourLabel(settings.sendHour)}, your main sender (the iPhone or iMac) texts each patient with a visit the next day, one at a time, from the Messages app. Run days: {runDays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "none"}.
          </li>
          <li>
            Who does not get a text: closed days (Key Dates), canceled and no-show visits, patients marked &quot;no text reminders&quot;, patients with no
            phone, and anyone who replied STOP.
          </li>
          <li>
            Nobody gets two texts. It is one text per patient per day. The backup sender only sends what is still unsent 30 minutes later.
          </li>
          <li>
            <b>Send-Reminders</b> (iPhone shortcut) texts tomorrow&apos;s patients. It runs at {hourLabel(settings.sendHour)} only after you
            make the automation (Step 2 above).
          </li>
          <li>
            <b>Send Reminders Now</b> (iPhone shortcut) is the backup. Tap it if the phone was off or dead. It sends today&apos;s missed
            reminders (only visits still ahead, worded &quot;today&quot;), tomorrow&apos;s if due, and any Message patients texts that are waiting to go out.
            Anyone already texted is skipped.
          </li>
          <li>The iMac looks for texts to send every 10 minutes by itself, so it needs no button. It also notices STOP replies by itself.</li>
          <li>Test mode means nothing is texted. It only shows in Recent sends what would have gone out. Turn it off when Recent sends looks right.</li>
        </ul>
        <SendFromIphoneButton />
      </SetupCard>

      <SetupCard
        onToggle={(next) => setSection("optout", next)}
        open={sectionOpen(settings.sections, "optout", false)}
        summary={optOutSummary(settings.optOutLine, optOuts.length)}
        testId="section-optout"
        title="Opt-out (reply STOP)"
      >
        <div className="grid gap-3" data-testid="opt-out-settings">
          <label className="inline-flex items-center gap-2 font-semibold">
            <input checked={settings.optOutLine} onChange={(e) => update({ optOutLine: e.target.checked })} type="checkbox" />
            Add an opt-out line to every text (reminders and Message patients)
          </label>
          {settings.optOutLine && (
            <input
              aria-label="Opt-out wording"
              className={input}
              maxLength={120}
              onBlur={(e) => update({ optOutText: e.target.value.trim() || DEFAULT_OPT_OUT_TEXT })}
              onChange={(e) => setSettings((current) => ({ ...current, optOutText: e.target.value }))}
              value={settings.optOutText}
            />
          )}
          <p className="text-[var(--text-muted)]">
            When a patient replies STOP (or UNSUBSCRIBE, END, QUIT, STOPALL), their text reminders turn off. START turns them back on.
            NoteGoat never texts back. A message that already says STOP does not get the line twice.
          </p>
          <div className="rounded-lg border border-[var(--line-soft)]" data-testid="opt-out-list">
            <p className="border-b border-[var(--line-soft)] px-3 py-2 font-semibold">Opted out by reply ({optOuts.length})</p>
            {optOuts.length === 0 ? (
              <p className="px-3 py-2 text-[var(--text-muted)]">Nobody has replied STOP.</p>
            ) : (
              <ul className="max-h-60 overflow-y-auto">
                {optOuts.map((row) => (
                  <li className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] px-3 py-2 first:border-t-0" key={row.patientId}>
                    <span>
                      <span className="font-semibold">{row.name}</span>{" "}
                      <span className="text-[var(--text-muted)]">· {fmtDateTime(row.at, settings.timeZone)}</span>
                    </span>
                    <button className={rowBtn} onClick={() => void reEnable(row)} type="button">
                      Turn texts back on
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <InnerFold testId="optout-iphone-steps" title="Catch STOP replies on the iPhone (only if the iPhone sends the texts)">
          <p className="text-[var(--text-muted)]">The iMac reads STOP replies on its own. Skip this if you use the iMac.</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              On the office iPhone, tap{" "}
              <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/NoteGoat-Opt-Out.shortcut" download>Get NoteGoat Opt-Out</a>
              {" "}→ <b>Add Shortcut</b>, and paste the same setup code when it asks.
            </li>
            <li>In Shortcuts, tap <b>Automation</b> → <b>+</b> → <b>Message</b>.</li>
            <li>Tap <b>Message Contains</b>, type <Mono>STOP</Mono>, tap <b>Done</b>. Leave <b>Sender</b> empty (anyone).</li>
            <li>Choose <b>Run Immediately</b> and turn <b>Notify When Run</b> off. Tap <b>Next</b>.</li>
            <li>Pick <b>Run Shortcut</b> → <b>NoteGoat Opt-Out</b>. Tap the shortcut&apos;s <b>Input</b> and choose <b>Shortcut Input</b> (the message). Tap <b>Done</b>.</li>
            <li>Repeat steps 2–5 with <Mono>START</Mono> if you want patients to be able to opt back in.</li>
          </ol>
          <p className="text-[var(--text-muted)]">
            Good to know: iOS only runs this for messages that <i>contain</i> STOP, and NoteGoat only acts when the whole reply is the
            word. If the patient is saved in the iPhone&apos;s Contacts, iOS may pass their name instead of their number, and NoteGoat
            can&apos;t match it. Check &quot;Opted out by reply&quot; above, and mark them &quot;no text reminders&quot; by hand if needed.
            Words like UNSUBSCRIBE need their own automation.
          </p>
        </InnerFold>
      </SetupCard>

      <SetupCard
        onToggle={(next) => setSection("iphone", next)}
        open={sectionOpen(settings.sections, "iphone", false)}
        status={iphoneCard.status}
        summary={iphoneCard.summary}
        testId="section-iphone"
        title="iPhone setup (Shortcuts app)"
      >
        <div className="space-y-3" data-testid="iphone-steps">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Above, click <b>+ Add iPhone</b>, then <b>Copy setup code</b>. It is a long line of letters and numbers. Text or AirDrop it to yourself so you can paste it on the iPhone.</li>
            <li>
              On the office iPhone, open this page and tap{" "}
              <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/Send-Reminders.shortcut" download>Get the shortcut</a>
              {" "}→ <b>Add Shortcut</b>. Paste your setup code when it asks.
            </li>
            <li>
              Get{" "}
              <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/Send-Reminders-Now.shortcut" download>Send Reminders Now</a>
              {" "}the same way. It is the backup for days the phone missed {hourLabel(settings.sendHour)}. Long-press it → <b>Share</b> → <b>Add to Home Screen</b>.
            </li>
            <li>
              <b>Last step, required:</b> make the {hourLabel(settings.sendHour)} automation. Do <b>Step 2</b> in the box at the top of Set up.
            </li>
          </ol>
        </div>
        <InnerFold testId="iphone-steps-manual" title="Only if the download did not work: build the shortcut by hand">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Above, click <b>+ Add iPhone</b>, then <b>Copy setup code</b>.</li>
            <li>On the office iPhone, open the <b>Shortcuts</b> app and tap <b>+</b> (top right).</li>
            <li>Tap the name at the top and rename it <b>Send Reminders</b>.</li>
            <li>Tap <b>Search Actions</b>, type <b>Get Contents of URL</b>, and tap it.</li>
            <li>Tap the blue <b>URL</b> and paste: <Mono>{`${origin}/api/reminders/queue?format=shortcut`}</Mono></li>
            <li>Tap the <b>⌄</b> arrow (Show More) on that block. Leave <b>Method</b> on <Mono>GET</Mono>.</li>
            <li>
              Tap <b>Headers</b> → <b>Add new header</b>:
              <ol className="mt-1 list-[lower-alpha] space-y-1 pl-5">
                <li><b>Key</b>: <Mono>Authorization</Mono></li>
                <li><b>Text</b>: type <Mono>Bearer </Mono> (with one space after it), then paste your code, e.g. <Mono>Bearer ngr_abc123…</Mono></li>
              </ol>
            </li>
            <li>Add <b>Get Dictionary Value</b>. Set it to get the value for key <Mono>visitDate</Mono> in <b>Contents of URL</b>.</li>
            <li>Add <b>Set Variable</b> and name the variable <Mono>VisitDate</Mono>.</li>
            <li>Add another <b>Get Dictionary Value</b>: key <Mono>items</Mono> in <b>Contents of URL</b>.</li>
            <li>
              Add <b>Repeat with Each</b> (it repeats with each item from the step above). Drag these <b>inside</b> the loop, in order:
              <ol className="mt-1 list-[lower-alpha] space-y-1 pl-5">
                <li><b>Get Dictionary Value</b>: key <Mono>text</Mono> in <b>Repeat Item</b>.</li>
                <li><b>Send Message</b>: message = that <b>Dictionary Value</b>; recipient = another <b>Get Dictionary Value</b> with key <Mono>phone</Mono> in <b>Repeat Item</b>.</li>
                <li>On Send Message, tap <b>⌄</b> and turn <b>Show When Run</b> OFF.</li>
                <li><b>Get Contents of URL</b>: <Mono>{`${origin}/api/reminders/ack`}</Mono>. Tap <b>⌄</b>, set <b>Method</b> to <Mono>POST</Mono>, and add the same <Mono>Authorization</Mono> header.</li>
                <li>
                  Set <b>Request Body</b> to <b>JSON</b> and add 3 fields (type Text):
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li><Mono>visitDate</Mono> = the <b>VisitDate</b> variable</li>
                    <li><Mono>id</Mono> = <b>Repeat Item</b> → key <Mono>id</Mono></li>
                    <li><Mono>status</Mono> = <Mono>sent</Mono></li>
                  </ul>
                </li>
                <li><b>Wait</b>: <Mono>5</Mono> seconds.</li>
              </ol>
            </li>
            <li>Optional, after the loop: <b>Get Dictionary Value</b> key <Mono>message</Mono> in Contents of URL → <b>Show Notification</b>.</li>
            <li>Tap <b>▶</b> to run it once. Tap <b>Always Allow</b> for mynotegoat.com and for Messages.</li>
            <li>
              Back in the Shortcuts list, long-press it → <b>Duplicate</b>. Rename the copy <b>Send Reminders Now</b>, and change its first URL to end in{" "}
              <Mono>?format=shortcut&amp;force=1</Mono>. Long-press → <b>Share</b> → <b>Add to Home Screen</b>. Nobody gets two texts.
            </li>
            <li>
              <b>Required:</b> the shortcut does not run by itself. Do <b>Step 2</b> at the top of Set up to make the {hourLabel(settings.sendHour)} automation.
            </li>
          </ol>
        </InnerFold>
      </SetupCard>

      <SetupCard
        onToggle={(next) => setSection("imac", next)}
        open={sectionOpen(settings.sections, "imac", false)}
        status={imacCard.status}
        summary={imacCard.summary}
        testId="section-imac"
        title="iMac setup (one click)"
      >
        <div className="space-y-3" data-testid="mac-steps">
          <ol className="list-decimal space-y-2 pl-5">
            <li>On the iMac, open <b>Messages</b> and make sure it is signed in to the office Apple ID.</li>
            <li>Above, click <b>+ Add Mac</b>, then <b>Copy setup code</b>.</li>
            <li>
              <a className="font-semibold text-[var(--brand-primary)] underline" data-testid="mac-setup-download" download href="/mac/NoteGoat-Reminders-Setup.command">Download iMac setup</a>
              . Then open <b>Downloads</b>, <b>right-click</b> the file <Mono>NoteGoat-Reminders-Setup.command</Mono>, choose <b>Open</b>, then <b>Open</b> again.
            </li>
            <li data-testid="mac-not-opened-step">
              <b>If macOS says &quot;Not Opened&quot;</b> (newer macOS, such as Sequoia): click <b>Done</b>. Do not click Move to Trash. Then open{" "}
              <b>System Settings</b> → <b>Privacy &amp; Security</b>, scroll down to the message about <Mono>NoteGoat-Reminders-Setup.command</Mono>,
              and click <b>Open Anyway</b>. Type your Mac password if it asks, then click <b>Open Anyway</b> again.
            </li>
            <li>
              Terminal opens and explains each step. Paste the setup code when it asks, then type your <b>Mac password</b>. Nothing shows while you
              type, and that is normal. (The password lets the iMac wake up at 8:45 AM.) When it says <b>All set</b>, press <b>Return</b>.
            </li>
            <li>The first time it sends, macOS asks to let it control <b>Messages</b>. Click <b>OK</b>.</li>
          </ol>
          <p className="mt-2 text-[var(--text-muted)]">The iMac is the backup sender. It waits 30 minutes for the main sender and only sends what is still unsent.</p>
        </div>
        <InnerFold testId="mac-steps-manual" title="Only if the download did not work: set up in Terminal by hand">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>On the iMac, open <b>Messages</b> and make sure it is signed in to the office Apple ID.</li>
            <li>Above, click <b>+ Add Mac</b>, then <b>Copy setup code</b>.</li>
            <li>Open <b>Terminal</b> (press <b>⌘ Space</b>, type <b>Terminal</b>, press <b>Return</b>).</li>
            <li>
              Paste this and press <b>Return</b> (it downloads the sending program):
              <div className="mt-1">
                <Mono>{`mkdir -p ~/notegoat-reminders && cd ~/notegoat-reminders && RAW=https://raw.githubusercontent.com/mitqlabs/mynotegoat/main/tools/mac-reminders; curl -fsSLO $RAW/install.sh -O $RAW/notegoat-reminders.sh -O $RAW/uninstall.sh`}</Mono>
              </div>
            </li>
            <li>Paste <Mono>bash install.sh</Mono> and press <b>Return</b>.</li>
            <li>When it asks, paste the setup code and press <b>Return</b> (nothing shows while pasting; that&apos;s normal). It saves the setup code on the iMac and checks that it works.</li>
            <li>The first time it sends, macOS asks to let it control <b>Messages</b>. Click <b>OK</b>.</li>
            <li>Done. The Mac checks every 10 minutes between 8 AM and 6 PM. As the backup sender it waits 30 minutes for the main sender and only sends what is still unsent.</li>
            <li>
              Optional: wake a sleeping iMac each morning. In Terminal paste{" "}
              <Mono>sudo pmset repeat wakeorpoweron MTWRFSU 08:45:00</Mono> and type your Mac password. To undo:{" "}
              <Mono>sudo pmset repeat cancel</Mono>
            </li>
            <li>
              Check the list without sending:{" "}
              <Mono>bash ~/Library/Application\ Support/NoteGoat/notegoat-reminders.sh --preview</Mono>. Log:{" "}
              <Mono>~/Library/Logs/NoteGoat/reminders.log</Mono>
            </li>
            <li>Got a <b>new setup code</b>? Run the &quot;bash install.sh&quot; step again and paste the new code. To remove the iMac: <Mono>bash ~/notegoat-reminders/uninstall.sh</Mono>, then click <b>Remove</b> on its row above.</li>
          </ol>
        </InnerFold>
      </SetupCard>
      </CollapsibleSection>

      <CollapsibleSection
        hint="Send settings, Message patients and Recent sends."
        onToggle={(next) => setSection("texts", next)}
        open={sectionOpen(settings.sections, "texts", true)}
        testId="section-texts"
        title="Texts"
      >
      <div className="flex flex-wrap items-end gap-4">
        <label className="inline-flex h-[42px] items-center gap-2 text-sm font-semibold">
          <input checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} type="checkbox" />
          Send reminders automatically
        </label>
        <label className="inline-flex h-[42px] items-center gap-2 text-sm font-semibold">
          <input checked={settings.dryRun} onChange={(e) => update({ dryRun: e.target.checked })} type="checkbox" />
          Test mode (nothing is texted)
        </label>
        <label className="grid gap-1">
          <span className={label}>Send time</span>
          <select className={input} onChange={(e) => update({ sendHour: Number(e.target.value) })} value={settings.sendHour}>
            {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-1">
        <span className={label}>Run days</span>
        <div className="flex flex-wrap items-center gap-2">
          {WEEKDAY_SHORT.map((day, dow) => (
            <button
              className={`h-[42px] rounded-xl border px-3 text-sm font-semibold ${
                runDays.includes(dow)
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                  : "border-[var(--line-soft)] bg-white"
              }`}
              key={day}
              onClick={() => toggleDay(dow)}
              type="button"
            >
              {day}
            </button>
          ))}
          {settings.runDays === null ? (
            <span className="text-sm text-[var(--text-muted)]">Automatic: the day before each open office day.</span>
          ) : (
            <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => update({ runDays: null })} type="button">
              Reset to automatic ({autoDays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "none"})
            </button>
          )}
        </div>
        <p className="text-sm text-[var(--text-muted)]" data-testid="run-days-help">
          Pick the days the phone sends texts. Each day it texts the patients who have a visit the <b>next</b> day. For example, if Thursday is picked, patients booked Friday get a text on Thursday.
        </p>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[14rem] flex-1 gap-1">
            <span className={label}>Message template</span>
            <select className={input} onChange={(e) => update({ templateId: e.target.value })} value={template?.id ?? ""}>
              {smsTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {!smsTemplates.some((t) => /remind/i.test(t.name)) && (
            <button
              className={btn}
              onClick={() => {
                const created = createSmsTemplate(
                  "⏰ Appointment Reminder",
                  DEFAULT_REMINDER_BODY,
                );
                updateSmsTemplates((current) => [...current, created]);
                update({ templateId: created.id });
              }}
              type="button"
            >
              + Appointment Reminder template
            </button>
          )}
        </div>
        {template && (
          <DraftTextarea
            className="min-h-[90px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            key={template.id}
            onSave={(body) => {
              const id = template.id;
              updateSmsTemplates((current) =>
                current.map((t) => (t.id === id ? { ...t, body, updatedAt: new Date().toISOString() } : t)),
              );
            }}
            value={template.body}
          />
        )}
        <details className="text-sm" data-testid="template-words">
          <summary className="cursor-pointer font-semibold text-[var(--brand-primary)]">What can I put in a template?</summary>
          <div className="mt-2 grid gap-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2">
            <p className="text-[var(--text-muted)]">Type any of these words exactly as shown. NoteGoat swaps each one for the real name, date or time when the text is sent.</p>
            <ul className="grid gap-0.5">
              {TEMPLATE_WORDS.map((w) => (
                <li key={w.token}>
                  <Mono>{w.token}</Mono> becomes {w.plain}
                </li>
              ))}
            </ul>
            <p className="text-[var(--text-muted)]">Keep it short. Do not put health details in a text.</p>
          </div>
        </details>
        {template && (
          <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2 text-sm">
            <span className="font-semibold">Preview: </span>
            {previewWithOptOut}
          </p>
        )}
      </div>

      <MessagePatientsComposer
        macConnected={officeMacSeen(devices)}
        onRecentToggle={(next) => setSection("messages", next)}
        prefill={messagePrefill}
        recentOpen={sectionOpen(settings.sections, "messages", true)}
        settings={settings}
        workspaceId={workspaceId}
      />

      <CollapsibleSection
        actions={
          <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        }
        onToggle={(next) => setSection("sends", next)}
        open={sectionOpen(settings.sections, "sends", true)}
        testId="recent-sends"
        title="Recent sends"
        variant="inline"
      >
        {log.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing sent yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-[var(--text-muted)]">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Visit date</th>
                <th className="py-1 pr-3">Phone ending</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                  <td className="py-1 pr-3">{fmtDateTime(row.created_at, settings.timeZone)}</td>
                  <td className="py-1 pr-3">{fmtDate(row.visit_date)}</td>
                  <td className="py-1 pr-3">{row.phone_last4}</td>
                  <td className="py-1">
                    {plainResult(row.status)}
                    {row.error ? ` — ${row.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsibleSection>
      </CollapsibleSection>
      {confirmDialog}
    </div>
  );
}


function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="select-all break-all rounded-md bg-[var(--bg-soft)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-main)]">
      {children}
    </code>
  );
}

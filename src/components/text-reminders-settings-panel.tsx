"use client";

/**
 * Settings → Text Reminders. Automatic day-before appointment texts sent
 * from the office Mac. Settings live in casemate.sms-reminders.v1
 * (localStorage + workspace_kv); devices and the send log live in Supabase.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { DraftTextarea } from "@/components/draft-textarea";
import { markLocalWrite } from "@/lib/local-sync";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { createSmsTemplate, DEFAULT_REMINDER_BODY, SMS_TOKENS } from "@/lib/sms-templates";
import {
  DEFAULT_OPT_OUT_TEXT,
  defaultSmsReminderSettings,
  normalizeSmsReminderSettings,
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

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "never";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3";
const btn = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-4 text-sm font-semibold";

export function TextRemindersSettingsPanel() {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const { scheduleSettings } = useScheduleSettings();
  const [settings, setSettings] = useState<SmsReminderSettings>(() => loadSettings());
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [newToken, setNewToken] = useState("");
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
    setLog((l as LogRow[] | null) ?? []);
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
    if (!client || !workspaceId) return setMessage("Sign in to add a device.");
    const name = (await appPrompt("Name this device", { defaultValue: kind === "iphone" ? "Office iPhone" : "Office iMac" }))?.trim();
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
    if (error) return setMessage(`Couldn't add the device: ${error.message}`);
    setNewToken(token);
    setCopied(false);
    setMessage("");
    void refresh();
  };

  const revokeDevice = async (id: string) => {
    if (!(await appConfirm("Revoke this device? It will stop sending immediately."))) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.from("reminder_devices").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) setMessage(`Couldn't revoke: ${error.message}`);
    void refresh();
  };

  const newCode = async (id: string) => {
    if (!(await appConfirm("Make a new code for this device? The old code stops working; update it in the Shortcut."))) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const token = generateDeviceToken();
    const { error } = await client
      .from("reminder_devices")
      .update({ token_hash: await hashDeviceToken(token) })
      .eq("id", id);
    if (error) return setMessage(`Couldn't make a new code: ${error.message}`);
    setNewToken(token);
    setCopied(false);
    setMessage("");
    void refresh();
  };

  const makePrimary = async (id: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const others = devices.filter((d) => d.id !== id && !d.revoked_at).map((d) => d.id);
    if (others.length) await client.from("reminder_devices").update({ is_primary: false }).in("id", others);
    const { error } = await client.from("reminder_devices").update({ is_primary: true }).eq("id", id);
    if (error) setMessage(`Couldn't change the primary device: ${error.message}`);
    void refresh();
  };

  const toggleDay = (dow: number) => {
    const current = new Set(runDays);
    if (current.has(dow)) current.delete(dow);
    else current.add(dow);
    update({ runDays: Array.from(current).sort((a, b) => a - b) });
  };

  const activeDevices = devices.filter((d) => !d.revoked_at);

  return (
    <div className="space-y-5" data-testid="text-reminders-panel">
      <div className="flex flex-wrap items-end gap-4">
        <label className="inline-flex h-[42px] items-center gap-2 text-sm font-semibold">
          <input checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} type="checkbox" />
          Send reminders automatically
        </label>
        <label className="inline-flex h-[42px] items-center gap-2 text-sm font-semibold">
          <input checked={settings.dryRun} onChange={(e) => update({ dryRun: e.target.checked })} type="checkbox" />
          Dry run (log only, send nothing)
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
        <span className={label}>Run days (each run texts the NEXT day&apos;s appointments)</span>
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
        <p className="text-xs text-[var(--text-muted)]">
          Placeholders: {SMS_TOKENS.map((t) => `${t.token} = ${t.label}`).join(" · ")}. Keep it short; no diagnoses or visit details.
        </p>
        {template && (
          <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2 text-sm">
            <span className="font-semibold">Preview: </span>
            {previewWithOptOut}
          </p>
        )}
      </div>

      <div className="grid gap-2" data-testid="opt-out-settings">
        <span className={label}>Opt-out (reply STOP)</span>
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
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
        <p className="text-xs text-[var(--text-muted)]">
          When a patient replies STOP (or UNSUBSCRIBE, END, QUIT, STOPALL), the iMac or iPhone tells NoteGoat and
          their text reminders turn off. START turns them back on. NoteGoat never texts back. A message that already says
          STOP doesn&apos;t get the line twice.
        </p>
        <div className="rounded-xl border border-[var(--line-soft)] bg-white" data-testid="opt-out-list">
          <p className="border-b border-[var(--line-soft)] px-3 py-2 text-sm font-semibold">
            Opted out by reply ({optOuts.length})
          </p>
          {optOuts.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Nobody has replied STOP.</p>
          ) : (
            <ul className="max-h-60 overflow-y-auto text-sm">
              {optOuts.map((row) => (
                <li className="flex items-center justify-between gap-2 border-t border-[var(--line-soft)] px-3 py-2 first:border-t-0" key={row.patientId}>
                  <span>
                    <span className="font-semibold">{row.name}</span>{" "}
                    <span className="text-[var(--text-muted)]">· {fmt(row.at)}</span>
                  </span>
                  <button className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold" onClick={() => void reEnable(row)} type="button">
                    Turn texts back on
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={label}>Sending devices</span>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => void addDevice("iphone")} type="button">
              + Add iPhone
            </button>
            <button className={btn} onClick={() => void addDevice("mac")} type="button">
              + Add Mac
            </button>
          </div>
        </div>
        {newToken && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Device token (shown once; paste it into the Shortcut or Mac setup):</p>
              <button
                className="text-sm font-semibold text-[var(--brand-primary)]"
                onClick={() => {
                  void navigator.clipboard?.writeText(newToken).then(() => setCopied(true));
                }}
                type="button"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="break-all">{newToken}</code>
          </div>
        )}
        {activeDevices.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No device connected yet.</p>
        ) : (
          activeDevices.map((d) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" key={d.id}>
              <span>
                <span className="font-semibold">{d.name}</span>{" "}
                <span className="rounded-md bg-[var(--bg-soft)] px-1.5 py-0.5 text-xs font-semibold">
                  {d.kind === "iphone" ? "iPhone" : "Mac"} · {d.is_primary ? "Primary" : "Backup"}
                </span>
                last checked in {fmt(d.last_seen_at)} · last run {fmt(d.last_run_at)}
                {d.last_run_summary ? ` (${d.last_run_summary})` : ""}
              </span>
              <span className="inline-flex items-center gap-3">
                {!d.is_primary && (
                  <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => void makePrimary(d.id)} type="button">
                    Make primary
                  </button>
                )}
                <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => void newCode(d.id)} type="button">
                  New code
                </button>
                <button className="text-sm font-semibold text-red-700" onClick={() => void revokeDevice(d.id)} type="button">
                  Revoke
                </button>
              </span>
            </div>
          ))
        )}
        {message && <p className="text-sm font-semibold text-red-700">{message}</p>}
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
        <p className="font-semibold">How it works</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
          <li>
            On each run day at {hourLabel(settings.sendHour)}, the primary device (iPhone or Mac) asks NoteGoat for
            tomorrow&apos;s list and sends each text from Messages, a little apart.
          </li>
          <li>Run days: {runDays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "none"}. A closed day in Key Dates is skipped.</li>
          <li>Skipped: canceled and no-show visits, patients marked &quot;no text reminders&quot;, and patients with no phone.</li>
          <li>One text per patient per day, and never the same reminder twice.</li>
          <li>
            Two devices? The primary sends first. The backup only sends what is still unsent 30 minutes later, and a
            device only sends reminders it has claimed, so nobody gets two texts.
          </li>
          <li>In dry run, devices only log what they would send. Turn dry run off when the log looks right.</li>
        </ul>
        <p className="mt-2 font-semibold">Two shortcuts on the iPhone</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
          <li><b>Send Reminders</b> runs by itself at {hourLabel(settings.sendHour)} and texts tomorrow&apos;s patients.</li>
          <li>
            <b>Send Reminders Now</b> is the backup. If the phone was off or dead, tap it: it sends <b>today&apos;s</b>{" "}
            reminders that never went out (only visits still ahead, worded &quot;today&quot;), plus tomorrow&apos;s if they&apos;re due.
            Anyone already texted is skipped.
          </li>
          <li>The iMac checks every 10 minutes on its own, so it needs no button.</li>
          <li>
            Replies of <b>STOP</b> are picked up automatically by the iMac (each check). On an iPhone-only office, add the{" "}
            <b>NoteGoat Opt-Out</b> shortcut and its automation (see &quot;Opt-out replies on the iPhone&quot; below).
          </li>
        </ul>
        <SendFromIphoneButton className="mt-2" />
      </div>

      <MessagePatientsComposer prefill={messagePrefill} settings={settings} workspaceId={workspaceId} />
      {confirmDialog}

      <details className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" data-testid="iphone-steps">
        <summary className="cursor-pointer font-semibold">iPhone setup (Shortcuts app)</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
          <li>Here in NoteGoat, click <b>+ Add iPhone</b>, then <b>Copy</b> the code (it starts with <Mono>ngr_</Mono> and is shown once). Text or AirDrop it to yourself so you can paste it on the iPhone.</li>
          <li>
            On the office iPhone, open this page and tap{" "}
            <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/Send-Reminders.shortcut" download>Get the shortcut</a>
            {" "}→ <b>Add Shortcut</b>, and paste your code when it asks. Then get{" "}
            <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/Send-Reminders-Now.shortcut" download>Send Reminders Now</a>
            {" "}(same steps), the backup for days the phone missed 8 AM. Long-press it → <b>Share</b> → <b>Add to Home Screen</b>.
          </li>
          <li>In Shortcuts, tap <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → <b>8:00 AM</b>, <b>Daily</b> → <b>Run Immediately</b> → <b>Send Reminders</b> → <b>Done</b>. The first run asks for permission; tap <b>Always Allow</b>.</li>
        </ol>
        <details className="mt-3 text-[var(--text-muted)]" data-testid="iphone-steps-manual">
          <summary className="cursor-pointer text-xs font-semibold">Build it by hand instead</summary>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
            <li>Here in NoteGoat, click <b>+ Add iPhone</b>, then <b>Copy</b> the code (it starts with <Mono>ngr_</Mono> and is shown once).</li>
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
              <Mono>?format=shortcut&amp;force=1</Mono>. Long-press → <b>Share</b> → <b>Add to Home Screen</b>. Duplicates are still blocked.
            </li>
            <li>
              Tap <b>Automation</b> (bottom) → <b>+</b> → <b>Time of Day</b>. Pick <b>8:00 AM</b>, <b>Daily</b>, choose <b>Run Immediately</b>, and turn <b>Notify When Run</b> off.
            </li>
            <li>Tap <b>Next</b> → <b>Run Shortcut</b> → pick <b>Send Reminders</b> → <b>Done</b>. It only sends on run days.</li>
          </ol>
        </details>
      </details>

      <details className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" data-testid="optout-iphone-steps">
        <summary className="cursor-pointer font-semibold">Opt-out replies on the iPhone (STOP)</summary>
        <p className="mt-2 text-[var(--text-muted)]">
          Only needed if the iPhone sends the texts. The iMac reads STOP replies on its own.
        </p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
          <li>
            On the office iPhone, tap{" "}
            <a className="font-semibold text-[var(--brand-primary)] underline" href="/shortcuts/NoteGoat-Opt-Out.shortcut" download>Get NoteGoat Opt-Out</a>
            {" "}→ <b>Add Shortcut</b>, and paste the same <Mono>ngr_</Mono> device code when it asks.
          </li>
          <li>In Shortcuts, tap <b>Automation</b> → <b>+</b> → <b>Message</b>.</li>
          <li>Tap <b>Message Contains</b>, type <Mono>STOP</Mono>, tap <b>Done</b>. Leave <b>Sender</b> empty (anyone).</li>
          <li>Choose <b>Run Immediately</b> and turn <b>Notify When Run</b> off. Tap <b>Next</b>.</li>
          <li>Pick <b>Run Shortcut</b> → <b>NoteGoat Opt-Out</b>. Tap the shortcut&apos;s <b>Input</b> and choose <b>Shortcut Input</b> (the message). Tap <b>Done</b>.</li>
          <li>Repeat steps 2–5 with <Mono>START</Mono> if you want patients to be able to opt back in.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Limits: iOS only runs this for messages whose text <i>contains</i> STOP; NoteGoat only acts when the whole reply is
          the keyword. If the patient is saved in the iPhone&apos;s Contacts, iOS may pass their contact name instead of the
          number, and NoteGoat can&apos;t match it; check &quot;Opted out by reply&quot; above, and mark them &quot;no text
          reminders&quot; by hand if needed. Words like UNSUBSCRIBE need their own automation.
        </p>
      </details>

      <details className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" data-testid="mac-steps">
        <summary className="cursor-pointer font-semibold">iMac setup (one click)</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
          <li>On the iMac, make sure <b>Messages</b> is signed in to the office Apple ID. Then here in NoteGoat click <b>+ Add Mac</b> and <b>Copy</b> the code (starts with <Mono>ngr_</Mono>, shown once).</li>
          <li>
            <a className="font-semibold text-[var(--brand-primary)] underline" data-testid="mac-setup-download" download href="/mac/NoteGoat-Reminders-Setup.command">Download iMac setup</a>
            . In <b>Downloads</b>, <b>right-click</b> the file → <b>Open</b> → <b>Open</b> (only the first time; a plain double-click may be blocked by macOS).
          </li>
          <li>Terminal opens and explains each step. Paste the code when asked, then type your <b>Mac password</b> when asked (it sets the iMac to wake at 8:45 AM). Nothing shows while typing; that&apos;s normal. When it says <b>All set</b>, press <b>Return</b>.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--text-muted)]">The first time it sends, macOS asks to let it control <b>Messages</b>; click <b>OK</b>. As backup the Mac waits 30 minutes for the primary and only sends what is still unsent.</p>
        <details className="mt-3 text-[var(--text-muted)]" data-testid="mac-steps-manual">
          <summary className="cursor-pointer text-xs font-semibold">Advanced: set up in Terminal by hand</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--text-muted)]">
          <li>On the iMac, open <b>Messages</b> and make sure it is signed in to the office Apple ID.</li>
          <li>Here in NoteGoat, click <b>+ Add Mac</b>, then <b>Copy</b> the code (starts with <Mono>ngr_</Mono>, shown once).</li>
          <li>Open <b>Terminal</b> (press <b>⌘ Space</b>, type <b>Terminal</b>, press <b>Return</b>).</li>
          <li>
            Paste this and press <b>Return</b> (it downloads the sender):
            <div className="mt-1">
              <Mono>{`mkdir -p ~/notegoat-reminders && cd ~/notegoat-reminders && RAW=https://raw.githubusercontent.com/mitqlabs/mynotegoat/main/tools/mac-reminders; curl -fsSLO $RAW/install.sh -O $RAW/notegoat-reminders.sh -O $RAW/uninstall.sh`}</Mono>
            </div>
          </li>
          <li>Paste <Mono>bash install.sh</Mono> and press <b>Return</b>.</li>
          <li>When it asks, paste the code and press <b>Return</b> (nothing shows while pasting; that&apos;s normal). It saves the code in the Keychain and tests the connection.</li>
          <li>The first time it sends, macOS asks to let it control <b>Messages</b>. Click <b>OK</b>.</li>
          <li>
            Done. The Mac checks every 10 minutes between 8 AM and 6 PM. As backup it waits 30 minutes for the primary and only sends what is still unsent.
          </li>
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
          <li>Made a <b>New code</b>? Run step 5 again and paste the new code. To remove: <Mono>bash ~/notegoat-reminders/uninstall.sh</Mono>, then <b>Revoke</b> the device here.</li>
        </ol>
        </details>
      </details>

      <div className="grid gap-1">
        <div className="flex items-center justify-between">
          <span className={label}>Recent sends</span>
          <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </div>
        {log.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing sent yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-[var(--text-muted)]">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Visit date</th>
                <th className="py-1 pr-3">Phone</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                  <td className="py-1 pr-3">{fmt(row.created_at)}</td>
                  <td className="py-1 pr-3">{row.visit_date}</td>
                  <td className="py-1 pr-3">•••{row.phone_last4}</td>
                  <td className="py-1">
                    {row.status}
                    {row.error ? ` — ${row.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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

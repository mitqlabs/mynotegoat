"use client";

/**
 * Settings → Text Reminders. Automatic day-before appointment texts sent
 * from the office Mac. Settings live in casemate.sms-reminders.v1
 * (localStorage + workspace_kv); devices and the send log live in Supabase.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { DraftTextarea } from "@/components/draft-textarea";
import { markLocalWrite } from "@/lib/local-sync";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { createSmsTemplate, DEFAULT_REMINDER_BODY, SMS_TOKENS } from "@/lib/sms-templates";
import {
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
} from "@/lib/reminder-automation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { patients as patientDirectory } from "@/lib/mock-data";

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

  const workspaceId = typeof window === "undefined" ? "" : getActiveWorkspaceIdSync();
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
  }, [workspaceId]);

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
    const name = window.prompt("Name this device", kind === "iphone" ? "Office iPhone" : "Office iMac")?.trim();
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
    if (!window.confirm("Revoke this device? It will stop sending immediately.")) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.from("reminder_devices").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) setMessage(`Couldn't revoke: ${error.message}`);
    void refresh();
  };

  const newCode = async (id: string) => {
    if (!window.confirm("Make a new code for this device? The old code stops working; update it in the Shortcut.")) return;
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

  const sendNow = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const active = devices.filter((d) => !d.revoked_at);
    if (!active.length) return setMessage("Add a device first.");
    if (!window.confirm("Send tomorrow's reminders now? Anyone already texted is skipped.")) return;
    const until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await client
      .from("reminder_devices")
      .update({ run_requested_until: until })
      .in("id", active.map((d) => d.id));
    setMessage(
      error
        ? `Couldn't request a run: ${error.message}`
        : "Requested for the next 2 hours. On the iPhone, tap the \"Send Reminders Now\" shortcut; the Mac checks every 10 minutes (as backup it waits 30 minutes for the primary).",
    );
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
            {preview}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={label}>Sending devices</span>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} data-testid="send-now" onClick={() => void sendNow()} type="button">
              Send Reminders Now
            </button>
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
                {d.run_requested_until && new Date(d.run_requested_until) > new Date() ? " · Send Now requested" : ""} · last checked in {fmt(d.last_seen_at)} · last run {fmt(d.last_run_at)}
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
          <li>In dry run, devices only log what it would send. Turn dry run off when the log looks right.</li>
        </ul>
      </div>

      <details className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" data-testid="iphone-steps">
        <summary className="cursor-pointer font-semibold">iPhone setup (Shortcuts app)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
          <li>Click <b>+ Add iPhone</b> and copy the token (shown once).</li>
          <li>On the office iPhone: <b>Shortcuts</b> → <b>+</b> → name it <b>Send Reminders</b>.</li>
          <li>
            <b>Get Contents of URL</b>: <code>{origin}/api/reminders/queue?format=shortcut</code> → Show More → Method GET →
            Headers: <code>Authorization</code> = <code>Bearer YOUR-TOKEN</code>.
          </li>
          <li>
            <b>Get Dictionary Value</b> <code>visitDate</code> → <b>Set Variable</b> VisitDate. Then{" "}
            <b>Get Dictionary Value</b> <code>items</code> from Contents of URL.
          </li>
          <li>
            <b>Repeat with Each</b> item. Inside: <b>Get Dictionary Value</b> <code>text</code> (Repeat Item) →{" "}
            <b>Send Message</b> with that text to <b>Get Dictionary Value</b> <code>phone</code>; tap ⌄ and turn{" "}
            <b>Show When Run</b> OFF. Then <b>Get Contents of URL</b> <code>{origin}/api/reminders/ack</code>, Method POST,
            same header, Request Body JSON: <code>visitDate</code> = VisitDate, <code>id</code> = Repeat Item&apos;s{" "}
            <code>id</code>, <code>status</code> = <code>sent</code>. Then <b>Wait</b> 5 seconds.
          </li>
          <li>Optional: after the repeat, <b>Get Dictionary Value</b> <code>message</code> → <b>Show Notification</b>.</li>
          <li>Run it once by hand and choose <b>Always Allow</b> for mynotegoat.com and Messages.</li>
          <li>
            Duplicate it as <b>Send Reminders Now</b>, change the URL to end in{" "}
            <code>?format=shortcut&amp;force=1</code>, and Add to Home Screen. Duplicates are still blocked.
          </li>
          <li>
            <b>Automation</b> → <b>+</b> → <b>Time of Day</b> 8:00 AM, Daily → <b>Run Immediately</b>, Notify When Run off
            → <b>Run Shortcut</b> “Send Reminders”. It only sends on run days.
          </li>
        </ol>
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

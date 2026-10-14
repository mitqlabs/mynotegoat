"use client";

/**
 * Settings → Text Reminders. Automatic day-before appointment texts sent
 * from the office Mac. Settings live in casemate.sms-reminders.v1
 * (localStorage + workspace_kv); devices and the send log live in Supabase.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { createSmsTemplate, SMS_TOKENS } from "@/lib/sms-templates";
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
  window.localStorage.setItem(SMS_REMINDER_SETTINGS_KEY, JSON.stringify(next));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(SMS_REMINDER_SETTINGS_KEY, "tasks", next));
}

type DeviceRow = {
  id: string;
  name: string;
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

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const [{ data: d }, { data: l }] = await Promise.all([
      client
        .from("reminder_devices")
        .select("id, name, created_at, last_seen_at, last_run_at, last_run_summary, revoked_at")
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

  const addDevice = async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return setMessage("Sign in to add a device.");
    const name = window.prompt("Name this device", "Office iMac")?.trim();
    if (!name) return;
    const token = generateDeviceToken();
    const { error } = await client
      .from("reminder_devices")
      .insert({ workspace_id: workspaceId, name, token_hash: await hashDeviceToken(token) });
    if (error) return setMessage(`Couldn't add the device: ${error.message}`);
    setNewToken(token);
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
                  "Hi {{FIRST_NAME}}, reminder of your appointment tomorrow at {{TIME}} with {{OFFICE_NAME}}. Questions? Call {{OFFICE_PHONE}}.",
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
          <textarea
            className="min-h-[90px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(e) => {
              const body = e.target.value;
              updateSmsTemplates((current) =>
                current.map((t) => (t.id === template.id ? { ...t, body, updatedAt: new Date().toISOString() } : t)),
              );
            }}
            value={template.body}
          />
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Tokens: {SMS_TOKENS.map((t) => t.token).join(" ")}. Keep it short; no diagnoses or visit details.
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
          <span className={label}>Sending Mac</span>
          <button className={btn} onClick={() => void addDevice()} type="button">
            + Add device
          </button>
        </div>
        {newToken && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <p className="font-semibold">Device token (shown once; paste it into the Mac setup):</p>
            <code className="break-all">{newToken}</code>
          </div>
        )}
        {activeDevices.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No device connected yet.</p>
        ) : (
          activeDevices.map((d) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm" key={d.id}>
              <span>
                <span className="font-semibold">{d.name}</span> · last checked in {fmt(d.last_seen_at)} · last run {fmt(d.last_run_at)}
                {d.last_run_summary ? ` (${d.last_run_summary})` : ""}
              </span>
              <button className="text-sm font-semibold text-red-700" onClick={() => void revokeDevice(d.id)} type="button">
                Revoke
              </button>
            </div>
          ))
        )}
        {message && <p className="text-sm font-semibold text-red-700">{message}</p>}
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
        <p className="font-semibold">How it works</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
          <li>
            On each run day at {hourLabel(settings.sendHour)}, your office Mac asks NoteGoat for tomorrow&apos;s list and
            sends each text from its Messages app, a little apart.
          </li>
          <li>Run days: {runDays.map((d) => WEEKDAY_SHORT[d]).join(", ") || "none"}. A closed day in Key Dates is skipped.</li>
          <li>Skipped: canceled and no-show visits, patients marked &quot;no text reminders&quot;, and patients with no phone.</li>
          <li>One text per patient per day, and never the same reminder twice.</li>
          <li>In dry run, the Mac only logs what it would send. Turn dry run off when the log looks right.</li>
        </ul>
      </div>

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

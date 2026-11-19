"use client";

/**
 * Settings → Text Reminders. Automatic day-before appointment texts sent
 * from the office Mac. Settings live in casemate.sms-reminders.v1
 * (this browser + the cloud copy); devices and the send log live in Supabase.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import { markLocalWrite } from "@/lib/local-sync";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { planAutoTextMigration } from "@/lib/message-library";
import { legacyRules, withRules } from "@/lib/text-rules";
import { TextRuleWizard } from "@/components/text-rule-wizard";
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
  localNow,
  optOutHowLabel,
  phoneMatchKey,
  searchPatientsToOptOut,
  WEEKDAY_SHORT,
} from "@/lib/reminder-automation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useSimpleConfirm } from "@/components/fill-confirm-dialog";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { patients as patientDirectory } from "@/lib/mock-data";
import { appConfirm, appPrompt } from "@/components/app-dialog";
import { MessagePatientsComposer, SendFromIphoneButton, type MessagePatientsPrefill } from "@/components/message-patients-composer";
import { AutomationWarning } from "@/components/reminder-setup-checklist";
import { InnerFold, SetupCard } from "@/components/setup-card";
import { CollapsibleSection } from "@/components/collapsible-section";
import { birthdayLogLabel } from "@/lib/birthday-texts";
import { lastRunRejectedText } from "@/lib/device-token";
import { devicesStatus, fmtDate, plainResult, senderRole, fmtDateTime, imacStatus, iphoneStatus, lastCheckedText, lastRunText, officeMacSeen, optOutSummary, optedOutSummary, sectionOpen, type ReminderSection } from "@/lib/reminder-format";
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
  last_rejected_at: string | null;
  last_rejected_reason: string | null;
  revoked_at: string | null;
};
type OptOutRow = { patientId: string; name: string; at: string; phoneLast4: string; source: string };
type PatientPick = { id: string; fullName: string; phone: string; textRemindersOff?: boolean; deleted?: boolean };
type BirthdayLogRow = { id: string; year: number; phone_last4: string; status: string; error: string | null; claimed_at: string | null; created_at: string };
type LogRow = { id: number; visit_date: string; phone_last4: string; status: string; error: string | null; created_at: string };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 text-[var(--text-main)]";
const rowBtn = "rounded-lg border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 py-1.5 text-sm font-semibold text-[var(--text-main)]";

export function TextRemindersSettingsPanel() {
  const { smsTemplates, updateSmsTemplates } = useSmsTemplates();
  const { scheduleSettings } = useScheduleSettings();
  const { scheduleAppointments } = useScheduleAppointments();
  const [settings, setSettings] = useState<SmsReminderSettings>(() => loadSettings());
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  // Send history over the last two weeks (times + visit dates only), for the "8 AM automation may not be set up" check.
  const [history, setHistory] = useState<{ createdAt: string; visitDate: string }[]>([]);
  const [newToken, setNewToken] = useState("");
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenKind, setNewTokenKind] = useState<"mac" | "iphone">("iphone");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [optOuts, setOptOuts] = useState<OptOutRow[]>([]);
  const [optOutQuery, setOptOutQuery] = useState("");
  const [birthdayLog, setBirthdayLog] = useState<BirthdayLogRow[]>([]);
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
  // One-time tidy-up for offices that set up texts before Messages existed: attach the wording they
  // already use (and save it as a message if needed). Waits a moment so the cloud copy arrives first;
  // never switches anything on or off. Same ids on every computer, so two computers do not make two copies.
  const attachRef = useRef({ settings, templates: smsTemplates });
  attachRef.current = { settings, templates: smsTemplates };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { settings: s, templates } = attachRef.current;
      const plan = planAutoTextMigration(s, templates, new Date().toISOString());
      let next = s;
      if (plan) {
        if (plan.addMessages.length) updateSmsTemplates((current) => [...current.filter((m) => !plan.addMessages.some((a) => a.id === m.id)), ...plan.addMessages]);
        next = { ...s, ...plan.settingsPatch };
      }
      if (next.rules == null) next = withRules(next, legacyRules(next));
      if (next !== s) update(next);
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const [{ data: d }, { data: l }] = await Promise.all([
      client
        .from("reminder_devices")
        .select("id, name, kind, is_primary, run_requested_until, created_at, last_seen_at, last_run_at, last_run_summary, last_rejected_at, last_rejected_reason, revoked_at")
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
    const since = new Date(Date.now() - (AUTO_RUN_LOOKBACK_DAYS + 2) * 86_400_000).toISOString();
    const { data: h } = await client
      .from("reminder_log")
      .select("created_at, visit_date")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    setHistory(((h as { created_at: string; visit_date: string }[] | null) ?? []).map((r) => ({ createdAt: r.created_at, visitDate: r.visit_date })));
    // Recent birthday texts (last 4 digits only). Missing table = nothing yet.
    const { data: bd } = await client
      .from("birthday_text_log")
      .select("id, year, phone_last4, status, error, claimed_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(30);
    setBirthdayLog((bd as BirthdayLogRow[] | null) ?? []);
    // Everyone with texts turned off, plus the newest STOP row that says how.
    const [{ data: flagged }, { data: o }] = await Promise.all([
      client.from("patients").select("id, full_name, phone").eq("workspace_id", workspaceId).eq("text_reminders_off", true).limit(300),
      client.from("reminder_opt_outs").select("patient_id, action, phone_last4, source, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    ]);
    const latest = new Map<string, { at: string; phoneLast4: string; source: string }>();
    for (const r of (o as { patient_id: string; action: string; phone_last4: string; source: string; created_at: string }[] | null) ?? []) {
      if (!r.patient_id || r.patient_id === "test" || r.patient_id.startsWith("unmatched:")) continue;
      if (r.action !== "stop" || latest.has(r.patient_id)) continue;
      latest.set(r.patient_id, { at: r.created_at, phoneLast4: r.phone_last4, source: r.source });
    }
    setOptOuts(
      ((flagged as { id: string; full_name: string | null; phone: string | null }[] | null) ?? []).map((p) => {
        const log = latest.get(p.id);
        const digits = String(p.phone ?? "").replace(/\D/g, "");
        return {
          patientId: p.id,
          name: p.full_name || "Unknown patient",
          at: log?.at ?? "",
          phoneLast4: log?.phoneLast4 || digits.slice(-4),
          source: log?.source ?? "staff",
        };
      }),
    );
  }, [workspaceId]);

  const reEnable = async (row: OptOutRow) => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const ok = await ask({
      title: `Turn text reminders back on for ${row.name}?`,
      lines: ["Only do this if they asked to get texts again."],
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

  const addOptOut = async (patient: PatientPick) => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const { error } = await client.from("patients").update({ text_reminders_off: true }).eq("workspace_id", workspaceId).eq("id", patient.id);
    if (error) return setMessage("Couldn't turn texts off. Try again.");
    const { error: logError } = await client.from("reminder_opt_outs").insert({
      workspace_id: workspaceId,
      patient_id: patient.id,
      action: "stop",
      source: "staff",
      phone_last4: phoneMatchKey(patient.phone).slice(-4),
    });
    setOptOutQuery("");
    if (logError) setMessage("Texts are off. The office list of who added them did not save.");
    await refresh();
  };

  const optOutMatches = searchPatientsToOptOut(patientDirectory, optOutQuery);

  useEffect(() => {
    // Async fetch on mount; state is set after the network round trip.
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
    if (!(await appConfirm("Get a new setup code for this sender? The code already on the device keeps working until this new one is used once.", { confirmLabel: "Get new setup code", cancelLabel: "Cancel" }))) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const token = generateDeviceToken();
    const { error } = await client
      .from("reminder_devices")
      .update({ pending_token_hash: await hashDeviceToken(token) })
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
    <div className="w-full min-w-0 max-w-full space-y-5" data-testid="text-reminders-panel">
      <AutomationWarning hasIphone={hasIphone} settings={settings} warning={missedAutoRuns} />

      <div data-testid="section-setup">
        <TextRuleWizard
          devices={devices}
          hasMac={activeDevices.some((d) => d.kind === "mac")}
          messages={smsTemplates}
          onChanged={() => void refresh()}
          onConfirm={confirmAutomation}
          settings={settings}
          update={update}
          workspaceId={workspaceId}
        >
      <div data-testid="section-phones">
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
        open={sectionOpen(settings.sections, "devices", false)}
        status={devicesCard.status}
        summary={devicesCard.summary}
        testId="section-devices"
        title="Phones and Macs"
      >
        {newToken && (
          <div className="grid gap-2 rounded-lg border border-[var(--brand-accent)] bg-[var(--bg-panel)] px-3 py-3 text-[var(--text-main)]" data-testid="new-device-token">
            <p className="font-semibold">Your new setup code for {newTokenName}. Copy it now. It will not be shown again.</p>
            <code className="select-all break-all rounded-md bg-[var(--bg-soft)] px-2 py-1.5 font-mono text-sm text-[var(--text-main)]">{newToken}</code>
            <p>
              <b>Do not share this setup code.</b> Anyone who has it can send texts as your office. Paste it into{" "}
              {newTokenKind === "mac" ? "the iMac setup" : "the iPhone setup"} below.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--on-brand)]"
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
                    {lastRunRejectedText(d) ? <p className="font-semibold text-[var(--text-main)]" data-testid="device-last-rejected">{lastRunRejectedText(d)}</p> : null}
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
                    <button className={rowBtn} onClick={() => void revokeDevice(d.id)} type="button">
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {message && <p className="font-semibold text-[var(--text-main)]">{message}</p>}
      </SetupCard>
      </div>
        </TextRuleWizard>
      </div>

      <CollapsibleSection
        onToggle={(next) => setSection("more", next)}
        open={sectionOpen(settings.sections, "more", false)}
        testId="section-more"
        title="More"
      >
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
            <b>NoteGoat</b> on the iPhone texts 5 patients, then asks for the next 5. It also catches a reply of STOP. It runs at each time in the steps, and once more an hour after the last one. That later run sends anything still waiting.
          </li>
          <li>
            <b>Send Reminders Now</b> (Device shortcut) is the backup. Use it if the device was off or dead. It sends today&apos;s missed
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
        </div>

        <InnerFold testId="optout-iphone-steps" title="STOP replies">
          <p>The same NoteGoat shortcut catches STOP. Follow the steps at the top. You do not add a second shortcut.</p>
        </InnerFold>
      </SetupCard>

      <SetupCard
        onToggle={(next) => setSection("iphone", next)}
        open={sectionOpen(settings.sections, "iphone", false)}
        status={iphoneCard.status}
        summary={iphoneCard.summary}
        testId="section-iphone"
        title="Device setup (Shortcuts app)"
      >
        <div className="space-y-3" data-testid="iphone-steps">
          <p>Use the steps at the top of this page. One shortcut, named <b>NoteGoat</b>, sends the texts and catches STOP.</p>
        </div>
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
      <p className="text-sm">
        <button
          className="font-semibold text-[var(--brand-primary)] underline"
          data-testid="edit-messages-link"
          onClick={() => window.dispatchEvent(new Event("notegoat:open-sms-templates"))}
          type="button"
        >
          Edit messages in SMS / Text Templates
        </button>
      </p>

      <div className="flex flex-wrap items-end gap-4">
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
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--on-brand)]"
                  : "border-[var(--line-soft)] bg-[var(--bg-panel)] text-[var(--text-main)]"
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

      <details className="text-sm" data-testid="birthday-how">
        <summary className="cursor-pointer font-semibold text-[var(--brand-primary)]">How birthday texts work</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[var(--text-muted)]">
          <li>It goes out with the {hourLabel(settings.sendHour)} reminders, from the same iPhone shortcut or iMac. There is nothing new to set up on the phone.</li>
          <li>Every patient with a date of birth and a phone number gets one, whatever their case status, on the day of their birthday (Feb 29 birthdays get it on Feb 28 in years with no Feb 29).</li>
          <li>Never patients marked &quot;no text reminders&quot; or who replied STOP. Each patient gets at most one birthday text a year.</li>
          <li>If the phone fetches a birthday text and does not send it, the same day is tried again the next time Send Reminders runs. A birthday from an earlier day is not sent late.</li>
          <li>Test mode applies here too: nothing is texted, it only shows below what would have gone out.</li>
        </ul>
      </details>
          {birthdayLog.some((row) => birthdayLogLabel(row.status, row.error, row.claimed_at, localNow(new Date(), settings.timeZone).iso, settings.timeZone) === "Not sent (too late)") ? (
            <p className="text-sm font-semibold text-[var(--text-main)]" data-testid="birthday-late">
              Some birthday texts were not sent (too late).
            </p>
          ) : null}
          <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-panel)] text-[var(--text-main)]" data-testid="birthday-log">
            <summary className="cursor-pointer px-3 py-2 font-semibold">Recent birthday texts</summary>
            {birthdayLog.length === 0 ? (
              <p className="px-3 py-2 text-[var(--text-muted)]">None yet.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="text-left text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-1">When</th>
                    <th className="px-3 py-1">Phone ending</th>
                    <th className="px-3 py-1">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {birthdayLog.map((row) => (
                    <tr className="border-t border-[var(--line-soft)]" key={row.id}>
                      <td className="px-3 py-1">{fmtDateTime(row.created_at, settings.timeZone)}</td>
                      <td className="px-3 py-1">{row.phone_last4}</td>
                      <td className="px-3 py-1">
                        {birthdayLogLabel(row.status, row.error, row.claimed_at, localNow(new Date(), settings.timeZone).iso, settings.timeZone)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
      </CollapsibleSection>


      <CollapsibleSection
        hint="Send one text to many patients, plus recent sends."
        onToggle={(next) => setSection("texts", next)}
        open={sectionOpen(settings.sections, "texts", true)}
        testId="section-texts"
        title="Broadcast"
      >
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

      <CollapsibleSection
        hint={optedOutSummary(optOuts.length)}
        onToggle={(next) => setSection("optedout", next)}
        open={sectionOpen(settings.sections, "optedout", true)}
        testId="section-opted-out"
        title="Opted out"
      >
        <div className="grid gap-3" data-testid="opt-out-list">
          <input
            aria-label="Add patient"
            className="h-[42px] w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 text-[var(--text-main)]"
            onChange={(e) => setOptOutQuery(e.target.value)}
            placeholder="Add patient"
            value={optOutQuery}
          />
          {optOutMatches.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-[var(--line-soft)]">
              {optOutMatches.map((patient) => (
                <li className="border-t border-[var(--line-soft)] first:border-t-0" key={patient.id}>
                  <button className="w-full px-3 py-2 text-left font-semibold text-[var(--text-main)]" onClick={() => void addOptOut(patient)} type="button">
                    {patient.fullName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {optOuts.length === 0 ? (
            <p className="text-[var(--text-muted)]">Nobody yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)]">
              {optOuts.map((row) => (
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" key={row.patientId}>
                  <span>
                    <span className="font-semibold text-[var(--text-main)]">{row.name}</span>{" "}
                    <span className="text-[var(--text-muted)]">
                      · {optOutHowLabel(row.source)}
                      {row.at ? ` · ${fmtDateTime(row.at, settings.timeZone)}` : ""}
                    </span>
                  </span>
                  <button className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--text-main)]" onClick={() => void reEnable(row)} type="button">
                    Turn texts back on
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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

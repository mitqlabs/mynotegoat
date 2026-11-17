"use client";

/**
 * Settings → Text Reminders: one list for the office iPhone.
 * The phone does not start by itself until these steps are done.
 */

import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtDay } from "@/lib/reminder-format";
import { catchUpClockLabels, generateDeviceToken, hashDeviceToken, STOP_TEST_PATIENT_ID, UNMATCHED_PREFIX } from "@/lib/reminder-automation";
import { iphoneSetupSteps, setupTestReport, type SetupReport } from "@/lib/iphone-setup";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import { SetupCard } from "@/components/setup-card";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;
const TEST_URL = "shortcuts://run-shortcut?name=NoteGoat&input=STOP%20TEST";

function onThisIphone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function StepWords({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return (
    <p className="font-semibold">
      {parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>))}
    </p>
  );
}

/** The red "may not be set up" notice. Shown at the top of the page even when Set up is collapsed. */
export function AutomationWarning({
  settings,
  warning,
  hasIphone,
}: {
  settings: SmsReminderSettings;
  /** Dates (YYYY-MM-DD) of recent run days with no automatic send; empty = no warning. */
  warning: string[];
  hasIphone: boolean;
}) {
  const time = hourLabel(settings.sendHour);
  if (!warning.length || !hasIphone) return null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm" data-testid="automation-warning" role="alert">
      <p className="font-bold text-red-800">Your {time} run may not be set up — see the iPhone steps</p>
      <p className="mt-1 text-red-900">
        Reminders were due on {warning.slice(0, 2).map((d) => fmtDate(d)).join(" and ")}, but the phone didn&apos;t send
        them by itself around {time}.
        {settings.automationConfirmed
          ? " Open Shortcuts, tap Automation, and make sure each one says Run Immediately."
          : " Do the iPhone steps below."}
      </p>
    </div>
  );
}

export function ReminderSetupChecklist({
  settings,
  onConfirm,
  open,
  onToggle,
  workspaceId,
  devices,
  onChanged,
}: {
  settings: SmsReminderSettings;
  onConfirm: (confirmed: boolean) => void;
  open: boolean;
  onToggle: (next: boolean) => void;
  workspaceId: string;
  devices: { id: string; kind: string | null; revoked_at: string | null; last_seen_at: string | null }[];
  onChanged?: () => void;
}) {
  const [atSend] = catchUpClockLabels(settings.sendHour);
  const steps = iphoneSetupSteps(settings.sendHour);
  const confirmedOn = fmtDay(settings.automationConfirmedAt, settings.timeZone);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const confirmRef = useRef(onConfirm);
  const confirmedRef = useRef(settings.automationConfirmed);
  const loadRef = useRef<() => void>(() => {});
  const [stopReportAt, setStopReportAt] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState(0);
  const iphone = devices.find((d) => !d.revoked_at && d.kind === "iphone");
  const report: SetupReport = setupTestReport({
    stopReportAt,
    lastSeenAt: iphone?.last_seen_at ?? null,
    unmatched,
    timeZone: settings.timeZone,
    sendHour: settings.sendHour,
  });

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const client = getSupabaseBrowserClient();
      const id = getActiveWorkspaceIdSync();
      if (!client || !id) return;
      const { data } = await client
        .from("reminder_opt_outs")
        .select("patient_id, action, created_at")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancel) return;
      const rows = (data ?? []) as { patient_id: string; action: string; created_at: string }[];
      const reports = rows.filter(
        (row) =>
          row.patient_id === STOP_TEST_PATIENT_ID ||
          (row.action === "stop" && !row.patient_id.startsWith(UNMATCHED_PREFIX) && row.patient_id !== STOP_TEST_PATIENT_ID),
      );
      const at = reports[0]?.created_at ?? null;
      setStopReportAt(at);
      setUnmatched(rows.filter((row) => row.patient_id.startsWith(UNMATCHED_PREFIX)).length);
      if (at && !confirmedRef.current) {
        confirmedRef.current = true;
        confirmRef.current(true);
      }
    };
    loadRef.current = () => void load();
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancel = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const addToThisIphone = async () => {
    setNote("");
    if (!onThisIphone()) {
      setNote("Open this page on the office iPhone, then tap Add to this iPhone.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) {
      setNote("Sign in on this iPhone first.");
      return;
    }
    setBusy("add");
    const token = generateDeviceToken();
    const tokenHash = await hashDeviceToken(token);
    const existing = devices.find((d) => !d.revoked_at && d.kind === "iphone");
    const error = existing
      ? (await client.from("reminder_devices").update({ token_hash: tokenHash }).eq("id", existing.id)).error
      : (
          await client.from("reminder_devices").insert({
            workspace_id: workspaceId,
            name: "Office iPhone",
            kind: "iphone",
            is_primary: true,
            token_hash: tokenHash,
          })
        ).error;
    if (!error && !existing) {
      const others = devices.filter((d) => !d.revoked_at).map((d) => d.id);
      if (others.length) await client.from("reminder_devices").update({ is_primary: false }).in("id", others);
    }
    if (error) {
      setBusy("");
      setNote("Couldn't add the iPhone. Try again.");
      return;
    }
    onChanged?.();
    const { data: session } = await client.auth.getSession();
    const access = session.session?.access_token ?? "";
    const res = await fetch("/api/reminders/shortcut", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as { importUrl?: string; error?: string };
    setBusy("");
    if (!res.ok || !body.importUrl) {
      setNote(body.error || "Couldn't open the shortcut. Try again.");
      return;
    }
    window.location.href = body.importUrl;
  };

  const runTest = async () => {
    setNote("");
    if (!onThisIphone()) {
      setNote("Open this page on the office iPhone and tap Test.");
      await loadReports();
      return;
    }
    window.location.href = TEST_URL;
    window.setTimeout(() => loadRef.current(), 4000);
  };

  return (
    <SetupCard
      onToggle={onToggle}
      open={open}
      status={report.ok ? "done" : "todo"}
      summary={report.ok ? `STOP catcher working${confirmedOn ? ` · checked ${confirmedOn}` : ""}.` : `The iPhone does not start by itself. Follow these steps once.`}
      testId="reminder-setup-checklist"
      title={`iPhone texts at ${atSend}`}
    >
      <ol className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)]" data-testid="iphone-setup-steps">
        {steps.map((step, index) => (
          <li className="flex items-start gap-3 px-3 py-3" key={step.text}>
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center text-lg">{step.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--text-muted)]">Step {index + 1}</p>
              <StepWords text={step.text} />
              {index === 0 && (
                <button
                  className="mt-2 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                  data-testid="add-to-iphone"
                  disabled={busy === "add"}
                  onClick={() => void addToThisIphone()}
                  type="button"
                >
                  {busy === "add" ? "Opening…" : "Add to this iPhone"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button
        className={`w-full rounded-xl px-4 py-4 text-left text-base font-bold ${report.ok ? "bg-emerald-600 text-white" : "bg-[var(--brand-primary)] text-white"}`}
        data-testid="iphone-setup-test"
        onClick={() => void runTest()}
        type="button"
      >
        <span className="block">{report.ok ? report.title : "Test"}</span>
        <span className="mt-1 block text-sm font-semibold opacity-95">{report.fix}</span>
      </button>
      {note ? <p className="text-sm font-semibold text-red-800">{note}</p> : null}
    </SetupCard>
  );
}

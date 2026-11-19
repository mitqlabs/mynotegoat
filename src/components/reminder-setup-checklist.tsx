"use client";

/**
 * Settings → Text Reminders: one list for the office iPhone.
 * The phone does not start by itself until these steps are done.
 */

import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtDay } from "@/lib/reminder-format";
import { catchUpClockLabels, generateDeviceToken, hashDeviceToken, STOP_TEST_PATIENT_ID, UNMATCHED_PREFIX } from "@/lib/reminder-automation";
import { deviceSetupSteps, readSetupPlatform, setupTestReport, type SetupPlatform, type SetupReport, type SetupStep } from "@/lib/iphone-setup";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import { SetupCard } from "@/components/setup-card";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;
const TEST_URL = "shortcuts://run-shortcut?name=NoteGoat&input=STOP%20TEST";

function thisPlatform(): SetupPlatform {
  if (typeof navigator === "undefined") return "other";
  return readSetupPlatform(navigator.userAgent, navigator.maxTouchPoints);
}

function StepWords({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>))}
    </>
  );
}

function StepLines({ lines }: { lines: string[] }) {
  return (
    <div className="grid gap-4">
      {lines.map((line, index) => (
        <p className="text-lg font-semibold leading-relaxed text-[var(--text-main)]" key={`${index}-${line}`}>
          <StepWords text={line} />
        </p>
      ))}
    </div>
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
    <div className="rounded-xl border border-[var(--brand-accent)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text-main)]" data-testid="automation-warning" role="alert">
      <p className="font-bold">Your {time} run may not be set up — see the device steps</p>
      <p className="mt-1 text-[var(--text-muted)]">
        Reminders were due on {warning.slice(0, 2).map((d) => fmtDate(d)).join(" and ")}, but the device didn&apos;t send
        them by itself around {time}.
        {settings.automationConfirmed
          ? " Open Shortcuts, open Automation, and make sure each one says Run Immediately."
          : " Do the device steps below."}
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
  steps: stepsOverride,
  clocks = [],
  embedded = false,
  hasMac = false,
}: {
  settings: SmsReminderSettings;
  onConfirm: (confirmed: boolean) => void;
  open: boolean;
  onToggle: (next: boolean) => void;
  workspaceId: string;
  devices: { id: string; kind: string | null; revoked_at: string | null; last_seen_at: string | null }[];
  onChanged?: () => void;
  /** Times computed from the saved texts. Omit to use the older fixed list. */
  steps?: SetupStep[];
  /** Saved send times. Mac and iPhone each get their own steps from these. */
  clocks?: { hour: number; minute: number }[];
  /** Sit on the page with no extra card around it. */
  embedded?: boolean;
  hasMac?: boolean;
}) {
  const [atSend] = catchUpClockLabels(settings.sendHour);
  const [platform, setPlatform] = useState<SetupPlatform>("iphone");
  const [fileUrl, setFileUrl] = useState("");
  useEffect(() => {
    setPlatform(thisPlatform());
  }, []);
  const steps = clocks.length
    ? deviceSetupSteps(platform, clocks)
    : (stepsOverride ?? deviceSetupSteps(platform, [{ hour: settings.sendHour, minute: 0 }]));
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

  const addToThisDevice = async () => {
    setNote("");
    const here = thisPlatform();
    if (here === "other") {
      setNote("Open this page on the office iPhone or Mac, then use Add to this Device.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) {
      setNote("Sign in on this device first.");
      return;
    }
    setBusy("add");
    const token = generateDeviceToken();
    const tokenHash = await hashDeviceToken(token);
    const kind = here === "mac" ? "mac" : "iphone";
    const existing = devices.find((d) => !d.revoked_at && d.kind === kind);
    const error = existing
      ? (await client.from("reminder_devices").update({ token_hash: tokenHash }).eq("id", existing.id)).error
      : (
          await client.from("reminder_devices").insert({
            workspace_id: workspaceId,
            name: kind === "mac" ? "Office iMac" : "Office iPhone",
            kind,
            is_primary: kind === "iphone" || !devices.some((d) => !d.revoked_at),
            token_hash: tokenHash,
          })
        ).error;
    if (!error && !existing && (kind === "iphone" || !devices.some((d) => !d.revoked_at))) {
      const others = devices.filter((d) => !d.revoked_at).map((d) => d.id);
      if (others.length) await client.from("reminder_devices").update({ is_primary: false }).in("id", others);
    }
    if (error) {
      setBusy("");
      setNote("Couldn't add the device. Try again.");
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
    const body = (await res.json().catch(() => ({}))) as { importUrl?: string; fileUrl?: string; error?: string };
    setBusy("");
    if (!res.ok || !body.importUrl) {
      setNote(body.error || "Couldn't open the shortcut. Try again.");
      return;
    }
    setFileUrl(body.fileUrl ?? "");
    window.location.href = body.importUrl;
  };

  const runTest = async () => {
    setNote("");
    if (thisPlatform() === "other") {
      setNote("Open this page on the office iPhone or Mac and use Test.");
      loadRef.current();
      return;
    }
    window.location.href = TEST_URL;
    window.setTimeout(() => loadRef.current(), 4000);
  };

  const body = (
    <>
      <ol className="grid gap-8" data-testid="iphone-setup-steps">
        {steps.map((step, index) => {
          const isAdd = index === 0;
          const isTest = index === steps.length - 1;
          return (
            <li className="flex items-start gap-3" key={`${index}-${step.text}`}>
              <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-2xl font-bold text-[var(--text-main)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                {isAdd ? (
                  <button
                    className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-4 text-lg font-bold text-[var(--on-brand)] disabled:opacity-60"
                    data-testid="add-to-iphone"
                    disabled={busy === "add"}
                    onClick={() => void addToThisDevice()}
                    type="button"
                  >
                    {busy === "add" ? "Opening…" : "Add to this Device"}
                  </button>
                ) : isTest ? (
                  <button
                    className={`w-full rounded-xl border px-4 py-4 text-left text-lg font-bold ${report.ok ? "border-[var(--brand-primary)] bg-[var(--bg-panel)] text-[var(--text-main)]" : "border-transparent bg-[var(--brand-primary)] text-[var(--on-brand)]"}`}
                    data-testid="iphone-setup-test"
                    onClick={() => void runTest()}
                    type="button"
                  >
                    <span className="block">{report.ok ? report.title : "Test"}</span>
                    {report.ok ? <span className="mt-1 block text-sm font-semibold">{report.fix}</span> : null}
                  </button>
                ) : (
                  <StepLines lines={step.lines?.length ? step.lines : [step.text]} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {platform === "mac" && fileUrl ? (
        <a className="text-lg font-bold text-[var(--brand-primary)] underline" data-testid="mac-shortcut-download" download="NoteGoat.shortcut" href={fileUrl}>
          Download NoteGoat.shortcut
        </a>
      ) : null}
      {hasMac && platform !== "mac" ? <p className="text-lg font-bold text-[var(--text-main)]">On the Mac, these go out by themselves.</p> : null}
      {note ? <p className="text-sm font-semibold text-[var(--text-main)]">{note}</p> : null}
    </>
  );

  if (embedded) return <div className="grid gap-4 text-[var(--text-main)]">{body}</div>;

  return (
    <SetupCard
      onToggle={onToggle}
      open={open}
      status={report.ok ? "done" : "todo"}
      summary={report.ok ? `STOP catcher working${confirmedOn ? ` · checked ${confirmedOn}` : ""}.` : "Follow these steps once."}
      testId="reminder-setup-checklist"
      title={`Device texts at ${atSend}`}
    >
      {body}
    </SetupCard>
  );
}

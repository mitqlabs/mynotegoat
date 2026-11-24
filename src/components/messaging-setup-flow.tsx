"use client";

/**
 * One guided setup for automatic Reminders and Messaging.
 * iPhone steps or Mac steps, one screen at a time.
 * Progress is written through the office text settings (cloud). Nothing is sent from here.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { generateDeviceToken, hashDeviceToken } from "@/lib/reminder-automation";
import { readSetupPlatform } from "@/lib/iphone-setup";
import {
  automationFallbackLines,
  automationGuideLines,
  buildMessagingSteps,
  deviceCheckIn,
  messagingSetupComplete,
  orderedRuleIds,
  resumeStepId,
  shortcutFollowLines,
  shortcutRunUrl,
  shortcutsAppLines,
  startOverLines,
  testFollowLines,
  testShortcutName,
  type CheckInDevice,
  type MessagingPlatform,
} from "@/lib/messaging-setup";
import type { SmsTemplate } from "@/lib/sms-template-core";
import type { SmsReminderSettings, TextRule, TextWhenKind } from "@/lib/sms-reminders";
import { clockWords, newRuleId, shortcutName, withRules } from "@/lib/text-rules";
import { lastRunText } from "@/lib/reminder-format";

const WHEN: { kind: TextWhenKind; label: string }[] = [
  { kind: "open-day", label: "Open business days at" },
  { kind: "birthday", label: "Birthdays at" },
  { kind: "hours-before", label: "24 hours before appointment" },
  { kind: "day-before", label: "Day before appointment at" },
];

const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const primary = "w-full rounded-xl bg-[var(--brand-primary)] px-4 py-4 text-lg font-bold text-[var(--on-brand)] disabled:opacity-60";
const choice = "w-full rounded-xl border-2 border-[var(--brand-primary)] bg-[var(--bg-panel)] px-4 py-8 text-2xl font-bold text-[var(--text-main)]";

export interface MessagingDevice {
  id: string;
  kind: string | null;
  revoked_at: string | null;
  last_seen_at?: string | null;
  last_run_at?: string | null;
  last_run_summary?: string | null;
}

export function MessagingSetupEntry({
  complete,
  onStart,
  href,
}: {
  complete: boolean;
  onStart?: (redo: boolean) => void;
  /** Used when this page cannot open the steps itself. */
  href?: string;
}) {
  const label = complete ? "Redo setup" : "Set up automatic Reminders and Messaging";
  const className = complete
    ? "text-base font-semibold text-[var(--brand-primary)] underline"
    : primary;
  const start = () => onStart?.(complete);
  if (!onStart && href) {
    const target = complete ? `${href}${href.includes("?") ? "&" : "?"}setup=redo` : `${href}${href.includes("?") ? "&" : "?"}setup=messaging`;
    return (
      <Link className={`inline-block text-center ${className}`} data-testid={complete ? "messaging-setup-redo" : "messaging-setup-start"} href={target}>
        {label}
      </Link>
    );
  }
  return (
    <button className={className} data-testid={complete ? "messaging-setup-redo" : "messaging-setup-start"} onClick={start} type="button">
      {label}
    </button>
  );
}

function StepWords({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : <span key={index}>{part}</span>))}
    </>
  );
}

function Lines({ lines, start = 1 }: { lines: string[]; start?: number }) {
  return (
    <>
      {lines.map((line, index) => (
        <li className="flex items-start gap-3" data-testid="messaging-line" key={`${index}-${line}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-lg font-bold text-[var(--text-main)]">
            {start + index}
          </span>
          <p className="pt-1 text-lg font-semibold leading-relaxed text-[var(--text-main)]">
            <StepWords text={line} />
          </p>
        </li>
      ))}
    </>
  );
}

function hourChoice(hour: number): string {
  return clockWords(hour);
}

export function MessagingSetupFlow({
  settings,
  update,
  devices,
  messages,
  workspaceId,
  onChanged,
  onClose,
  initialRedo = false,
  forced,
}: {
  settings: SmsReminderSettings;
  update: (patch: Partial<SmsReminderSettings>) => void;
  devices: MessagingDevice[];
  messages: SmsTemplate[];
  workspaceId: string;
  onChanged?: () => void;
  onClose: () => void;
  initialRedo?: boolean;
  /** Screenshot harness. No network, no saved progress. */
  forced?: { platform: MessagingPlatform; stepId: string; redo?: boolean; seen?: boolean; ruleIds?: string[] };
}) {
  const saved = settings.messagingSetup;
  const rules = settings.rules ?? [];
  const [platform, setPlatform] = useState<MessagingPlatform | "">(forced?.platform ?? saved.platform);
  const [redo, setRedo] = useState(forced?.redo ?? (initialRedo || saved.redo));
  const [ruleIds, setRuleIds] = useState<string[]>(forced?.ruleIds ?? saved.ruleIds);
  const [stepId, setStepId] = useState(forced?.stepId ?? "device");
  const [ready, setReady] = useState(Boolean(forced));
  const [adding, setAdding] = useState<null | "template" | "when">(null);
  const [templateId, setTemplateId] = useState("");
  const [kind, setKind] = useState<TextWhenKind | null>(null);
  const [hour, setHour] = useState(8);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [since, setSince] = useState(forced ? "" : saved.testSince);
  const [live, setLive] = useState<CheckInDevice[] | null>(null);

  const picked = orderedRuleIds(rules, forced?.ruleIds ?? ruleIds);
  const steps = buildMessagingSteps({ redo: forced?.redo ?? redo, ruleIds: picked });
  const index = Math.max(0, steps.findIndex((step) => step.id === (forced?.stepId ?? stepId)));
  const step = steps[index] ?? steps[0];

  useEffect(() => {
    if (forced || ready) return;
    const nextRedo = initialRedo || saved.redo;
    const list = buildMessagingSteps({ redo: nextRedo, ruleIds: orderedRuleIds(rules, saved.ruleIds) });
    setRedo(nextRedo);
    setPlatform(saved.platform);
    setRuleIds(saved.ruleIds);
    setStepId(resumeStepId(list, initialRedo ? "device" : saved.step, initialRedo, saved.platform));
    setReady(true);
    // The saved step is read once, when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced, ready, initialRedo]);

  useEffect(() => {
    if (forced || !ready) return;
    const next = { platform, step: stepId, ruleIds: picked, checkedInAt: saved.checkedInAt, testSince: since || saved.testSince, redo };
    if (
      next.platform === saved.platform &&
      next.step === saved.step &&
      next.redo === saved.redo &&
      next.checkedInAt === saved.checkedInAt &&
      next.testSince === saved.testSince &&
      next.ruleIds.join(",") === saved.ruleIds.join(",")
    ) {
      return;
    }
    update({ messagingSetup: next });
    // picked is derived from ruleIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, stepId, redo, picked.join(","), ready, forced]);

  const check = forced?.seen
    ? { ok: true, at: "2026-11-18T16:02:00Z", summary: "2026-11-18: nothing to send" }
    : deviceCheckIn({
        devices: (live ?? devices).map((device) => ({
          kind: device.kind,
          revoked_at: device.revoked_at,
          last_seen_at: device.last_seen_at ?? null,
          last_run_at: device.last_run_at ?? null,
          last_run_summary: device.last_run_summary ?? null,
        })),
        platform: platform === "mac" ? "mac" : "iphone",
        since: since || saved.testSince || "9999",
      });

  useEffect(() => {
    if (forced || !check.ok || saved.checkedInAt) return;
    update({
      messagingSetup: { platform, step: stepId, ruleIds: picked, checkedInAt: check.at, testSince: since || saved.testSince, redo },
      automationConfirmed: true,
      automationConfirmedAt: check.at,
    });
    onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.ok, check.at, forced]);

  const pollRef = useRef({ forced: Boolean(forced), testing: false, since: "", workspaceId: "" });
  pollRef.current = {
    forced: Boolean(forced),
    testing: step.kind === "test" && Boolean(since),
    since,
    workspaceId,
  };
  useEffect(() => {
    let stop = false;
    const load = () => {
      const current = pollRef.current;
      if (current.forced || !current.testing || !current.since || !current.workspaceId) return;
      const client = getSupabaseBrowserClient();
      if (!client) return;
      void client
        .from("reminder_devices")
        .select("kind, revoked_at, last_seen_at, last_run_at, last_run_summary")
        .eq("workspace_id", current.workspaceId)
        .then(({ data }) => {
          if (!stop) setLive((data as CheckInDevice[] | null) ?? []);
        });
    };
    const timer = window.setInterval(load, 2000);
    window.addEventListener("focus", load);
    return () => {
      stop = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const go = (delta: number) => {
    const next = steps[index + delta];
    if (!next) {
      if (delta < 0) onClose();
      return;
    }
    setAdding(null);
    setNote("");
    setStepId(next.id);
  };

  const choose = (next: MessagingPlatform) => {
    setPlatform(next);
    setNote("");
    const list = buildMessagingSteps({ redo, ruleIds: picked });
    const at = list.findIndex((item) => item.id === "device");
    const following = list[at + 1];
    if (following) setStepId(following.id);
  };

  const hereMatches = () => {
    if (typeof navigator === "undefined" || (platform !== "iphone" && platform !== "mac")) return false;
    return readSetupPlatform(navigator.userAgent, navigator.maxTouchPoints) === platform;
  };

  const wrongDevice = () => {
    setNote(platform === "mac" ? "Open this page on the Mac." : "Open this page on the iPhone.");
  };

  const sessionToken = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return "";
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? "";
  };

  const addDevice = async () => {
    if (forced) return;
    setNote("");
    if (!hereMatches()) {
      wrongDevice();
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId || (platform !== "iphone" && platform !== "mac")) {
      setNote("Sign in on this Device first.");
      return;
    }
    setBusy(true);
    const token = generateDeviceToken();
    const tokenHash = await hashDeviceToken(token);
    const existing = devices.find((device) => !device.revoked_at && device.kind === platform);
    const error = existing
      ? (await client.from("reminder_devices").update({ pending_token_hash: tokenHash }).eq("id", existing.id)).error
      : (
          await client.from("reminder_devices").insert({
            workspace_id: workspaceId,
            name: platform === "mac" ? "Office Mac" : "Office Device",
            kind: platform,
            is_primary: platform === "iphone" || !devices.some((device) => !device.revoked_at),
            token_hash: tokenHash,
          })
        ).error;
    if (error) {
      setBusy(false);
      setNote("Couldn't add the Device. Try again.");
      return;
    }
    onChanged?.();
    const response = await fetch("/api/reminders/shortcut", {
      method: "POST",
      headers: { Authorization: `Bearer ${await sessionToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await response.json().catch(() => ({}))) as { importUrl?: string; fileUrl?: string; error?: string };
    setBusy(false);
    if (!response.ok || !body.importUrl) {
      setNote(body.error || "Couldn't open the shortcut. Try again.");
      return;
    }
    setFileUrl(body.fileUrl ?? "");
    window.location.href = body.importUrl;
  };

  const addRuleShortcut = async (rule: TextRule) => {
    if (forced) return;
    setNote("");
    if (!hereMatches()) {
      wrongDevice();
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId || (platform !== "iphone" && platform !== "mac")) {
      setNote("Sign in on this Device first.");
      return;
    }
    setBusy(true);
    let device = devices.find((row) => !row.revoked_at && row.kind === platform);
    let token: string | null = null;
    if (!device) {
      token = generateDeviceToken();
      const tokenHash = await hashDeviceToken(token);
      const inserted = await client
        .from("reminder_devices")
        .insert({
          workspace_id: workspaceId,
          name: platform === "mac" ? "Office Mac" : "Office Device",
          kind: platform,
          is_primary: platform === "iphone" || !devices.some((row) => !row.revoked_at),
          token_hash: tokenHash,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        setBusy(false);
        setNote("Couldn't add the Device. Try again.");
        return;
      }
      device = { id: inserted.data.id, kind: platform, revoked_at: null };
      onChanged?.();
    }
    const name = rule.shortcutName || shortcutName(rule);
    const access = await sessionToken();
    const send = (body: Record<string, string | null>) =>
      fetch("/api/reminders/shortcut", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    let response = await send({ deviceId: device.id, ruleId: rule.id, name, token });
    if (response.status === 409) {
      token = generateDeviceToken();
      response = await send({ deviceId: device.id, ruleId: rule.id, name, token });
    }
    const payload = (await response.json().catch(() => ({}))) as { importUrl?: string; fileUrl?: string; error?: string };
    setBusy(false);
    if (!response.ok || !payload.importUrl) {
      setNote(payload.error || "Couldn't open the shortcut. Try again.");
      return;
    }
    setFileUrl(payload.fileUrl ?? "");
    window.location.href = payload.importUrl;
  };

  const createRule = () => {
    if (!kind || !templateId) return;
    const nextRule: TextRule = {
      id: newRuleId(),
      templateId,
      on: true,
      kind,
      hour,
    };
    nextRule.shortcutName = shortcutName(nextRule);
    update(withRules(settings, [...rules, nextRule]));
    setRuleIds((current) => [...current, nextRule.id]);
    setAdding(null);
    setKind(null);
  };

  const runTest = () => {
    if (forced) return;
    setNote("");
    if (!hereMatches()) {
      wrongDevice();
      return;
    }
    const started = new Date().toISOString();
    setSince(started);
    update({ messagingSetup: { platform, step: stepId, ruleIds: picked, checkedInAt: saved.checkedInAt, testSince: started, redo } });
    const name = testShortcutName(rules, picked);
    window.location.href = shortcutRunUrl(name);
  };

  const active = platform === "iphone" || platform === "mac" ? devices.some((device) => !device.revoked_at && device.kind === platform) : false;
  const savedMessages = messages.filter((message) => !message.deleted);

  let body = null;
  if (step.kind === "device") {
    body = (
      <div className="grid gap-4" data-testid="messaging-device">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Are you using an iPhone or a Mac?</h2>
        <button className={choice} data-testid="choose-iphone" onClick={() => choose("iphone")} type="button">
          iPhone
        </button>
        <button className={choice} data-testid="choose-mac" onClick={() => choose("mac")} type="button">
          Mac
        </button>
      </div>
    );
  } else if (step.kind === "start-over" && (platform === "iphone" || platform === "mac")) {
    body = (
      <div className="grid gap-4" data-testid="messaging-start-over">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Start over</h2>
        <ol className="grid gap-4">
          <Lines lines={startOverLines(platform)} />
        </ol>
      </div>
    );
  } else if (step.kind === "add-device" && (platform === "iphone" || platform === "mac")) {
    body = (
      <div className="grid gap-4" data-testid="messaging-add-device">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Add this Device</h2>
        <ol className="grid gap-4">
          <li className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-lg font-bold text-[var(--text-main)]">1</span>
            <button className={primary} data-testid="add-to-iphone" disabled={busy} onClick={() => void addDevice()} type="button">
              {busy ? "Opening…" : "Add to this Device"}
            </button>
          </li>
          <Lines lines={shortcutFollowLines(platform)} start={2} />
        </ol>
        {platform === "mac" && fileUrl ? (
          <a className="text-lg font-bold text-[var(--brand-primary)] underline" download="NoteGoat.shortcut" href={fileUrl}>
            Download shortcut
          </a>
        ) : null}
      </div>
    );
  } else if (step.kind === "shortcuts-app" && (platform === "iphone" || platform === "mac")) {
    body = (
      <div className="grid gap-4" data-testid="messaging-shortcuts-app">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Shortcuts</h2>
        <ol className="grid gap-4">
          <Lines lines={shortcutsAppLines(platform)} />
        </ol>
      </div>
    );
  } else if (step.kind === "pick") {
    body = (
      <div className="grid gap-4" data-testid="messaging-pick">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Which texts?</h2>
        {adding === "template" ? (
          <div className="grid gap-3">
            {savedMessages.map((message) => (
              <button
                className={choice}
                key={message.id}
                onClick={() => {
                  setTemplateId(message.id);
                  setAdding("when");
                }}
                type="button"
              >
                {message.name}
              </button>
            ))}
          </div>
        ) : adding === "when" ? (
          <div className="grid gap-3">
            {WHEN.map((choiceRow) => {
              const selected = kind === choiceRow.kind;
              return (
                <div className={`rounded-xl px-4 py-4 ${selected ? "border-2 border-[var(--brand-primary)] bg-[var(--bg-panel)]" : "border border-[var(--line-soft)] bg-[var(--bg-panel)]"}`} key={choiceRow.kind}>
                  <button className="w-full text-left text-lg font-bold text-[var(--text-main)]" onClick={() => setKind(choiceRow.kind)} type="button">
                    {choiceRow.label}
                  </button>
                  {selected ? (
                    <select
                      aria-label={`${choiceRow.label} time`}
                      className="mt-3 h-[42px] w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 text-lg font-bold text-[var(--text-main)]"
                      onChange={(event) => setHour(Number(event.target.value))}
                      value={hour}
                    >
                      {HOURS.map((value) => (
                        <option key={value} value={value}>
                          {hourChoice(value)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}
            <button className={primary} disabled={!kind} onClick={createRule} type="button">
              Create Shortcut
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {rules.map((rule) => {
              const selected = ruleIds.includes(rule.id);
              return (
                <button
                  aria-pressed={selected}
                  className={`rounded-xl px-4 py-4 text-left text-lg font-bold text-[var(--text-main)] ${selected ? "border-2 border-[var(--brand-primary)] bg-[var(--bg-panel)]" : "border border-[var(--line-soft)] bg-[var(--bg-panel)]"}`}
                  data-testid="messaging-text"
                  key={rule.id}
                  onClick={() =>
                    setRuleIds((current) => (current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id]))
                  }
                  type="button"
                >
                  {rule.shortcutName || shortcutName(rule)}
                </button>
              );
            })}
            <button
              className="text-lg font-bold text-[var(--brand-primary)]"
              onClick={() => {
                if (savedMessages.length === 0) {
                  window.dispatchEvent(new Event("notegoat:new-text-template"));
                  return;
                }
                setAdding("template");
                setKind(null);
                setTemplateId(savedMessages[0]?.id ?? "");
              }}
              type="button"
            >
              Add a text
            </button>
          </div>
        )}
      </div>
    );
  } else if ((step.kind === "shortcut" || step.kind === "automation") && (platform === "iphone" || platform === "mac")) {
    const rule = rules.find((item) => item.id === step.ruleId);
    const name = rule ? rule.shortcutName || shortcutName(rule) : "NoteGoat";
    const time = rule ? clockWords(rule.hour) : "";
    body =
      step.kind === "shortcut" ? (
        <div className="grid gap-4" data-testid="messaging-shortcut">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">{name}</h2>
          <ol className="grid gap-4">
            <li className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-lg font-bold text-[var(--text-main)]">1</span>
              <button className={primary} data-testid="add-shortcut-device" disabled={busy || !rule} onClick={() => rule && void addRuleShortcut(rule)} type="button">
                {busy ? "Opening…" : "Add to this Device"}
              </button>
            </li>
            <Lines lines={shortcutFollowLines(platform)} start={2} />
          </ol>
          {platform === "mac" && fileUrl ? (
            <a className="text-lg font-bold text-[var(--brand-primary)] underline" download={`${name.replace(/[^\w –-]+/g, "")}.shortcut`} href={fileUrl}>
              Download shortcut
            </a>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4" data-testid="messaging-automation">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">{name}</h2>
          <ol className="grid gap-4">
            <Lines lines={automationGuideLines(platform, name, time)} />
          </ol>
          <details data-testid="automation-fallback">
            <summary className="cursor-pointer text-lg font-bold text-[var(--brand-primary)]">Don't see Automation?</summary>
            <ol className="mt-4 grid gap-4">
              <Lines lines={automationFallbackLines(platform, name, time)} />
            </ol>
          </details>
        </div>
      );
  } else if (step.kind === "test" && (platform === "iphone" || platform === "mac")) {
    body = (
      <div className="grid gap-4" data-testid="messaging-test">
        <h2 className="text-2xl font-bold text-[var(--text-main)]">Test it now</h2>
        <ol className="grid gap-4">
          <li className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-lg font-bold text-[var(--text-main)]">1</span>
            <button className={primary} data-testid="messaging-test-now" onClick={runTest} type="button">
              {since && !check.ok ? "Waiting for this Device…" : "Test it now"}
            </button>
          </li>
          <Lines lines={testFollowLines(platform)} start={2} />
        </ol>
        {check.ok ? (
          <div data-testid="messaging-checked-in">
            <p className="text-lg font-bold text-[var(--text-main)]">This Device checked in.</p>
            {check.summary ? <p className="text-lg font-semibold text-[var(--text-main)]">{lastRunText(check.summary, null)}</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const nextDisabled =
    (step.kind === "add-device" && !forced && !active) ||
    (step.kind === "pick" && (adding !== null || picked.length === 0)) ||
    (step.kind === "test" && !check.ok);

  return (
    <div className="grid gap-6 text-[var(--text-main)]" data-testid="messaging-setup-flow">
      <div data-testid="messaging-progress">
        <p className="text-sm font-bold text-[var(--text-main)]">
          {index + 1} of {steps.length}
        </p>
        <div className="mt-2 h-2 rounded-full bg-[var(--line-soft)]">
          <div className="h-2 rounded-full bg-[var(--brand-primary)]" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      {body}
      {note ? <p className="font-semibold text-[var(--text-main)]">{note}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <button
          className="text-lg font-bold text-[var(--brand-primary)]"
          onClick={() => {
            if (adding === "when") {
              setAdding("template");
              return;
            }
            if (adding === "template") {
              setAdding(null);
              return;
            }
            go(-1);
          }}
          type="button"
        >
          Back
        </button>
        {step.kind === "device" ? null : (
          <button className="rounded-xl bg-[var(--brand-primary)] px-6 py-3 text-lg font-bold text-[var(--on-brand)] disabled:opacity-60" disabled={nextDisabled} onClick={() => (step.kind === "test" ? onClose() : go(1))} type="button">
            {step.kind === "test" ? "Done" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}

export { messagingSetupComplete };

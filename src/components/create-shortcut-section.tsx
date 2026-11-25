"use client";

/**
 * Text Reminders → Create Shortcut.
 * Choose a template, choose when, then one Time of Day automation for that shortcut.
 */

import { useState, type ReactNode } from "react";
import { CollapsibleSection } from "@/components/collapsible-section";
import { appConfirm } from "@/components/app-dialog";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { generateDeviceToken, hashDeviceToken } from "@/lib/reminder-automation";
import { oneShortcutLines, readSetupPlatform, stopCatcherLines, type SetupPlatform } from "@/lib/iphone-setup";
import type { SmsTemplate } from "@/lib/sms-template-core";
import type { SmsReminderSettings, TextRule, TextWhenKind } from "@/lib/sms-reminders";
import { clockWords, legacyRules, newRuleId, ruleWhen, shortcutName, shortcutStatusText, withRules, type ShortcutRun } from "@/lib/text-rules";

const WHEN: { kind: TextWhenKind; label: string }[] = [
  { kind: "open-day", label: "Open business days at" },
  { kind: "birthday", label: "Birthdays at" },
  { kind: "hours-before", label: "24 hours before appointment" },
  { kind: "day-before", label: "Day before appointment at" },
];

const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const big = "rounded-lg border border-[var(--line-soft)] bg-[var(--bg-panel)] px-4 py-2 text-left text-base font-semibold text-[var(--text-main)]";
const primary = "inline-flex items-center rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-base font-semibold text-[var(--on-brand)] disabled:opacity-60";

function hourChoice(hour: number): string {
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown} ${hour >= 12 ? "PM" : "AM"}`;
}

function StepWords({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : <span key={index}>{part}</span>))}
    </>
  );
}

export function CreateShortcutSection({
  settings,
  update,
  messages,
  devices,
  workspaceId,
  runs,
  onChanged,
  open,
  onToggle,
  forcedStep,
}: {
  settings: SmsReminderSettings;
  update: (patch: Partial<SmsReminderSettings>) => void;
  messages: SmsTemplate[];
  devices: { id: string; kind: string | null; revoked_at: string | null }[];
  workspaceId: string;
  runs: Record<string, ShortcutRun>;
  onChanged?: () => void;
  open: boolean;
  onToggle: (next: boolean) => void;
  /** Screenshot harness. */
  forcedStep?: "list" | "template" | "when" | "steps" | "device";
}) {
  const saved = messages.filter((message) => !message.deleted);
  const rules = settings.rules ?? legacyRules(settings);
  const [step, setStep] = useState<"list" | "template" | "when" | "steps">(forcedStep === "device" ? "steps" : (forcedStep ?? "list"));
  const [templateId, setTemplateId] = useState(saved[0]?.id ?? "");
  const [kind, setKind] = useState<TextWhenKind | null>(forcedStep === "when" || forcedStep === "steps" ? "birthday" : null);
  const [hours, setHours] = useState<Record<TextWhenKind, number>>({
    "open-day": 8,
    birthday: 9,
    "hours-before": 8,
    "day-before": 8,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [built, setBuilt] = useState<TextRule | null>(forcedStep === "steps" || forcedStep === "device" ? (rules.find((rule) => rule.kind === "birthday") ?? rules[0] ?? null) : null);
  const [deviceCode, setDeviceCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<SetupPlatform>("iphone");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  if (typeof navigator !== "undefined") {
    const here = readSetupPlatform(navigator.userAgent, navigator.maxTouchPoints);
    if (here !== platform) setPlatform(here);
  }

  const saveRules = (next: TextRule[]) => update(withRules(settings, next));

  const begin = () => {
    if (saved.length === 0) {
      window.dispatchEvent(new Event("notegoat:new-text-template"));
      document.getElementById("section-templates")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setEditingId(null);
    setKind(null);
    setTemplateId(saved[0].id);
    setBuilt(null);
    setStep("template");
  };

  const create = () => {
    if (!kind || !templateId) return;
    const hour = hours[kind];
    const nextRule: TextRule = {
      id: editingId ?? newRuleId(),
      templateId,
      on: true,
      kind,
      hour,
    };
    nextRule.shortcutName = shortcutName(nextRule);
    const next = editingId ? rules.map((rule) => (rule.id === editingId ? nextRule : rule)) : [...rules, nextRule];
    saveRules(next);
    setBuilt(nextRule);
    setStep("steps");
  };

  const editRule = (rule: TextRule) => {
    setEditingId(rule.id);
    setTemplateId(rule.templateId);
    setKind(rule.kind);
    setHours((current) => ({ ...current, [rule.kind]: rule.hour }));
    setBuilt(null);
    setStep("template");
  };

  const remove = async (rule: TextRule) => {
    if (!(await appConfirm(`Delete ${rule.shortcutName || shortcutName(rule)}?`, { confirmLabel: "Delete", danger: true }))) return;
    saveRules(rules.filter((item) => item.id !== rule.id));
    if (built?.id === rule.id) setBuilt(null);
  };

  const addToThisDevice = async () => {
    if (!built) return;
    setNote("");
    const here = readSetupPlatform(navigator.userAgent, navigator.maxTouchPoints);
    if (here === "other") {
      setNote("Open this page on the office Device.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) {
      setNote("Sign in on this Device first.");
      return;
    }
    setBusy(true);
    const kindName = here === "mac" ? "mac" : "iphone";
    let device = devices.find((row) => !row.revoked_at && row.kind === kindName);
    let token: string | null = null;
    if (!device) {
      token = generateDeviceToken();
      const tokenHash = await hashDeviceToken(token);
      const inserted = await client
        .from("reminder_devices")
        .insert({
          workspace_id: workspaceId,
          name: kindName === "mac" ? "Office iMac" : "Office Device",
          kind: kindName,
          is_primary: kindName === "iphone" || !devices.some((row) => !row.revoked_at),
          token_hash: tokenHash,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        setBusy(false);
        setNote("Couldn't add the Device. Try again.");
        return;
      }
      device = { id: inserted.data.id, kind: kindName, revoked_at: null };
      setDeviceCode(token);
      setCopied(false);
      onChanged?.();
    }
    const { data: session } = await client.auth.getSession();
    const post = (body: Record<string, string | null>) =>
      fetch("/api/reminders/shortcut", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const name = built.shortcutName || shortcutName(built);
    let response = await post({ deviceId: device.id, ruleId: built.id, name, token });
    if (response.status === 409) {
      token = generateDeviceToken();
      response = await post({ deviceId: device.id, ruleId: built.id, name, token });
    }
    const payload = (await response.json().catch(() => ({}))) as { importUrl?: string; fileUrl?: string; error?: string };
    setBusy(false);
    if (payload.fileUrl) setFileUrl(payload.fileUrl);
    if (!response.ok || !payload.importUrl) {
      setNote(payload.error || "Couldn't open the shortcut. Try again.");
      return;
    }
    window.location.href = payload.importUrl;
  };

  const showing = built ?? (forcedStep === "steps" || forcedStep === "device" ? rules[0] : null);
  const lines = showing ? oneShortcutLines(platform, showing.shortcutName || shortcutName(showing), clockWords(showing.hour)) : [];

  let body: ReactNode = null;
  if (step === "template") {
    body = (
      <div className="grid gap-3" data-testid="shortcut-choose">
        <p className="text-lg font-bold text-[var(--text-main)]">Choose template</p>
        {saved.map((message) => (
          <button
            className={big}
            key={message.id}
            onClick={() => {
              setTemplateId(message.id);
              setStep("when");
            }}
            type="button"
          >
            {message.name}
          </button>
        ))}
        <button className="text-base font-semibold text-[var(--brand-primary)]" onClick={() => setStep("list")} type="button">
          Back
        </button>
      </div>
    );
  } else if (step === "when") {
    body = (
      <div className="grid gap-3" data-testid="shortcut-when">
        <p className="text-lg font-bold text-[var(--text-main)]">Send when?</p>
        <div className="grid gap-3" role="radiogroup" aria-label="Send when?">
          {WHEN.map((choice) => {
            const selected = kind === choice.kind;
            return (
              <div
                className={`rounded-xl px-4 py-4 text-[var(--text-main)] ${selected ? "border-2 border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border border-[var(--line-soft)] bg-[var(--bg-panel)]"}`}
                key={choice.kind}
              >
                <button aria-checked={selected} className="flex w-full items-center gap-3 text-left text-lg font-bold" onClick={() => setKind(choice.kind)} role="radio" type="button">
                  <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-[var(--brand-primary)]" : "border-[var(--line-soft)]"}`}>
                    {selected ? <span className="h-3 w-3 rounded-full bg-[var(--brand-primary)]" /> : null}
                  </span>
                  {choice.label}
                </button>
                {selected ? (
                  <select
                    aria-label={`${choice.label} time`}
                    className="mt-3 h-[42px] w-full rounded-xl border border-[var(--line-soft)] bg-[var(--field-bg)] px-3 text-lg font-bold text-[var(--text-main)]"
                    onChange={(event) => setHours((current) => ({ ...current, [choice.kind]: Number(event.target.value) }))}
                    value={hours[choice.kind]}
                  >
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hourChoice(hour)}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
        <button className={primary} data-testid="create-shortcut" disabled={!kind} onClick={create} type="button">
          Create Shortcut
        </button>
        <button className="text-base font-semibold text-[var(--brand-primary)]" onClick={() => setStep("template")} type="button">
          Back
        </button>
      </div>
    );
  } else if (step === "steps" && showing) {
    body = (
      <div className="grid gap-4" data-testid="shortcut-steps">
        <p className="text-lg font-semibold text-[var(--text-main)]">This button adds the NoteGoat shortcut for you. The only part you do by hand is one automation.</p>
        <button className={primary} data-testid="add-shortcut-device" disabled={busy} onClick={() => void addToThisDevice()} type="button">
          {busy ? "Opening…" : "Add the shortcut"}
        </button>
        {deviceCode ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all break-all font-mono text-sm text-[var(--text-main)]">{deviceCode}</code>
            <button
              className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-panel)] px-3 py-1.5 text-sm font-semibold text-[var(--text-main)]"
              onClick={() => {
                void navigator.clipboard?.writeText(deviceCode).then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        ) : null}
        <p className="text-2xl font-bold text-[var(--text-main)]">One daily automation</p>
        <ol className="grid gap-4">
          {lines.map((line, index) => (
            <li className="flex items-start gap-3" data-testid="shortcut-step" key={line}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[var(--brand-accent)] text-base font-bold text-[var(--text-main)]">{index + 1}</span>
              <p className="pt-1 text-base font-semibold leading-relaxed text-[var(--text-main)]">
                <StepWords text={line} />
              </p>
            </li>
          ))}
        </ol>
        <div className="grid gap-3">
          <h3 className="text-lg font-bold text-[var(--text-main)]">Optional: auto-handle STOP replies</h3>
          <ol className="grid gap-3">
            {stopCatcherLines(platform).map((line) => (
              <li className="text-base font-semibold text-[var(--text-main)]" key={line}>
                <StepWords text={line} />
              </li>
            ))}
          </ol>
        </div>
        {platform === "mac" && fileUrl ? (
          <a className="text-lg font-bold text-[var(--brand-primary)] underline" download={`${(showing.shortcutName || "NoteGoat").replace(/[^\w –-]+/g, "")}.shortcut`} href={fileUrl}>
            Download shortcut
          </a>
        ) : null}
        {note ? <p className="font-semibold text-[var(--text-main)]">{note}</p> : null}
        <button className="text-base font-semibold text-[var(--brand-primary)]" onClick={() => setStep("list")} type="button">
          Back
        </button>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-3" data-testid="shortcut-list">
        {rules.length > 0 ? (
          <ul className="divide-y divide-[var(--line-soft)] rounded-xl border border-[var(--line-soft)]">
            {rules.map((rule) => (
              <li className="grid gap-2 px-4 py-4" data-testid="shortcut-row" key={rule.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-[var(--text-main)]">{rule.shortcutName || shortcutName(rule)}</p>
                    <p className="text-[var(--text-muted)]">{ruleWhen(rule)}</p>
                    <p
                      className={`font-semibold ${runs[rule.id]?.status === "error" ? "text-danger" : runs[rule.id]?.status === "ok" && rule.on ? "text-[var(--status-active)]" : "text-[var(--text-main)]"}`}
                      data-testid="shortcut-status"
                    >
                      {shortcutStatusText(rule, runs[rule.id], settings.timeZone)}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <button className="text-base font-semibold text-[var(--brand-primary)]" onClick={() => editRule(rule)} type="button">
                      Edit
                    </button>
                    <button className="text-base font-semibold text-[var(--text-main)]" onClick={() => void remove(rule)} type="button">
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <button className={primary} data-testid="create-shortcut-start" onClick={begin} type="button">
          Create Shortcut
        </button>
      </div>
    );
  }

  return (
    <CollapsibleSection onToggle={onToggle} open={open} testId="section-shortcuts" title="Create Shortcut">
      {body}
    </CollapsibleSection>
  );
}

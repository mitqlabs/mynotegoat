"use client";

/**
 * Text Reminders, the short way: pick a message, pick when, pick a time.
 * The phone steps are only the times those texts need.
 */

import { useState } from "react";
import { ReminderSetupChecklist } from "@/components/reminder-setup-checklist";
import { phoneStepsForClocks } from "@/lib/iphone-setup";
import type { SmsTemplate } from "@/lib/sms-template-core";
import type { SmsReminderSettings, TextRule, TextWhenKind } from "@/lib/sms-reminders";
import { automationClocks, legacyRules, newRuleId, ruleWhen, withRules } from "@/lib/text-rules";

const WHEN: { kind: TextWhenKind; label: string }[] = [
  { kind: "day-before", label: "Day before the visit" },
  { kind: "birthday", label: "Birthdays" },
  { kind: "open-day", label: "Days the office is open" },
  { kind: "hours-before", label: "24 hours before" },
];

const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const big = "w-full rounded-xl border-2 border-[var(--brand-primary)] bg-[var(--bg-panel)] px-4 py-4 text-left text-lg font-bold text-[var(--text-main)]";
const primary = "w-full rounded-xl bg-[var(--brand-primary)] px-4 py-4 text-lg font-bold text-[var(--on-brand)]";

function hourWords(hour: number): string {
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown} ${hour >= 12 ? "PM" : "AM"}`;
}

export function TextRuleWizard({
  settings,
  update,
  messages,
  devices,
  workspaceId,
  onChanged,
  onConfirm,
  hasMac,
  startAt = "list",
}: {
  settings: SmsReminderSettings;
  update: (patch: Partial<SmsReminderSettings>) => void;
  messages: SmsTemplate[];
  devices: { id: string; kind: string | null; revoked_at: string | null; last_seen_at: string | null }[];
  workspaceId: string;
  onChanged?: () => void;
  onConfirm: (confirmed: boolean) => void;
  hasMac: boolean;
  /** Preview only. The real page starts on the list. */
  startAt?: "list" | "message" | "when" | "time";
}) {
  const saved = messages.filter((message) => !message.deleted);
  const rules = settings.rules ?? legacyRules(settings);
  const [step, setStep] = useState<"list" | "message" | "when" | "time">(startAt);
  const [templateId, setTemplateId] = useState(saved.length === 1 ? saved[0].id : "");
  const [kind, setKind] = useState<TextWhenKind | null>(null);

  const save = (next: TextRule[]) => {
    update(withRules(settings, next));
    setStep("list");
    setKind(null);
    setTemplateId(saved.length === 1 ? saved[0].id : "");
  };

  const begin = () => {
    if (saved.length === 0) {
      window.dispatchEvent(new Event("notegoat:open-sms-templates"));
      return;
    }
    if (saved.length === 1) {
      setTemplateId(saved[0].id);
      setStep("when");
      return;
    }
    setStep("message");
  };

  const pickTime = (hour: number) => {
    if (!kind || !templateId) return;
    save([
      ...rules,
      { id: newRuleId(), templateId, on: true, kind, hour },
    ]);
  };

  const nameOf = (id: string) => saved.find((message) => message.id === id)?.name || "Message";
  const clocks = automationClocks(rules);

  if (step === "message") {
    return (
      <div className="grid gap-3 text-[var(--text-main)]" data-testid="wizard-message">
        <p className="text-3xl font-bold">1</p>
        <p className="text-lg font-bold">Which message?</p>
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
        <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => setStep("list")} type="button">
          Back
        </button>
      </div>
    );
  }

  if (step === "when") {
    const number = saved.length > 1 ? "2" : "1";
    return (
      <div className="grid gap-3 text-[var(--text-main)]" data-testid="wizard-when">
        <p className="text-3xl font-bold">{number}</p>
        <p className="text-lg font-bold">When?</p>
        {WHEN.map((choice) => (
          <button
            className={big}
            key={choice.kind}
            onClick={() => {
              setKind(choice.kind);
              setStep("time");
            }}
            type="button"
          >
            {choice.label}
          </button>
        ))}
        <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => setStep(saved.length > 1 ? "message" : "list")} type="button">
          Back
        </button>
      </div>
    );
  }

  if (step === "time") {
    const number = saved.length > 1 ? "3" : "2";
    return (
      <div className="grid gap-3 text-[var(--text-main)]" data-testid="wizard-time">
        <p className="text-3xl font-bold">{number}</p>
        <p className="text-lg font-bold">What time?</p>
        <div className="grid grid-cols-3 gap-2">
          {HOURS.map((hour) => (
            <button className={big} key={hour} onClick={() => pickTime(hour)} type="button">
              {hourWords(hour)}
            </button>
          ))}
        </div>
        <button className="text-sm font-semibold text-[var(--brand-primary)]" onClick={() => setStep("when")} type="button">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 text-[var(--text-main)]" data-testid="text-rule-wizard">
      {rules.length > 0 && (
        <ul className="divide-y divide-[var(--line-soft)] rounded-xl border border-[var(--line-soft)]" data-testid="text-rule-list">
          {rules.map((rule) => (
            <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" key={rule.id}>
              <div className="min-w-0">
                <p className="text-lg font-bold">{nameOf(rule.templateId)}</p>
                <p className="text-[var(--text-muted)]">{ruleWhen(rule)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  className={rule.on ? "rounded-xl bg-[var(--brand-primary)] px-6 py-4 text-lg font-bold text-[var(--on-brand)]" : "rounded-xl border-2 border-[var(--brand-primary)] bg-[var(--bg-panel)] px-6 py-4 text-lg font-bold text-[var(--text-main)]"}
                  onClick={() => save(rules.map((item) => (item.id === rule.id ? { ...item, on: !item.on } : item)))}
                  type="button"
                >
                  {rule.on ? "On" : "Off"}
                </button>
                <button
                  className="text-sm font-semibold text-[var(--text-muted)]"
                  onClick={() => save(rules.filter((item) => item.id !== rule.id))}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button className={primary} data-testid="add-a-text" onClick={begin} type="button">
        {saved.length === 0 ? "Write a message" : "Add a text"}
      </button>
      {clocks.length > 0 && (
        <ReminderSetupChecklist
          devices={devices}
          embedded
          hasMac={hasMac}
          onChanged={onChanged}
          onConfirm={onConfirm}
          onToggle={() => {}}
          open
          settings={settings}
          steps={phoneStepsForClocks(clocks)}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}

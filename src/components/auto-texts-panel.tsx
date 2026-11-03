"use client";

/**
 * Settings → Text Reminders → Auto Texts. One row per automatic text (Reminders,
 * Birthday): an on/off switch and a menu to attach one of the saved Messages.
 * Everything saves through `update`, which goes to the cloud settings.
 */
import type { ReactNode } from "react";
import { ToggleSwitch } from "@/components/toggle-switch";
import { renderReminderText, withOptOutLine } from "@/lib/reminder-automation";
import { renderBirthdayText } from "@/lib/birthday-texts";
import { resolveBirthdayMessage, resolveReminderMessage, usesAppointmentWords } from "@/lib/message-library";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import type { SmsTemplate } from "@/lib/sms-template-core";

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3";

type Office = { officeName: string; doctorName: string; phone: string };

function Row({
  testId,
  title,
  summary,
  on,
  onToggle,
  switchLabel,
  children,
}: {
  testId: string;
  title: string;
  summary: string;
  on: boolean;
  onToggle: (next: boolean) => void;
  switchLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{title}</p>
          <p className="text-[var(--text-muted)]">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-semibold" data-testid={`${testId}-state`}>
            {on ? "On" : "Off"}
          </span>
          <ToggleSwitch ariaLabel={switchLabel} checked={on} onChange={onToggle} />
        </div>
      </div>
      {children}
    </div>
  );
}

function MessagePicker({
  testId,
  value,
  messages,
  onPick,
}: {
  testId: string;
  value: string;
  messages: SmsTemplate[];
  onPick: (id: string) => void;
}) {
  const attached = messages.some((m) => m.id === value);
  return (
    <label className="grid gap-1">
      <span className={label}>Message it sends</span>
      <select className={input} data-testid={testId} onChange={(e) => onPick(e.target.value)} value={attached ? value : ""}>
        {!attached && <option value="">Choose a message…</option>}
        {messages.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AutoTextRows({
  settings,
  update,
  messages,
  office,
}: {
  settings: SmsReminderSettings;
  update: (patch: Partial<SmsReminderSettings>) => void;
  messages: SmsTemplate[];
  office: Office;
}) {
  const reminder = resolveReminderMessage(settings, messages);
  const reminderPreview = reminder
    ? withOptOutLine(
        renderReminderText(
          reminder.body,
          { appointmentId: "x", patientId: "x", patientName: "Doe, Jane", phone: "5550100", date: "2026-11-04", time: "10:30", appointmentType: "Office Visit" },
          undefined,
          office,
        ),
        settings,
      )
    : "";
  const birthday = resolveBirthdayMessage(settings, messages);
  const birthdayPreview = withOptOutLine(renderBirthdayText(birthday.body, "Doe, Jane", office), settings);

  return (
    <div className="grid gap-3" data-testid="auto-texts">
      <Row
        on={settings.enabled}
        onToggle={(next) => update({ enabled: next })}
        summary="Texts each patient the day before their visit."
        switchLabel="Send reminders automatically"
        testId="auto-text-reminders"
        title="Reminders"
      >
        <MessagePicker messages={messages} onPick={(id) => update({ templateId: id })} testId="reminder-message-select" value={settings.templateId} />
        {reminder ? (
          <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2" data-testid="reminder-preview">
            <span className="font-semibold">Example: </span>
            {reminderPreview}
          </p>
        ) : (
          <p className="text-red-700">No message yet. Add one in Messages below, then pick it here.</p>
        )}
      </Row>

      <Row
        on={settings.birthdayTexts}
        onToggle={(next) => update({ birthdayTexts: next })}
        summary="Texts each patient on their birthday."
        switchLabel="Text patients happy birthday on their birthday"
        testId="auto-text-birthday"
        title="Birthday"
      >
        <MessagePicker messages={messages} onPick={(id) => update({ birthdayTemplateId: id })} testId="birthday-message-select" value={settings.birthdayTemplateId} />
        <p className="rounded-xl bg-[var(--bg-soft)] px-3 py-2" data-testid="birthday-preview">
          <span className="font-semibold">Example: </span>
          {birthdayPreview}
        </p>
        {usesAppointmentWords(birthday.body) && (
          <p className="text-red-700" data-testid="birthday-appt-warning">
            This message uses the visit date or time, and a birthday text has no visit. Pick a different message, or take those words out in Messages.
          </p>
        )}
      </Row>

      {settings.dryRun && (
        <p className="text-[var(--text-muted)]" data-testid="auto-texts-test-mode">
          Test mode is on, so nothing is really texted. Turn it off below when you are ready.
        </p>
      )}
    </div>
  );
}

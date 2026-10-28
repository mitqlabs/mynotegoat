"use client";

/**
 * Settings → Text Reminders: the setup checklist. Step 2 (the 8 AM
 * automation) is spelled out because iOS can't ship a schedule inside a
 * shortcut. Without it the phone never sends by itself.
 */

import type { ReactNode } from "react";
import { fmtDate, fmtDay } from "@/lib/reminder-format";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import { SetupCard } from "@/components/setup-card";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;

function Badge({ children, tone }: { children: ReactNode; tone: "required" | "done" | "plain" }) {
  const cls =
    tone === "required"
      ? "bg-amber-200 text-amber-900"
      : tone === "done"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-[var(--bg-soft)] text-[var(--text-muted)]";
  return <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${done ? "bg-emerald-600" : "bg-[var(--brand-primary)]"}`}
    >
      {done ? "✓" : n}
    </span>
  );
}

/** The red "automation may not be set up" notice. Shown at the top of the page even when Set up is collapsed. */
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
      <p className="font-bold text-red-800">Your {time} automation may not be set up — see Step 2</p>
      <p className="mt-1 text-red-900">
        Reminders were due on {warning.slice(0, 2).map((d) => fmtDate(d)).join(" and ")}, but the phone didn&apos;t send
        them by itself around {time}.
        {settings.automationConfirmed
          ? " You ticked the box below, so open Shortcuts → Automation and make sure the automation is on and set to Run Immediately."
          : " If you haven't made the automation yet, do Step 2 now."}
      </p>
    </div>
  );
}

export function ReminderSetupChecklist({
  settings,
  onConfirm,
  open,
  onToggle,
}: {
  settings: SmsReminderSettings;
  onConfirm: (confirmed: boolean) => void;
  open: boolean;
  onToggle: (next: boolean) => void;
}) {
  const time = hourLabel(settings.sendHour);
  const confirmed = settings.automationConfirmed;
  const confirmedOn = fmtDay(settings.automationConfirmedAt, settings.timeZone);
  return (
    <SetupCard
      onToggle={onToggle}
      open={open}
      status={confirmed ? "done" : "todo"}
      summary={
        confirmed
          ? `Done. You made the ${time} automation${confirmedOn ? ` on ${confirmedOn}` : ""}.`
          : `Step 2 is required. Without it the iPhone never sends by itself.`
      }
      testId="reminder-setup-checklist"
      title="Automatic reminders: 3 steps"
    >
      <ol className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)]">
        <li className="flex gap-3 px-3 py-3">
          <StepNumber n={1} />
          <div className="grid gap-1">
            <p className="font-semibold">
              Add the shortcut to the iPhone <Badge tone="plain">One time</Badge>
            </p>
            <p className="text-[var(--text-muted)]">
              Click <b>+ Add iPhone</b> in <b>Sending devices</b>, copy the setup code, then open <b>iPhone setup</b> below and follow it.
            </p>
          </div>
        </li>

        <li className={`flex gap-3 px-3 py-3 ${confirmed ? "bg-emerald-50/50" : "bg-amber-50"}`} data-testid="step-automation">
          <StepNumber done={confirmed} n={2} />
          <div className="grid min-w-0 flex-1 gap-2">
            <p className="font-semibold">
              Make the {time} automation <Badge tone={confirmed ? "done" : "required"}>{confirmed ? "Done" : "Required"}</Badge>
            </p>
            <p className="font-semibold text-amber-900">
              The shortcut does not start by itself. You set the alarm once, on the phone. It takes about 30 seconds.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                On the office iPhone, open <b>Shortcuts</b>. If you are inside a folder, tap <b>‹</b> until you reach the main screen.
              </li>
              <li>
                Tap <b>Automation</b>, then <b>+</b>, then <b>Time of Day</b>.
              </li>
              <li>
                Set the time to <b>{time}</b> and <b>Repeat: Every Day</b>. Choose <b>Run Immediately</b> and turn <b>Notify When Run</b> off.
              </li>
              <li>
                Search <b>Run Shortcut</b> and tap it. Tap the blue <b>Shortcut</b> word and pick <b>Send-Reminders</b>. Leave <b>Input</b> empty.
              </li>
              <li>
                Name it (for example <b>{time.replace(":00", "")} Reminders</b>) and go back to save it.
              </li>
              <li>
                If iOS asks permission the first time it texts, tap <b>Always Allow</b>.
              </li>
            </ol>
            <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              <li>Every day is fine. NoteGoat only sends when reminders are due, and never texts anyone twice.</li>
              <li>Keep just one of these automations. Delete any copy.</li>
              <li>Shortcut list empty? Use the <b>Run Shortcut</b> search, or close Shortcuts completely and try again.</li>
              <li>Using only the iMac? Skip this step.</li>
            </ul>
            <label className="mt-1 inline-flex items-center gap-2 font-semibold" data-testid="automation-confirm">
              <input checked={confirmed} className="h-4 w-4" onChange={(e) => onConfirm(e.target.checked)} type="checkbox" />
              I made the {time} automation
              {confirmed && confirmedOn && <span className="font-normal text-[var(--text-muted)]">(checked {confirmedOn})</span>}
            </label>
          </div>
        </li>

        <li className="flex gap-3 px-3 py-3">
          <StepNumber n={3} />
          <div className="grid gap-1">
            <p className="font-semibold">
              Turn on sending <Badge tone="plain">When Recent sends looks right</Badge>
            </p>
            <p className="text-[var(--text-muted)]">
              In <b>Texts</b>, check the box <b>Send reminders automatically</b>. While <b>Test mode</b> is checked, nothing is texted. When <b>Recent sends</b> looks right, uncheck <b>Test mode</b>.
              Tomorrow at {time}, check <b>Recent sends</b> to see it ran.
            </p>
          </div>
        </li>
      </ol>
    </SetupCard>
  );
}

"use client";

/**
 * Settings → Text Reminders: the setup checklist. Step 2 (the 8 AM
 * automation) is spelled out because iOS can't ship a schedule inside a
 * shortcut. Without it the phone never sends by itself.
 */

import type { ReactNode } from "react";
import type { SmsReminderSettings } from "@/lib/sms-reminders";

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h >= 12 ? "PM" : "AM"}`;

function Badge({ children, tone }: { children: ReactNode; tone: "required" | "done" | "plain" }) {
  const cls =
    tone === "required"
      ? "bg-amber-200 text-amber-900"
      : tone === "done"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-[var(--bg-soft)] text-[var(--text-muted)]";
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
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

export function ReminderSetupChecklist({
  settings,
  onConfirm,
  warning,
  hasIphone,
}: {
  settings: SmsReminderSettings;
  onConfirm: (confirmed: boolean) => void;
  /** Dates (YYYY-MM-DD) of recent run days with no automatic send; empty = no warning. */
  warning: string[];
  hasIphone: boolean;
}) {
  const time = hourLabel(settings.sendHour);
  const confirmed = settings.automationConfirmed;
  const confirmedOn = settings.automationConfirmedAt
    ? new Date(settings.automationConfirmedAt).toLocaleDateString("en-US", { dateStyle: "short" })
    : "";
  return (
    <section className="grid gap-3" data-testid="reminder-setup-checklist">
      {warning.length > 0 && hasIphone && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm" data-testid="automation-warning" role="alert">
          <p className="font-bold text-red-800">Your {time} automation may not be set up — see Step 2</p>
          <p className="mt-1 text-red-900">
            Reminders were due on {warning.slice(0, 2).map((d) => d.slice(5).replace("-", "/")).join(" and ")}, but the phone didn&apos;t send
            them by itself around {time}.
            {confirmed
              ? " You ticked the box below, so open Shortcuts → Automation and make sure the automation is on and set to Run Immediately."
              : " If you haven't made the automation yet, do Step 2 now."}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--line-soft)] bg-white">
        <div className="border-b border-[var(--line-soft)] px-4 py-3">
          <p className="font-bold">Set up automatic reminders on the office iPhone</p>
          <p className="text-sm text-[var(--text-muted)]">
            Three steps. <b>Step 2 is required</b>: installing the shortcut does not make it run by itself.
          </p>
        </div>

        <ol className="divide-y divide-[var(--line-soft)]">
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={1} />
            <div className="grid gap-1 text-sm">
              <p className="font-semibold">
                Install the shortcut <Badge tone="plain">One time</Badge>
              </p>
              <p className="text-[var(--text-muted)]">
                Click <b>+ Add iPhone</b> below, copy the code, then open <b>iPhone setup (Shortcuts app)</b> further down and
                add <b>Send-Reminders</b>.
              </p>
            </div>
          </li>

          <li className={`flex gap-3 px-4 py-3 ${confirmed ? "bg-emerald-50/50" : "bg-amber-50"}`} data-testid="step-automation">
            <StepNumber done={confirmed} n={2} />
            <div className="grid min-w-0 flex-1 gap-2 text-sm">
              <p className="font-semibold">
                Create the {time} automation <Badge tone={confirmed ? "done" : "required"}>{confirmed ? "Done" : "Required"}</Badge>
              </p>
              <p className="font-semibold text-amber-900">
                The shortcut does NOT run by itself. iOS can&apos;t put a schedule inside a shortcut, so you set the timer once,
                by hand, on the phone. Takes about 30 seconds.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5 text-[var(--text-main)]">
                <li>
                  On the office iPhone, open <b>Shortcuts</b>. If you&apos;re inside a folder such as <b>All Shortcuts</b>, tap the{" "}
                  <b>‹</b> back arrow until you reach the main screen.
                </li>
                <li>
                  Open <b>Automation</b> (along the bottom, or in the list on the main screen), tap <b>+</b>, then choose{" "}
                  <b>Time of Day</b>.
                </li>
                <li>
                  Set the time to <b>{time}</b> and <b>Repeat: Every Day</b>. Turn <b>Automation</b> (run automatically /{" "}
                  <b>Run Immediately</b>) <b>ON</b> and <b>Notify When Run</b> <b>OFF</b>.
                </li>
                <li>
                  In the search bar at the bottom, type <b>Run Shortcut</b> and tap it. Tap the blue <b>Shortcut</b> word in that
                  action and pick <b>Send-Reminders</b>. Leave <b>Input</b> empty.
                </li>
                <li>
                  Rename it at the top, for example <b>{time.replace(":00", "")} Reminders</b>, then tap the back arrow to save.
                </li>
                <li>
                  The first time it texts, iOS may ask permission. Tap <b>Always Allow</b>.
                </li>
              </ol>
              <ul className="list-disc space-y-1 pl-5 text-[var(--text-muted)]">
                <li>Running every day is fine. NoteGoat only sends when reminders are due, and never texts anyone twice.</li>
                <li>Keep just one automation for this. Delete any duplicate.</li>
                <li>
                  Shortcut list empty when you pick one? Use the <b>Run Shortcut</b> search above, or force-quit Shortcuts and try
                  again.
                </li>
                <li>iMac only? Skip this step. The iMac setup has its own timer.</li>
              </ul>
              <label className="mt-1 inline-flex items-center gap-2 font-semibold" data-testid="automation-confirm">
                <input
                  checked={confirmed}
                  className="h-4 w-4"
                  onChange={(e) => onConfirm(e.target.checked)}
                  type="checkbox"
                />
                I created the {time} automation
                {confirmed && confirmedOn && <span className="font-normal text-[var(--text-muted)]">(ticked {confirmedOn})</span>}
              </label>
            </div>
          </li>

          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={3} />
            <div className="grid gap-1 text-sm">
              <p className="font-semibold">
                Turn on sending <Badge tone="plain">When the log looks right</Badge>
              </p>
              <p className="text-[var(--text-muted)]">
                Tick <b>Send reminders automatically</b> and, once <b>Recent sends</b> looks right in dry run, untick <b>Dry run</b>.
                Tomorrow at {time}, check <b>Recent sends</b> to see it ran.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useSmsTemplates } from "@/hooks/use-sms-templates";
import {
  buildSmsUrl,
  expandTokens,
  type SmsTokenContext,
} from "@/lib/sms-templates";

type Props = {
  phone: string;
  context: SmsTokenContext;
  /** Label shown inside the button. Defaults to the formatted phone. */
  label?: string;
  /** Extra tailwind classes for the button. */
  className?: string;
  /** Optional right-aligned menu instead of left-aligned. */
  align?: "left" | "right";
};

/**
 * Clickable phone → opens a small menu of SMS templates → picks one →
 * launches Messages.app via an `sms:` URL. All sending is manual by
 * design (no Twilio backend); every template click triggers one URL
 * handoff to the native messaging app.
 */
export function SmsSendMenu({
  phone,
  context,
  label,
  className,
  align = "left",
}: Props) {
  const [open, setOpen] = useState(false);
  const { smsTemplates } = useSmsTemplates();
  const { officeSettings } = useOfficeSettings();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const resolvedContext = useMemo<SmsTokenContext>(
    () => ({
      ...context,
      office: {
        officeName: officeSettings.officeName,
        doctorName: officeSettings.doctorName,
      },
    }),
    [context, officeSettings.officeName, officeSettings.doctorName],
  );

  const digits = phone.replace(/\D/g, "");

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    setOpen(false);
  };

  const handlePick = (body: string) => {
    const expanded = expandTokens(body, resolvedContext);
    const url = buildSmsUrl(phone, expanded);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  };

  const displayLabel = label ?? phone;

  if (!digits) {
    return (
      <span className={className}>
        {displayLabel}
      </span>
    );
  }

  return (
    <div
      className="relative inline-block"
      onBlur={handleBlur}
      ref={wrapperRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          className ??
          "text-[var(--brand-primary)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
        }
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {displayLabel}
      </button>
      {open && (
        <div
          className={`absolute top-full z-30 mt-1 min-w-[240px] rounded-xl border border-[var(--line-soft)] bg-white p-2 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          role="menu"
        >
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Send text
          </p>
          {smsTemplates.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
              No templates yet. Add some in Settings → SMS / Text Templates.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {smsTemplates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-soft)]"
                    onClick={() => handlePick(tpl.body)}
                    type="button"
                  >
                    {tpl.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 border-t border-[var(--line-soft)] pt-1">
            <button
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
              onClick={() => handlePick("")}
              type="button"
            >
              Open Messages with blank body
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MessagingSetupEntry } from "@/components/messaging-setup-flow";
import { onLocalChange } from "@/lib/local-sync";
import { messagingSetupComplete } from "@/lib/messaging-setup";
import { normalizeSmsReminderSettings, SMS_REMINDER_SETTINGS_KEY } from "@/lib/sms-reminders";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useDocumentTemplates } from "@/hooks/use-document-templates";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useReportTemplates } from "@/hooks/use-report-templates";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { hasMacroInEverySection } from "@/lib/onboarding";
import { patients } from "@/lib/mock-data";

type Item = {
  id: string;
  label: string;
  done: boolean;
  required: boolean;
  href: string;
};

export function SetupChecklist() {
  const { officeSettings } = useOfficeSettings();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { macroLibrary } = useMacroTemplates();
  const { billingMacros } = useBillingMacros();
  const { contacts } = useContactDirectory();
  const { reportTemplates } = useReportTemplates();
  const { documentTemplates } = useDocumentTemplates();
  const reportTemplateCount = reportTemplates.templates.length;
  const letterTemplateCount = documentTemplates.templates.length;
  const { onboardingState, markComplete } = useOnboarding();
  const [manuallyDismissed, setManuallyDismissed] = useState(false);
  const [messagingDone, setMessagingDone] = useState(false);

  useEffect(() => {
    let cancel = false;
    const read = () => {
      try {
        const saved = normalizeSmsReminderSettings(JSON.parse(window.localStorage.getItem(SMS_REMINDER_SETTINGS_KEY) ?? "null"));
        setMessagingDone((current) => current || messagingSetupComplete(saved.messagingSetup, []));
      } catch {
        setMessagingDone(false);
      }
    };
    read();
    const unsub = onLocalChange(SMS_REMINDER_SETTINGS_KEY, read);
    const client = getSupabaseBrowserClient();
    const workspaceId = getActiveWorkspaceIdSync();
    if (client && workspaceId) {
      void client
        .from("reminder_devices")
        .select("revoked_at, last_seen_at")
        .eq("workspace_id", workspaceId)
        .then(({ data }) => {
          if (cancel || !data) return;
          const saved = normalizeSmsReminderSettings(JSON.parse(window.localStorage.getItem(SMS_REMINDER_SETTINGS_KEY) ?? "null"));
          if (messagingSetupComplete(saved.messagingSetup, data)) setMessagingDone(true);
        })
        .catch(() => undefined);
    }
    return () => {
      cancel = true;
      unsub();
    };
  }, []);

  const items: Item[] = useMemo(() => {
    return [
      {
        id: "office",
        label: "Office info",
        done: officeSettings.officeName.trim().length > 0,
        required: true,
        href: "/settings?section=office",
      },
      {
        id: "appt-types",
        label: "Appointment types",
        done: appointmentTypes.length > 0,
        required: true,
        href: "/settings?section=schedule",
      },
      {
        id: "macros",
        label: "SOAP macros (1 per S/O/A/P section)",
        done: hasMacroInEverySection(macroLibrary.templates),
        required: true,
        href: "/settings?section=soapMacros",
      },
      {
        id: "cpt",
        label: "CPT charges",
        done: billingMacros.treatments.length > 0,
        required: true,
        href: "/settings?section=billingMacros",
      },
      {
        id: "first-patient",
        label: "Add your first patient",
        done: patients.length > 0,
        required: false,
        href: "/patients",
      },
      {
        id: "contact",
        label: "Add a contact (attorney / imaging / specialist)",
        done: contacts.length > 0,
        required: false,
        href: "/settings?section=contactCategories",
      },
      {
        id: "reports",
        label: "Set up report templates (optional)",
        done: reportTemplateCount > 0,
        required: false,
        href: "/settings?section=reports",
      },
      {
        id: "letters",
        label: "Set up letter templates (optional)",
        done: letterTemplateCount > 0,
        required: false,
        href: "/settings?section=documents",
      },
    ];
  }, [
    officeSettings.officeName,
    appointmentTypes.length,
    macroLibrary.templates,
    billingMacros.treatments.length,
    contacts.length,
    reportTemplateCount,
    letterTemplateCount,
  ]);

  const allDone = items.every((item) => item.done);
  const shouldHide =
    manuallyDismissed || allDone || Boolean(onboardingState.completedAt && allDone);
  const messaging = (
    <MessagingSetupEntry complete={messagingDone} href="/settings?section=textReminders" />
  );

  if (shouldHide) return <div data-testid="setup-checklist-messaging">{messaging}</div>;

  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="panel-card p-4" data-testid="setup-checklist">
      <div className="mb-3" data-testid="setup-checklist-messaging">
        {messaging}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Setup checklist</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {doneCount} of {items.length} complete · finish what&apos;s left
            when you have a minute.
          </p>
        </div>
        <button
          className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold text-[var(--text-muted)]"
          onClick={() => {
            setManuallyDismissed(true);
            if (allDone) markComplete();
          }}
          type="button"
        >
          Dismiss
        </button>
      </div>
      <ul className="grid gap-1.5 md:grid-cols-2">
        {items.map((item) => (
          <li
            className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            key={item.id}
          >
            <span className="inline-flex items-center gap-2">
              <span className={item.done ? "text-emerald-600" : "text-[var(--text-muted)]"}>
                {item.done ? "✓" : "○"}
              </span>
              <span className={item.done ? "line-through text-[var(--text-muted)]" : ""}>
                {item.label}
              </span>
            </span>
            {!item.done && (
              <Link
                className="rounded-lg border border-[var(--line-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-primary)]"
                href={item.href}
              >
                Start →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

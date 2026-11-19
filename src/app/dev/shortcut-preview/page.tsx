"use client";

/**
 * Local screenshot page for SMS Templates and Create Shortcut.
 * Demo words only. Nothing here is linked from the app.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreateShortcutSection } from "@/components/create-shortcut-section";
import { SmsTemplatesSection } from "@/components/sms-templates-section";
import { BRAND_STORAGE_KEY, TONE_STORAGE_KEY } from "@/lib/brand";
import { defaultSmsReminderSettings, SMS_REMINDER_SETTINGS_KEY, type SmsReminderSettings } from "@/lib/sms-reminders";
import { SMS_TEMPLATES_STORAGE_KEY, type SmsTemplate } from "@/lib/sms-templates";
import { shortcutName, withRules, type ShortcutRun } from "@/lib/text-rules";

const NOW = "2026-11-01T12:00:00.000Z";

const TEMPLATES: SmsTemplate[] = [
  { id: "SMS-auto-birthday", name: "Birthday", body: "Happy birthday, {first name}!", createdAt: NOW, updatedAt: NOW },
  { id: "SMS-auto-reminder", name: "Appointment reminder", body: "Hi {first name}, your visit is at {appt time}.", createdAt: NOW, updatedAt: NOW },
];

function demoSettings(): SmsReminderSettings {
  const birthday = { id: "birthday", templateId: "SMS-auto-birthday", on: true, kind: "birthday" as const, hour: 9 };
  const visits = { id: "visits", templateId: "SMS-auto-reminder", on: true, kind: "day-before" as const, hour: 8 };
  return withRules(defaultSmsReminderSettings(), [
    { ...birthday, shortcutName: shortcutName(birthday) },
    { ...visits, shortcutName: shortcutName(visits) },
  ]);
}

const RUNS: Record<string, ShortcutRun> = {
  birthday: { at: "2026-11-18T17:05:00Z", status: "ok", summary: "2 birthday texts" },
  visits: { at: "2026-11-18T16:02:00Z", status: "error", summary: "Did not send" },
};

function Preview() {
  const params = useSearchParams();
  const view = params.get("view") ?? "list";
  const step = view === "choose" ? "template" : view === "when" || view === "steps" || view === "list" ? view : "list";
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<SmsReminderSettings>(() => demoSettings());
  if (typeof window !== "undefined" && !ready) {
    window.localStorage.setItem(SMS_TEMPLATES_STORAGE_KEY, JSON.stringify(TEMPLATES));
    window.localStorage.setItem(SMS_REMINDER_SETTINGS_KEY, JSON.stringify(demoSettings()));
    window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ theme: "blue" }));
    window.localStorage.setItem(TONE_STORAGE_KEY, "dark");
    const root = document.documentElement;
    root.setAttribute("data-brand", "blue");
    root.setAttribute("data-tone", "dark");
    root.setAttribute("data-theme-lock", "1");
    setReady(true);
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] px-4 py-6 text-[var(--text-main)]">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        {view === "templates" ? (
          <SmsTemplatesSection initialOpenId="SMS-auto-reminder" onToggle={() => {}} open settings={settings} />
        ) : (
          <CreateShortcutSection
            devices={[]}
            forcedStep={step === "list" ? "list" : step}
            messages={TEMPLATES}
            onToggle={() => {}}
            open
            runs={RUNS}
            settings={settings}
            update={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            workspaceId=""
          />
        )}
      </div>
    </div>
  );
}

export default function ShortcutPreviewPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

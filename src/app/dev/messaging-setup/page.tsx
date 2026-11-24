"use client";

/**
 * Local screenshot page for the guided Reminders and Messaging setup.
 * Demo words only. Nothing here is linked from the app.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessagingSetupEntry, MessagingSetupFlow } from "@/components/messaging-setup-flow";
import { BRAND_STORAGE_KEY, TONE_STORAGE_KEY } from "@/lib/brand";
import { defaultSmsReminderSettings, type SmsReminderSettings } from "@/lib/sms-reminders";
import type { SmsTemplate } from "@/lib/sms-template-core";
import { shortcutName, withRules } from "@/lib/text-rules";

const NOW = "2026-11-01T12:00:00.000Z";

const TEMPLATES: SmsTemplate[] = [
  { id: "visits", name: "Appointment reminder", body: "Hi {first name}, your visit is at {appt time}.", createdAt: NOW, updatedAt: NOW },
  { id: "birthday", name: "Birthday", body: "Happy birthday, {first name}!", createdAt: NOW, updatedAt: NOW },
];

function demoSettings(): SmsReminderSettings {
  const visits = { id: "visits", templateId: "visits", on: true, kind: "day-before" as const, hour: 8 };
  const birthday = { id: "birthday", templateId: "birthday", on: true, kind: "birthday" as const, hour: 9 };
  return withRules(defaultSmsReminderSettings(), [
    { ...visits, shortcutName: shortcutName(visits) },
    { ...birthday, shortcutName: shortcutName(birthday) },
  ]);
}

function Preview() {
  const params = useSearchParams();
  const view = params.get("view") ?? "entry";
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<SmsReminderSettings>(() => demoSettings());
  useEffect(() => {
    window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ theme: "blue" }));
    window.localStorage.setItem(TONE_STORAGE_KEY, "light");
    const root = document.documentElement;
    root.setAttribute("data-brand", "blue");
    root.setAttribute("data-tone", "light");
    root.setAttribute("data-theme-lock", "1");
    setReady(true);
  }, []);
  if (!ready) return null;

  const platform = view === "mac" ? "mac" : "iphone";
  const stepId =
    view === "device" ? "device" : view === "iphone" || view === "mac" ? "automation:visits" : view === "test" ? "test" : "device";

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] px-4 py-6 text-[var(--text-main)]">
      <style>{`nextjs-portal{display:none !important}`}</style>
      <div className="mx-auto grid w-full max-w-xl gap-5">
        {view === "entry" || view === "redo" ? (
          <MessagingSetupEntry complete={view === "redo"} onStart={() => {}} />
        ) : (
          <MessagingSetupFlow
            devices={[]}
            forced={{ platform, stepId, ruleIds: ["visits", "birthday"], seen: view === "test" && params.get("seen") === "1" }}
            messages={TEMPLATES}
            onClose={() => {}}
            settings={settings}
            update={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            workspaceId=""
          />
        )}
      </div>
    </div>
  );
}

export default function MessagingSetupPreviewPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

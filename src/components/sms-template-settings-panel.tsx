"use client";

import { MessagesLibraryPanel } from "@/components/messages-library-panel";

/**
 * Settings → SMS / Text Templates. The same Messages library that lives in
 * Text Reminders → Messages (one list, one place it is saved).
 */
export function SmsTemplateSettingsPanel() {
  return <MessagesLibraryPanel />;
}

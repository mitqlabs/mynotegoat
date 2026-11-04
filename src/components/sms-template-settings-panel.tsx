"use client";

import { MessagesLibraryPanel } from "@/components/messages-library-panel";

/**
 * Settings → SMS / Text Templates. The same Messages library that lives in
 * the one place to add, edit or delete saved text messages (Auto Texts picks from it).
 */
export function SmsTemplateSettingsPanel() {
  return <MessagesLibraryPanel />;
}

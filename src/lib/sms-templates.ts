"use client";

import type { OfficeSettings } from "@/lib/office-settings";
import { isBlankStarterWorkspace } from "@/lib/workspace-starter";

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type { SmsTokenContext } from "@/lib/sms-render";
import type { SmsTokenContext } from "@/lib/sms-render";
export { expandTokens } from "@/lib/sms-render";

export const SMS_TEMPLATES_STORAGE_KEY = "casemate.sms-templates.v1";

/** Reminder text for practices that existed before the blank starter
 *  (kept word for word so nothing changes for them). */
export const LEGACY_REMINDER_BODY =
  "Hello {{FIRST_NAME}}, just wanted to send over a reminder for your appointment on {{APPT_DATE}} at {{TIME}}. For any questions feel free to contact us! Thank you!\n\n-Prime Spine & Wellness";

/** Reminder text for new practices: signed with their own office name. */
export const NEUTRAL_REMINDER_BODY =
  "Hello {{FIRST_NAME}}, just wanted to send over a reminder for your appointment on {{APPT_DATE}} at {{TIME}}. For any questions feel free to contact us! Thank you!\n\n-{{OFFICE_NAME}}";

/** Built-in appointment reminder text for this workspace. */
export function getDefaultReminderBody(): string {
  return isBlankStarterWorkspace() ? NEUTRAL_REMINDER_BODY : LEGACY_REMINDER_BODY;
}

/**
 * Placeholders shown in the UI. {{DATE}} (old alias of {{APPT_DATE}}) and
 * {{APPOINTMENT_TYPE}} still render for old templates but aren't offered.
 */
export const SMS_TOKENS: { token: string; label: string; description: string }[] = [
  { token: "{{FIRST_NAME}}", label: "First name", description: "Patient first name" },
  { token: "{{LAST_NAME}}", label: "Last name", description: "Patient last name" },
  { token: "{{FULL_NAME}}", label: "Full name", description: "Patient full name" },
  { token: "{{APPT_DATE}}", label: "Appointment date", description: "Appointment date, e.g. 10/19/2026" },
  { token: "{{TIME}}", label: "Appointment time", description: "Appointment time, e.g. 10:30 AM" },
  { token: "{{TODAY}}", label: "Today's date", description: "The date the text is sent, e.g. 10/18/2026" },
  { token: "{{OFFICE_NAME}}", label: "Office name", description: "Office name from settings" },
  { token: "{{DOCTOR_NAME}}", label: "Doctor name", description: "Doctor name from settings" },
  { token: "{{OFFICE_PHONE}}", label: "Office phone", description: "Office phone (the patient's office when you have several)" },
];

function createId() {
  return `SMS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Starter skeletons. Bodies are deliberately short stubs the user fills in —
 * per the handoff brief we do NOT ship preset content, because anything we
 * hardcode becomes PII/brand leakage across accounts.
 */
export function getDefaultSmsTemplates(): SmsTemplate[] {
  const created = nowIso();
  const mk = (name: string, body: string): SmsTemplate => ({
    id: createId(),
    name,
    body,
    createdAt: created,
    updatedAt: created,
  });
  return [
    mk("🎂 Birthday", "Happy birthday, {{FIRST_NAME}}!"),
    mk("⏰ Appointment Reminder", getDefaultReminderBody()),
    mk("✅ Records Received", "Hi {{FIRST_NAME}}, we've received your records."),
    mk("🗓️ Follow-Up", "Hi {{FIRST_NAME}}, following up on your last visit."),
    mk("💳 Payment Due", "Hi {{FIRST_NAME}}, this is a reminder about your outstanding balance."),
  ];
}

function normalizeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeTemplate(value: unknown): SmsTemplate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SmsTemplate>;
  const id = normalizeText(row.id).trim();
  const name = normalizeText(row.name).trim();
  if (!id || !name) return null;
  const body = normalizeText(row.body);
  const createdAt = normalizeText(row.createdAt) || nowIso();
  const updatedAt = normalizeText(row.updatedAt) || createdAt;
  return { id, name, body, createdAt, updatedAt };
}

export function normalizeSmsTemplates(value: unknown): SmsTemplate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeTemplate(entry))
    .filter((entry): entry is SmsTemplate => Boolean(entry));
}

export function loadSmsTemplates(): SmsTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SMS_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    return normalizeSmsTemplates(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveSmsTemplates(rows: SmsTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SMS_TEMPLATES_STORAGE_KEY, JSON.stringify(rows));
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(SMS_TEMPLATES_STORAGE_KEY, "tasks", rows),
  );
}

export function createSmsTemplate(name: string, body = ""): SmsTemplate {
  const iso = nowIso();
  return {
    id: createId(),
    name: name.trim() || "Untitled",
    body,
    createdAt: iso,
    updatedAt: iso,
  };
}

/**
 * Build the sms: URL that iMessage / Messages.app on macOS and iOS will
 * honor. iMessage recognizes `sms:<number>?body=<urlencoded>` — the
 * number is digits-only (tel: sanitization).
 */
export function buildSmsUrl(phone: string, body: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const encodedBody = encodeURIComponent(body);
  if (!digits) return `sms:?body=${encodedBody}`;
  return `sms:+1${digits}?body=${encodedBody}`;
}

/**
 * Example context for the template editor's "preview with example data"
 * button. Kept fully generic — no hardcoded doctor/office names so this
 * never leaks between tenants.
 */
export function getExamplePreviewContext(
  office: Pick<OfficeSettings, "officeName" | "doctorName">,
): SmsTokenContext {
  return {
    patient: { firstName: "Jane", lastName: "Doe", fullName: "Jane Doe" },
    appointment: {
      time: "10:30 AM",
      date: "04/20/2026",
      type: "Office Visit",
    },
    office,
  };
}

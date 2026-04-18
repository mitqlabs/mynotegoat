"use client";

import type { OfficeSettings } from "@/lib/office-settings";

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmsTokenContext {
  patient?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
  appointment?: {
    time?: string; // e.g. "10:30 AM"
    date?: string; // e.g. "04/17/2026"
    type?: string;
  };
  office?: Pick<OfficeSettings, "officeName" | "doctorName">;
}

export const SMS_TEMPLATES_STORAGE_KEY = "casemate.sms-templates.v1";

export const SMS_TOKENS: { token: string; description: string }[] = [
  { token: "{{FIRST_NAME}}", description: "Patient first name" },
  { token: "{{LAST_NAME}}", description: "Patient last name" },
  { token: "{{FULL_NAME}}", description: "Patient full name" },
  { token: "{{TIME}}", description: "Appointment time (if applicable)" },
  { token: "{{DATE}}", description: "Appointment date (if applicable)" },
  { token: "{{APPOINTMENT_TYPE}}", description: "Appointment type" },
  { token: "{{OFFICE_NAME}}", description: "Office name from settings" },
  { token: "{{DOCTOR_NAME}}", description: "Doctor name from settings" },
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
    mk("⏰ Appointment Reminder", "Hi {{FIRST_NAME}}, this is a reminder of your appointment on {{DATE}} at {{TIME}}."),
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

export function expandTokens(body: string, ctx: SmsTokenContext): string {
  const first = ctx.patient?.firstName ?? "";
  const last = ctx.patient?.lastName ?? "";
  const full =
    ctx.patient?.fullName ??
    [first, last].filter(Boolean).join(" ");
  const map: Record<string, string> = {
    "{{FIRST_NAME}}": first,
    "{{LAST_NAME}}": last,
    "{{FULL_NAME}}": full,
    "{{TIME}}": ctx.appointment?.time ?? "",
    "{{DATE}}": ctx.appointment?.date ?? "",
    "{{APPOINTMENT_TYPE}}": ctx.appointment?.type ?? "",
    "{{OFFICE_NAME}}": ctx.office?.officeName ?? "",
    "{{DOCTOR_NAME}}": ctx.office?.doctorName ?? "",
  };
  return body.replace(/\{\{[A-Z_]+\}\}/g, (tok) =>
    Object.prototype.hasOwnProperty.call(map, tok) ? map[tok] : tok,
  );
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

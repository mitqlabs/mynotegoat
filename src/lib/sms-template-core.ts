/**
 * Pure (no "use client") message-library pieces, so the server queue and the
 * browser read saved messages exactly the same way.
 */

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Deleted messages stay as a marker so the delete syncs to every computer. Never shown. */
  deleted?: boolean;
}

/** Built-in appointment reminder text. */
export const DEFAULT_REMINDER_BODY =
  "Hello {{FIRST_NAME}}, just wanted to send over a reminder for your appointment on {{APPT_DATE}} at {{TIME}}. For any questions feel free to contact us! Thank you!\n\n-Prime Spine & Wellness";

function nowIso() {
  return new Date().toISOString();
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
  return row.deleted === true ? { id, name, body, createdAt, updatedAt, deleted: true } : { id, name, body, createdAt, updatedAt };
}

export function normalizeSmsTemplates(value: unknown): SmsTemplate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeTemplate(entry))
    .filter((entry): entry is SmsTemplate => Boolean(entry));
}


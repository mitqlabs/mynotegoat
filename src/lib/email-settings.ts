const STORAGE_KEY = "casemate.email-settings.v1";

export interface EmailSettings {
  /** Template for the email subject. Use {{FIELD}} placeholders. */
  subjectTemplate: string;
  /** Template for the email body. Use {{FIELD}} placeholders. */
  bodyTemplate: string;
}

export const emailAutoFieldLabels = {
  FILE_NAME: "File name",
  FIRST_NAME: "Patient first name",
  LAST_NAME: "Patient last name",
  FULL_NAME: "Patient full name",
  MR_MRS_MS_LAST_NAME: "Mr./Mrs./Ms. Last name",
  MR_MRS_MS_FULL_NAME: "Mr./Mrs./Ms. Full name",
  DOB: "Date of birth",
  INJURY_DATE: "Date of injury",
  OFFICE_NAME: "Office name",
  TODAY: "Today's date",
} as const;

export type EmailAutoField = keyof typeof emailAutoFieldLabels;
export const emailAutoFields = Object.keys(emailAutoFieldLabels) as EmailAutoField[];

export type EmailRenderContext = Partial<Record<EmailAutoField, string>>;

export function getDefaultEmailSettings(): EmailSettings {
  return {
    subjectTemplate: "{{FILE_NAME}}",
    bodyTemplate:
      "Please find the attached file: {{FILE_NAME}}\n\n(The file has been downloaded to your device — please attach it to this email.)",
  };
}

export function renderEmailTemplate(template: string, context: EmailRenderContext): string {
  return template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_, key: string) => {
    return (context as Record<string, string | undefined>)[key] ?? "";
  });
}

function normalize(value: unknown): EmailSettings {
  const defaults = getDefaultEmailSettings();
  if (!value || typeof value !== "object") return defaults;
  const row = value as Partial<EmailSettings>;
  return {
    subjectTemplate:
      typeof row.subjectTemplate === "string"
        ? row.subjectTemplate
        : defaults.subjectTemplate,
    bodyTemplate:
      typeof row.bodyTemplate === "string"
        ? row.bodyTemplate
        : defaults.bodyTemplate,
  };
}

export function loadEmailSettings(): EmailSettings {
  if (typeof window === "undefined") return getDefaultEmailSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultEmailSettings();
    return normalize(JSON.parse(raw));
  } catch {
    return getDefaultEmailSettings();
  }
}

export function saveEmailSettings(settings: EmailSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

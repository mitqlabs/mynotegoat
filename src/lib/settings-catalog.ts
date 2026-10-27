/**
 * Settings sections and the words people use for them. Shared by the Settings
 * page search and G.O.A.T. ("where do I change office hours?").
 * Each section opens with /settings?section=<key>.
 */
export type SettingsSectionKey =
  // "officeSettings" is the new top-level wrapper that nests Office
  // Information, Schedule, Reminders, Case Status Categories, and
  // Patient Page Sections. Same wrapper pattern as Admin / Templates
  // / Macros. Children keep their own state + ?section= keys.
  | "officeSettings"
  | "office"
  | "contactCategories"
  | "schedule"
  | "dashboard"
  | "caseStatuses"
  // "patientPage" hosts patient-page UI prefs — currently just the
  // "Default Open Sections" checkboxes.
  | "patientPage"
  // "macros" is the outer wrapper for SOAP Macros, Billing Macros,
  // and Package Builder. Each child keeps its own state + deep link.
  | "macros"
  | "soapMacros"
  | "billingMacros"
  | "packageBuilder"
  // "templates" is the outer wrapper for the three template-y subsections
  // (Document Templates, SMS Templates, Email Settings). Same pattern
  // as "admin" — child keys keep their own state + deep links.
  | "templates"
  | "documents"
  | "reports"
  | "smsTemplates"
  // Patient questionnaires (Send form on the patient file).
  | "forms"
  | "textReminders"
  | "emailSettings"
  // "admin" is the outer wrapper that nests the five admin-y subsections
  // (diagnostics, backup, recovery, security, subscription). Those child
  // keys still exist so each subsection's own expanded state, ?section=
  // deep links, and reset buttons keep working exactly as before — the
  // refactor is purely a visual / scroll-length improvement.
  | "admin"
  | "adminAccess"
  | "subscription"
  | "backup"
  | "recovery"
  | "security"
  | "account"
  | "diagnostics"
  // G.O.A.T. words & abbreviations — the editor lives on /settings/goat.
  | "goat";

export const settingsSearchCatalog: Array<{
  key: SettingsSectionKey;
  title: string;
  description?: string;
  aliases?: string[];
  parent?: SettingsSectionKey;
}> = [
  // Office Settings wrapper + children
  {
    key: "officeSettings",
    title: "Office Settings",
    description: "Office info, schedule, reminders, case status, patient page",
  },
  // Top-level groups
  {
    key: "schedule",
    title: "Schedule",
    description: "appointment statuses, office hours, intervals",
    aliases: ["appointment", "appointments", "office hours", "interval", "weekday", "slot", "room", "schedule settings"],
    parent: "officeSettings",
  },
  {
    key: "dashboard",
    title: "Reminders",
    description: "Case Flow rules, To Do preferences, follow-up rules",
    aliases: [
      "case flow",
      "todo",
      "to do",
      "reminder",
      "reminders",
      "reminder settings",
      "follow up",
      "follow-up",
      "priority",
      "mri due",
      "x-ray",
      "xray",
      "specialist appear",
      "warn",
      "grace period",
      "cleared from case flow",
    ],
    parent: "officeSettings",
  },
  {
    key: "caseStatuses",
    title: "Case Status Categories",
    aliases: [
      "compliance",
      "compliance column",
      "status",
      "case status",
      "lien",
      "lop",
      "review",
      "review options",
      "case closed",
      "active",
      "discharged",
      "submitted",
      "paid",
      "dropped",
      "auto folder",
    ],
    parent: "officeSettings",
  },
  {
    key: "patientPage",
    title: "Patient Page Sections",
    description: "Which sections start open when you visit a patient file",
    aliases: [
      "default open",
      "start open",
      "auto open",
      "always open",
      "notes",
      "notes always open",
      "panel",
      "expand",
      "collapse",
      "patient page",
      "patient file",
      "section",
    ],
    parent: "officeSettings",
  },
  {
    key: "goat",
    title: "G.O.A.T.",
    description: "Words, abbreviations and synonym groups G.O.A.T. uses",
    aliases: ["goat", "g.o.a.t.", "ask", "abbreviation", "abbreviations", "synonym", "synonyms", "words", "terms", "rom", "pm", "pain management"],
  },
  // Macros wrapper + children
  { key: "macros", title: "Macros" },
  {
    key: "soapMacros",
    title: "SOAP Macro Settings",
    aliases: ["subjective", "objective", "assessment", "plan", "macro", "soap", "prompt", "salt"],
    parent: "macros",
  },
  {
    key: "billingMacros",
    title: "Billing Macro Settings",
    aliases: [
      "treatment",
      "treatments",
      "diagnosis",
      "diagnoses",
      "dx",
      "bundle",
      "bundles",
      "cpt",
      "icd",
      "billing macros",
      "folder",
    ],
    parent: "macros",
  },
  {
    key: "packageBuilder",
    title: "Package Builder",
    aliases: ["cash", "package", "packages", "visits", "discount"],
    parent: "macros",
  },
  // Templates wrapper + children
  { key: "templates", title: "Templates" },
  {
    key: "contactCategories",
    title: "Contact Categories",
    aliases: [
      "attorney",
      "attorneys",
      "imaging center",
      "specialist",
      "acute care",
      "hospital",
      "urgent care",
      "sub-category",
      "sub-categories",
      "subcategory",
      "subcategories",
      "contact",
      "contacts",
    ],
    parent: "templates",
  },
  {
    key: "documents",
    title: "Document Templates",
    description: "letters, referrals, imaging requests, narrative reports",
    aliases: [
      "letter",
      "letters",
      "referral",
      "referrals",
      "imaging request",
      "narrative",
      "narrative report",
      "report template",
      "report templates",
      "pdf",
      "print",
    ],
    parent: "templates",
  },
  {
    key: "smsTemplates",
    title: "SMS / Text Templates",
    aliases: ["sms", "text", "text message", "messages", "imessage"],
    parent: "templates",
  },
  {
    key: "forms",
    title: "Forms (patient questionnaires)",
    description: "Questionnaires you text or email to a patient, built from your Objective macros.",
    aliases: ["form", "forms", "questionnaire", "intake", "new patient questionnaire", "send form", "patient form", "survey"],
    parent: "templates",
  },
  {
    key: "textReminders",
    title: "Text Reminders",
    aliases: ["reminder", "appointment reminder", "automatic text", "imac", "mac", "sms", "24 hour"],
    parent: "templates",
  },
  {
    key: "emailSettings",
    title: "Email Settings",
    aliases: ["email", "send", "subject", "token", "outlook", "gmail"],
    parent: "templates",
  },
  // Admin wrapper + children
  { key: "admin", title: "Admin" },
  {
    key: "office",
    title: "Office Information",
    aliases: [
      "logo",
      "fax",
      "phone",
      "email",
      "address",
      "delete password",
      "change password",
      "doctor",
      "doctor name",
      "office",
      "office name",
      "case number",
      "case number format",
      "case #",
      "account",
      "password",
      "office account settings",
    ],
    parent: "officeSettings",
  },
  {
    key: "adminAccess",
    title: "Admin Access",
    description: "Roles, what Managers can see and delete, and the delete password.",
    aliases: ["role", "roles", "manager", "admin", "permission", "permissions", "delete password", "access"],
  },
  {
    key: "diagnostics",
    title: "Diagnostics",
    aliases: ["cloud", "row count", "local storage", "debug", "diagnostic"],
    parent: "admin",
  },
  {
    key: "backup",
    title: "Backup & Restore",
    aliases: ["backup", "export", "import"],
    parent: "admin",
  },
  {
    key: "recovery",
    title: "Data Recovery",
    aliases: ["recover", "snapshot", "restore"],
    parent: "admin",
  },
  {
    key: "security",
    title: "Security Baseline",
    aliases: ["security", "checklist", "hipaa", "phi"],
    parent: "admin",
  },
  {
    key: "subscription",
    title: "Subscription",
    aliases: ["plan", "billing", "stripe", "payment", "subscribe", "credit card"],
    parent: "admin",
  },
];

export const GOAT_SETTINGS_PAGE = { key: "goatPage", title: "G.O.A.T. Settings (answers, words)", href: "/settings/goat" } as const;

export function settingsHref(key: SettingsSectionKey): string {
  return key === "goat" ? "/settings/goat" : `/settings?section=${key}`;
}

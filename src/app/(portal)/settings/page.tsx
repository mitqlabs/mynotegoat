"use client";

import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { hasSafetyBackup, recoverFromRemote, restoreFromSafetyBackup } from "@/lib/cloud-state";
import { forceSyncNow } from "@/lib/storage-sync-interceptor";
import { BillingMacroSettingsPanel } from "@/components/billing-macro-settings-panel";
import { DocumentTemplateSettingsPanel } from "@/components/document-template-settings-panel";
import { MacroSettingsPanel } from "@/components/macro-settings-panel";
import { PackageBuilderSettingsPanel } from "@/components/package-builder-settings-panel";
import { ReportTemplateSettingsPanel } from "@/components/report-template-settings-panel";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useContactCategories } from "@/hooks/use-contact-categories";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useQuickStatsSettings } from "@/hooks/use-quick-stats-settings";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { usePriorityCaseRules } from "@/hooks/use-priority-case-rules";
import { useDashboardWorkspaceSettings } from "@/hooks/use-dashboard-workspace-settings";
import { useEmailSettings } from "@/hooks/use-email-settings";
import { getDefaultEmailSettings, emailAutoFields, emailAutoFieldLabels, type EmailAutoField } from "@/lib/email-settings";
import { quickStatOptions } from "@/lib/quick-stats-settings";
import { appointmentStatusOptions, formatAppointmentStatusLabel } from "@/lib/schedule-appointments";
import { formatDurationMinutes } from "@/lib/schedule-appointment-types";
import { appointmentIntervalOptions, weekdayLabels } from "@/lib/schedule-settings";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { PATIENTS_STORAGE_KEY } from "@/lib/mock-data";
import type { DocumentTemplateScope } from "@/lib/document-templates";

type SettingsSectionKey =
  | "office"
  | "contactCategories"
  | "schedule"
  | "dashboard"
  | "quickStats"
  | "caseStatuses"
  | "soapMacros"
  | "billingMacros"
  | "packageBuilder"
  | "documents"
  | "reports"
  | "emailSettings"
  | "subscription"
  | "backup"
  | "recovery"
  | "security"
  | "account"
  | "diagnostics";

const defaultExpandedSections: Record<SettingsSectionKey, boolean> = {
  office: false,
  contactCategories: false,
  schedule: false,
  dashboard: false,
  quickStats: false,
  caseStatuses: false,
  soapMacros: false,
  billingMacros: false,
  packageBuilder: false,
  documents: false,
  reports: false,
  emailSettings: false,
  subscription: false,
  backup: false,
  recovery: false,
  security: false,
  account: false,
  diagnostics: false,
};

type BackupModuleId =
  | "officeSettings"
  | "contactCategories"
  | "contacts"
  | "patients"
  | "caseStatuses"
  | "dashboardRules"
  | "quickStats"
  | "scheduleSettings"
  | "roomSettings"
  | "appointmentTypes"
  | "keyDates"
  | "soapMacros"
  | "billingMacros"
  | "packageBuilder"
  | "documentTemplates"
  | "reportTemplates"
  | "appointments"
  | "encounters"
  | "patientDiagnoses"
  | "patientBilling";

type BackupModuleDefinition = {
  id: BackupModuleId;
  label: string;
  description: string;
  keys: string[];
};

const backupModules: BackupModuleDefinition[] = [
  {
    id: "officeSettings",
    label: "Office Settings",
    description: "Office name/contact/address/logo",
    keys: ["casemate.office-settings.v1"],
  },
  {
    id: "contactCategories",
    label: "Contact Categories",
    description: "Attorney, Imaging, Ortho, etc.",
    keys: ["casemate.contact-categories.v1"],
  },
  {
    id: "contacts",
    label: "Contacts",
    description: "Attorney/specialist/imaging contacts",
    keys: ["casemate.contact-directory.v1"],
  },
  {
    id: "patients",
    label: "Patients",
    description: "Patient demographics, case status, and case-matrix details",
    keys: [PATIENTS_STORAGE_KEY],
  },
  {
    id: "caseStatuses",
    label: "Case Statuses + Lien/LOP",
    description: "Statuses, colors, Lien/LOP label and options",
    keys: ["casemate.case-statuses.v1"],
  },
  {
    id: "dashboardRules",
    label: "Dashboard Priority Rules",
    description:
      "Priority status and warning thresholds, tasks, follow-up workspace display settings, and follow-up clear overrides",
    keys: [
      "casemate.dashboard-priority-rules.v1",
      "casemate.dashboard-workspace-settings.v1",
      "casemate.patient-follow-up-overrides.v1",
    ],
  },
  {
    id: "quickStats",
    label: "Quick Stats Settings",
    description: "Patient-file quick stats visibility options",
    keys: ["casemate.quick-stats-settings.v1"],
  },
  {
    id: "scheduleSettings",
    label: "Schedule Settings",
    description: "Office hours, interval, max slot capacity",
    keys: ["casemate.schedule-settings.v1"],
  },
  {
    id: "roomSettings",
    label: "Room Settings",
    description: "Rooms, colors, and check-in room picker toggle",
    keys: ["casemate.schedule-rooms.v1"],
  },
  {
    id: "appointmentTypes",
    label: "Appointment Types",
    description: "Type names, colors, default duration",
    keys: ["casemate.schedule-appointment-types.v1"],
  },
  {
    id: "keyDates",
    label: "Key Dates",
    description: "Closed/covered key date entries",
    keys: ["casemate.key-dates.v1"],
  },
  {
    id: "soapMacros",
    label: "SOAP Macro Settings",
    description: "SOAP macro library (buttons/questions/templates)",
    keys: ["casemate.macro-library.v1", "casemate.soap-macros.v1"],
  },
  {
    id: "billingMacros",
    label: "Billing Macro Settings",
    description: "Treatment macros, diagnosis codes, bundles",
    keys: ["casemate.billing-macros.v1"],
  },
  {
    id: "packageBuilder",
    label: "Package Builder",
    description: "Cash package definitions using treatment macros and visit counts",
    keys: ["casemate.billing-macros.v1"],
  },
  {
    id: "documentTemplates",
    label: "Document Templates",
    description: "Specialist/Imaging/Letter templates + shared header",
    keys: ["casemate.document-templates.v1"],
  },
  {
    id: "reportTemplates",
    label: "Narrative Report Templates",
    description: "Custom long-form report templates + prompt fields",
    keys: ["casemate.report-templates.v1"],
  },
  {
    id: "appointments",
    label: "Schedule Appointments",
    description: "Booked appointments and recurring schedule items",
    keys: ["casemate.schedule-appointments.v1"],
  },
  {
    id: "encounters",
    label: "Encounter Notes",
    description: "Encounter SOAP notes, charges, macro runs",
    keys: ["casemate.encounter-notes.v1"],
  },
  {
    id: "patientDiagnoses",
    label: "Patient Diagnoses",
    description: "Patient-level diagnosis entries",
    keys: ["casemate.patient-diagnoses.v1"],
  },
  {
    id: "patientBilling",
    label: "Patient Billing Close-Out",
    description: "Billed amount, paid amount/date, named adjustments and balances",
    keys: ["casemate.patient-billing.v1"],
  },
];

type BackupPayload = {
  app: string;
  format: "notegoat-backup";
  version: number;
  exportedAt: string;
  modules: BackupModuleId[];
  data: Record<string, unknown>;
};

type ParsedImportPayload = {
  data: Record<string, unknown>;
  source: "backup" | "legacy";
};

function isSettingsSectionKey(value: string): value is SettingsSectionKey {
  return Object.prototype.hasOwnProperty.call(defaultExpandedSections, value);
}

function parseDocumentTemplateScope(value: string | null): DocumentTemplateScope | null {
  if (
    value === "specialistReferral" ||
    value === "imagingRequest" ||
    value === "generalLetter"
  ) {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStorageKey(key: string): string {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token && !/^v\d+$/.test(token))
    .join("");
}

const CONTACT_DIRECTORY_STORAGE_KEY = "casemate.contact-directory.v1";
const KEY_DATES_STORAGE_KEY = "casemate.key-dates.v1";

type LegacyAttorneyContact = {
  name: string;
  phone: string;
};

function cleanText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return "";
}

function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) {
    return "";
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const isoDateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDateTimeMatch) {
    return `${isoDateTimeMatch[1]}-${isoDateTimeMatch[2]}-${isoDateTimeMatch[3]}`;
  }

  const usDateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usDateMatch) {
    const year = usDateMatch[3].length === 2 ? `20${usDateMatch[3]}` : usDateMatch[3];
    return `${year}-${usDateMatch[1].padStart(2, "0")}-${usDateMatch[2].padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function normalizeLegacyFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildLegacyFieldMap(row: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => {
    const normalizedKey = normalizeLegacyFieldName(key);
    if (!normalizedKey || map.has(normalizedKey)) {
      return;
    }
    map.set(normalizedKey, value);
  });
  return map;
}

function readLegacyField(fieldMap: Map<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = fieldMap.get(normalizeLegacyFieldName(alias));
    const clean = cleanText(value);
    if (clean) {
      return clean;
    }
  }
  return "";
}

function toLegacyArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Array.isArray(value.items)) {
    return value.items;
  }
  if (Array.isArray(value.rows)) {
    return value.rows;
  }
  const entries = Object.values(value);
  if (entries.length > 0 && entries.every((entry) => isRecord(entry))) {
    return entries;
  }
  return null;
}

function parseLegacyEntryList(entries: unknown[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  entries.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }
    const sourceKey = [entry.key, entry.storageKey, entry.name, entry.id].find(
      (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
    );
    if (!sourceKey || typeof sourceKey !== "string") {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(entry, "value")) {
      data[sourceKey] = entry.value;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(entry, "data")) {
      data[sourceKey] = entry.data;
    }
  });
  return data;
}

function findLegacyCollection(source: Record<string, unknown>, aliases: string[]): unknown[] | null {
  const normalizedKeyMap = new Map<string, string>();
  Object.keys(source).forEach((key) => {
    const normalized = normalizeLegacyFieldName(key);
    if (!normalizedKeyMap.has(normalized)) {
      normalizedKeyMap.set(normalized, key);
    }
  });

  for (const alias of aliases) {
    const matchingKey = normalizedKeyMap.get(normalizeLegacyFieldName(alias));
    if (!matchingKey) {
      continue;
    }
    const collection = toLegacyArray(source[matchingKey]);
    if (collection && collection.length > 0) {
      return collection;
    }
  }

  return null;
}

function mapLegacyCaseStatus(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "discharged") {
    return "Discharged";
  }
  if (normalized === "ready to submit" || normalized === "readytosubmit") {
    return "Ready To Submit";
  }
  if (normalized === "submitted") {
    return "Submitted";
  }
  if (normalized === "dropped") {
    return "Dropped";
  }
  if (normalized === "paid") {
    return "Paid";
  }
  return "Active";
}

function mapLegacyPatients(rows: unknown[]) {
  const patients: Record<string, unknown>[] = [];
  const attorneyContacts: LegacyAttorneyContact[] = [];
  const fallbackDate = new Date().toISOString().slice(0, 10);

  rows.forEach((entry, index) => {
    if (!isRecord(entry)) {
      return;
    }

    const fields = buildLegacyFieldMap(entry);
    const lastName = readLegacyField(fields, ["patient last name", "last name", "lastname"]);
    const firstName = readLegacyField(fields, ["patient first name", "first name", "firstname"]);
    const explicitName = readLegacyField(fields, ["patient name", "full name", "fullname", "name"]);
    const fullName = [lastName, firstName].filter(Boolean).join(", ") || explicitName;
    if (!fullName) {
      return;
    }

    const attorney = readLegacyField(fields, ["attorney", "attorney name", "law firm"]) || "Self";
    const attorneyPhone = readLegacyField(fields, [
      "attorney phone",
      "attorney phone number",
      "attorney tel",
      "law firm phone",
    ]);
    if (attorney && attorney !== "Self" && attorneyPhone) {
      attorneyContacts.push({ name: attorney, phone: attorneyPhone });
    }

    const patientPhone = readLegacyField(fields, ["patient phone", "phone", "phone number", "mobile"]);
    const patientEmail = readLegacyField(fields, ["patient email", "email"]);
    const dateOfLossRaw = readLegacyField(fields, ["date of loss", "date of injury", "dol", "injury date"]);
    const initialExamRaw = readLegacyField(fields, ["initial exam date", "initial exam", "first visit date"]);
    const xrayInfo = readLegacyField(fields, ["x-ray information", "xray information", "xray info", "x-ray info"]);
    const mriInfo = readLegacyField(fields, ["mri information", "mri info"]);
    const specialistInfo = readLegacyField(fields, ["specialist information", "specialist info"]);
    const notes = readLegacyField(fields, ["notes", "patient notes", "case notes"]);
    const dischargeRaw = readLegacyField(fields, ["discharge date", "date discharged"]);
    const rbSentRaw = readLegacyField(fields, ["r&b sent date", "rb sent date", "r and b sent date"]);
    const billedAmount = readLegacyField(fields, ["billed amount", "billed", "total billed"]);
    const paidDateRaw = readLegacyField(fields, ["paid date", "date paid"]);
    const paidAmount = readLegacyField(fields, ["paid amount", "amount paid"]);

    const dateOfLoss = toIsoDate(dateOfLossRaw) || fallbackDate;
    const initialExamDate = toIsoDate(initialExamRaw) || initialExamRaw;
    const dischargeDate = toIsoDate(dischargeRaw) || dischargeRaw;
    const rbSentDate = toIsoDate(rbSentRaw) || rbSentRaw;
    const paidDate = toIsoDate(paidDateRaw) || paidDateRaw;
    const lastUpdate = [paidDate, rbSentDate, dischargeDate, initialExamDate, dateOfLoss]
      .map((value) => toIsoDate(value) || value)
      .find((value) => Boolean(value)) || dateOfLoss;

    const matrix: Record<string, string> = {};
    if (patientPhone) {
      matrix.contact = patientPhone;
    }
    if (initialExamDate) {
      matrix.initialExam = initialExamDate;
    }
    if (xrayInfo) {
      matrix.xrayFindings = xrayInfo;
    }
    if (mriInfo) {
      matrix.mriCtFindings = mriInfo;
    }
    if (specialistInfo) {
      matrix.specialistRecommendations = specialistInfo;
    }
    if (dischargeDate) {
      matrix.discharge = dischargeDate;
    }
    if (rbSentDate) {
      matrix.rbSent = rbSentDate;
    }
    if (billedAmount) {
      matrix.billed = billedAmount;
    }
    if (paidDate) {
      matrix.paidDate = paidDate;
    }
    if (paidAmount) {
      matrix.paidAmount = paidAmount;
    }
    const noteSegments = [patientEmail ? `Email: ${patientEmail}` : "", notes].filter(Boolean);
    if (noteSegments.length > 0) {
      matrix.notes = noteSegments.join(" | ");
    }

    const patientId =
      readLegacyField(fields, ["patient id", "id", "chart number", "case number"]) ||
      `PT-IMP-${String(index + 1).padStart(4, "0")}`;

    patients.push({
      id: patientId,
      fullName,
      dob: toIsoDate(readLegacyField(fields, ["patient dob", "dob", "date of birth", "birth date"])),
      phone: patientPhone || "-",
      attorney,
      caseStatus: mapLegacyCaseStatus(readLegacyField(fields, ["case status", "status"])),
      dateOfLoss,
      lastUpdate: toIsoDate(lastUpdate) || dateOfLoss,
      priority: "Normal",
      matrix: Object.keys(matrix).length > 0 ? matrix : undefined,
    });
  });

  return { patients, attorneyContacts };
}

function mapLegacyKeyDates(rows: unknown[]) {
  const keyDates: Record<string, unknown>[] = [];
  rows.forEach((entry, index) => {
    if (!isRecord(entry)) {
      return;
    }
    const fields = buildLegacyFieldMap(entry);
    const startDate = toIsoDate(
      readLegacyField(fields, ["start date", "date", "key date", "from", "start"]),
    );
    if (!startDate) {
      return;
    }
    const endDate = toIsoDate(readLegacyField(fields, ["end date", "to", "through", "end"])) || startDate;
    const status = readLegacyField(fields, ["office status", "status"]);
    const reason = readLegacyField(fields, ["reason", "description", "name", "note"]);
    const id = readLegacyField(fields, ["id"]) || `KD-IMP-${String(index + 1).padStart(4, "0")}`;
    keyDates.push({
      id,
      startDate,
      endDate: endDate >= startDate ? endDate : startDate,
      officeStatus: status.toLowerCase().includes("cover") ? "Covered" : "Closed",
      reason,
    });
  });
  return keyDates;
}

function mapLegacyContacts(rows: unknown[], attorneyContacts: LegacyAttorneyContact[]) {
  const normalized = new Map<
    string,
    {
      name: string;
      category: string;
      phone: string;
      email: string;
      fax: string;
      address: string;
    }
  >();

  const addContact = (contact: {
    name: string;
    category: string;
    phone: string;
    email: string;
    fax: string;
    address: string;
  }) => {
    const key = `${contact.name.toLowerCase()}::${contact.phone.replace(/\D/g, "")}`;
    if (!contact.name || !contact.phone || normalized.has(key)) {
      return;
    }
    normalized.set(key, contact);
  };

  rows.forEach((entry) => {
    if (!isRecord(entry)) {
      return;
    }
    const fields = buildLegacyFieldMap(entry);
    const name = readLegacyField(fields, ["name", "contact name", "office name", "firm", "company"]);
    const phone = readLegacyField(fields, ["phone", "phone number", "contact phone", "main phone"]);
    if (!name || !phone) {
      return;
    }
    addContact({
      name,
      phone,
      category: readLegacyField(fields, ["category", "type"]) || "Attorney",
      email: readLegacyField(fields, ["email"]),
      fax: readLegacyField(fields, ["fax"]),
      address: readLegacyField(fields, ["address"]),
    });
  });

  attorneyContacts.forEach((entry) => {
    addContact({
      name: entry.name,
      phone: entry.phone,
      category: "Attorney",
      email: "",
      fax: "",
      address: "",
    });
  });

  return Array.from(normalized.values()).map((entry, index) => ({
    id: `CT-IMP-${String(index + 1).padStart(4, "0")}`,
    ...entry,
  }));
}

function buildLegacyMigrationData(parsed: Record<string, unknown>) {
  const sources: Record<string, unknown>[] = [parsed];
  if (isRecord(parsed.data)) {
    sources.push(parsed.data);
  }
  if (isRecord(parsed.payload)) {
    sources.push(parsed.payload);
  }

  const patientRows =
    sources
      .map((source) =>
        findLegacyCollection(source, ["patients", "patient data", "patient list", "case files", "cases"]),
      )
      .find((entries) => Boolean(entries)) ?? null;
  const keyDateRows =
    sources
      .map((source) =>
        findLegacyCollection(source, ["key dates", "keydates", "office closures", "holidays"]),
      )
      .find((entries) => Boolean(entries)) ?? null;
  const contactRows =
    sources
      .map((source) =>
        findLegacyCollection(source, ["contacts", "contact directory", "contact list", "providers"]),
      )
      .find((entries) => Boolean(entries)) ?? null;

  const migrated: Record<string, unknown> = {};
  const patientMigration = patientRows ? mapLegacyPatients(patientRows) : { patients: [], attorneyContacts: [] };
  if (patientMigration.patients.length > 0) {
    migrated[PATIENTS_STORAGE_KEY] = patientMigration.patients;
  }

  const keyDates = keyDateRows ? mapLegacyKeyDates(keyDateRows) : [];
  if (keyDates.length > 0) {
    migrated[KEY_DATES_STORAGE_KEY] = keyDates;
  }

  const contacts = mapLegacyContacts(contactRows ?? [], patientMigration.attorneyContacts);
  if (contacts.length > 0) {
    migrated[CONTACT_DIRECTORY_STORAGE_KEY] = contacts;
  }

  return migrated;
}

function extractImportPayload(parsed: unknown): ParsedImportPayload | null {
  if (isRecord(parsed)) {
    if ((parsed.format === "notegoat-backup" || parsed.format === "casemate-backup") && isRecord(parsed.data)) {
      return { data: parsed.data, source: "backup" };
    }

    const migratedLegacy = buildLegacyMigrationData(parsed);
    if (Object.keys(migratedLegacy).length > 0) {
      return {
        data: {
          ...(isRecord(parsed.data) ? parsed.data : {}),
          ...migratedLegacy,
        },
        source: "legacy",
      };
    }

    if (isRecord(parsed.data)) {
      return { data: parsed.data, source: "legacy" };
    }
    if (isRecord(parsed.localStorage)) {
      return { data: parsed.localStorage, source: "legacy" };
    }
    return { data: parsed, source: "legacy" };
  }

  if (Array.isArray(parsed)) {
    const extracted = parseLegacyEntryList(parsed);
    if (Object.keys(extracted).length > 0) {
      return { data: extracted, source: "legacy" };
    }

    const patientMigration = mapLegacyPatients(parsed);
    const keyDates = mapLegacyKeyDates(parsed);
    const contacts = mapLegacyContacts(parsed, patientMigration.attorneyContacts);
    const migrated: Record<string, unknown> = {};
    if (patientMigration.patients.length > 0) {
      migrated[PATIENTS_STORAGE_KEY] = patientMigration.patients;
    }
    if (keyDates.length > 0) {
      migrated[KEY_DATES_STORAGE_KEY] = keyDates;
    }
    if (contacts.length > 0) {
      migrated[CONTACT_DIRECTORY_STORAGE_KEY] = contacts;
    }
    if (Object.keys(migrated).length > 0) {
      return { data: migrated, source: "legacy" };
    }
  }

  return null;
}

function buildLegacyStorageMappings(
  targetKeys: string[],
  sourceData: Record<string, unknown>,
): Record<string, { sourceKey: string; value: unknown }> {
  const targetSet = new Set(targetKeys);
  const normalizedTargetMap = new Map<string, string>();

  targetKeys.forEach((targetKey) => {
    const normalized = normalizeStorageKey(targetKey);
    if (!normalizedTargetMap.has(normalized)) {
      normalizedTargetMap.set(normalized, targetKey);
    }
  });

  const mappings: Record<string, { sourceKey: string; value: unknown }> = {};
  Object.entries(sourceData).forEach(([sourceKey, value]) => {
    if (targetSet.has(sourceKey)) {
      return;
    }
    const mappedTarget = normalizedTargetMap.get(normalizeStorageKey(sourceKey));
    if (!mappedTarget || Object.prototype.hasOwnProperty.call(mappings, mappedTarget)) {
      return;
    }
    mappings[mappedTarget] = { sourceKey, value };
  });

  return mappings;
}

type CollapsibleSectionProps = {
  title: string;
  description?: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

function CollapsibleSection({
  title,
  description,
  isOpen,
  onToggle,
  actions,
  children,
}: CollapsibleSectionProps) {
  return (
    <section className="panel-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          aria-expanded={isOpen}
          className="group flex flex-1 items-start justify-between gap-3 text-left"
          onClick={onToggle}
          type="button"
        >
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            {description && <p className="text-sm text-[var(--text-muted)]">{description}</p>}
          </div>
          <span
            aria-hidden
            className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            ⌄
          </span>
        </button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {isOpen ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setUserEmail(data?.user?.email ?? "");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters.");
      setStatus("error");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("New password and confirmation do not match.");
      setStatus("error");
      return;
    }
    if (!currentPassword) {
      setErrorMessage("Please enter your current password.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setErrorMessage("Authentication client unavailable.");
        setStatus("error");
        return;
      }

      // Verify the current password by re-authenticating with it.
      if (!userEmail) {
        setErrorMessage("Could not verify account email — please refresh and try again.");
        setStatus("error");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });
      if (signInError) {
        setErrorMessage("Current password is incorrect.");
        setStatus("error");
        return;
      }

      // Now update the password.
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setErrorMessage(updateError.message || "Failed to update password.");
        setStatus("error");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  };

  return (
    <form className="grid gap-3 max-w-md" onSubmit={handleSubmit}>
      {userEmail && (
        <p className="text-sm text-[var(--text-muted)]">
          Signed in as <span className="font-semibold">{userEmail}</span>
        </p>
      )}
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Current Password</span>
        <input
          autoComplete="current-password"
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(e) => setCurrentPassword(e.target.value)}
          type="password"
          value={currentPassword}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">New Password</span>
        <input
          autoComplete="new-password"
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          minLength={8}
          onChange={(e) => setNewPassword(e.target.value)}
          type="password"
          value={newPassword}
        />
        <span className="text-xs text-[var(--text-muted)]">At least 8 characters.</span>
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Confirm New Password</span>
        <input
          autoComplete="new-password"
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(e) => setConfirmPassword(e.target.value)}
          type="password"
          value={confirmPassword}
        />
      </label>
      <div className="flex items-center gap-3 pt-1">
        <button
          className={`rounded-xl px-4 py-2 text-sm font-bold text-white shadow-md transition ${
            status === "saving"
              ? "bg-gray-400 cursor-wait"
              : status === "saved"
                ? "bg-emerald-600"
                : status === "error"
                  ? "bg-red-600"
                  : "bg-[var(--brand-primary)] hover:opacity-90"
          }`}
          disabled={status === "saving"}
          type="submit"
        >
          {status === "saving"
            ? "Updating..."
            : status === "saved"
              ? "Password Updated!"
              : status === "error"
                ? "Try Again"
                : "Update Password"}
        </button>
        {status === "error" && errorMessage && (
          <span className="text-sm text-red-600">{errorMessage}</span>
        )}
      </div>
    </form>
  );
}

function SubscriptionSection() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openPortal = async () => {
    setLoading(true);
    setError("");

    try {
      // Get current user's stripe_customer_id from their profile
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Not connected to server.");
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("account_profiles")
        .select("stripe_customer_id, plan_tier")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const customerId = profile && typeof profile === "object"
        ? (profile as Record<string, unknown>).stripe_customer_id
        : null;

      if (!customerId || typeof customerId !== "string") {
        setError("No subscription found. Contact support or sign up for a plan.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Could not open billing portal.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">
        View invoices, update your payment method, or change your plan through
        the Stripe customer portal.
      </p>
      {error && (
        <p className="text-sm font-semibold text-[#b43b34]">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void openPortal()}
        disabled={loading}
        className="rounded-xl bg-[var(--brand-primary)] px-5 py-3 font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Opening..." : "Manage Subscription"}
      </button>
    </div>
  );
}

// ============================================================================
// Diagnostics Section
// ============================================================================
// Surfaces the state that matters when something goes wrong silently — cloud
// table row counts, auth user vs. active workspace match, sync status, and
// localStorage footprint. Built in direct response to the 2026-04-14 data
// loss incident where RLS silently rejected 94 encounter writes for weeks
// and there was no place for the user to notice.

type DiagnosticsState = {
  loading: boolean;
  error: string | null;
  authUserId: string | null;
  authEmail: string | null;
  activeWorkspaceId: string | null;
  workspacePrefix: string | null;
  workspaceMatchesAuth: boolean;
  cloudCounts: {
    patients: number | null;
    appointments: number | null;
    encounters: number | null;
  };
  localStorageBytes: number;
  localStorageKeyCount: number;
  casemateKeyCount: number;
  casemateBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Result row for the Test Cloud Write probe. Each table gets a row with
// the exact Postgres error text (or a success tick) so the user can copy
// the error when reporting a sync failure.
type ProbeResult = {
  table: string;
  ok: boolean | null; // null = not yet tested
  error: string | null;
  hint?: string;
};

function DiagnosticsSection() {
  const [state, setState] = useState<DiagnosticsState>({
    loading: true,
    error: null,
    authUserId: null,
    authEmail: null,
    activeWorkspaceId: null,
    workspacePrefix: null,
    workspaceMatchesAuth: false,
    cloudCounts: { patients: null, appointments: null, encounters: null },
    localStorageBytes: 0,
    localStorageKeyCount: 0,
    casemateKeyCount: 0,
    casemateBytes: 0,
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ getSupabaseBrowserClient }, { getActiveWorkspaceIdSync }] = await Promise.all([
          import("@/lib/supabase-browser"),
          import("@/lib/workspace-storage"),
        ]);
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          if (!cancelled) {
            setState((s) => ({ ...s, loading: false, error: "Supabase client not configured" }));
          }
          return;
        }

        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData?.user) {
          if (!cancelled) {
            setState((s) => ({
              ...s,
              loading: false,
              error: authError?.message ?? "Not signed in",
            }));
          }
          return;
        }

        const authUserId = authData.user.id;
        const authEmail = authData.user.email ?? null;
        const activeWorkspaceId = getActiveWorkspaceIdSync() || null;
        const workspacePrefix = activeWorkspaceId?.split(":")[0] ?? null;
        const workspaceMatchesAuth = workspacePrefix === authUserId;

        // Cloud counts — each query is workspace-scoped via RLS. If the
        // workspace mismatch is triggering, these will return 0 even though
        // rows exist under the correct workspace_id.
        const [patientsRes, apptsRes, encRes] = activeWorkspaceId
          ? await Promise.all([
              supabase
                .from("patients")
                .select("*", { count: "exact", head: true })
                .eq("workspace_id", activeWorkspaceId),
              supabase
                .from("schedule_appointments")
                .select("*", { count: "exact", head: true })
                .eq("workspace_id", activeWorkspaceId),
              supabase
                .from("encounter_notes")
                .select("*", { count: "exact", head: true })
                .eq("workspace_id", activeWorkspaceId),
            ])
          : [
              { count: null, error: null },
              { count: null, error: null },
              { count: null, error: null },
            ];

        // LocalStorage footprint
        let localStorageBytes = 0;
        let localStorageKeyCount = 0;
        let casemateKeyCount = 0;
        let casemateBytes = 0;
        if (typeof window !== "undefined") {
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            const value = window.localStorage.getItem(key) ?? "";
            const size = key.length + value.length;
            localStorageBytes += size;
            localStorageKeyCount += 1;
            if (key.startsWith("casemate.")) {
              casemateKeyCount += 1;
              casemateBytes += size;
            }
          }
        }

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          authUserId,
          authEmail,
          activeWorkspaceId,
          workspacePrefix,
          workspaceMatchesAuth,
          cloudCounts: {
            patients: patientsRes.count ?? null,
            appointments: apptsRes.count ?? null,
            encounters: encRes.count ?? null,
          },
          localStorageBytes,
          localStorageKeyCount,
          casemateKeyCount,
          casemateBytes,
        });
      } catch (error) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            loading: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  if (state.loading) {
    return <p className="text-sm text-[var(--text-muted)]">Running diagnostics…</p>;
  }

  const row = (label: string, value: ReactNode, status?: "ok" | "warn" | "bad") => (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] py-2 last:border-b-0">
      <span className="text-sm font-medium text-[var(--text-muted)]">{label}</span>
      <span
        className={`text-right font-mono text-xs ${
          status === "bad"
            ? "text-red-400"
            : status === "warn"
              ? "text-amber-400"
              : status === "ok"
                ? "text-emerald-400"
                : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      {state.error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </div>
      ) : null}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Authentication &amp; Workspace
        </h3>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3">
          {row("Signed-in user", state.authEmail ?? "—")}
          {row("Auth user ID", state.authUserId ?? "—")}
          {row("Active workspace ID", state.activeWorkspaceId ?? "(none)")}
          {row(
            "Workspace matches auth user",
            state.workspaceMatchesAuth ? "✓ yes" : "✗ NO — writes will be rejected by RLS",
            state.workspaceMatchesAuth ? "ok" : "bad",
          )}
        </div>
        {!state.workspaceMatchesAuth && state.activeWorkspaceId ? (
          <p className="mt-2 text-xs text-red-300">
            The workspace prefix ({state.workspacePrefix || "(empty)"}) does not match your
            authenticated user ID. Every cloud write will be silently rejected by the database.
            This is the same bug that caused the 2026-04-14 data loss. Sign out and sign back in
            to refresh the workspace pointer.
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Cloud Row Counts (scoped to current workspace)
        </h3>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3">
          {row("Patients", state.cloudCounts.patients ?? "—")}
          {row("Appointments", state.cloudCounts.appointments ?? "—")}
          {row("Encounter notes", state.cloudCounts.encounters ?? "—")}
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          If these numbers drop unexpectedly, something is wiping data. Compare against your
          previous values before making changes.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Local Storage
        </h3>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3">
          {row("Total keys", state.localStorageKeyCount)}
          {row("Total size", formatBytes(state.localStorageBytes))}
          {row("casemate.* keys", state.casemateKeyCount)}
          {row(
            "casemate.* size",
            formatBytes(state.casemateBytes),
            state.casemateBytes > 4 * 1024 * 1024 ? "warn" : "ok",
          )}
        </div>
        {state.casemateBytes > 4 * 1024 * 1024 ? (
          <p className="mt-2 text-xs text-amber-300">
            Approaching the 5 MB localStorage quota. At the quota, new saves to localStorage
            will fail. The app prunes old encounters automatically but if this keeps climbing,
            investigate.
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Test Cloud Write
        </h3>
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Inserts and immediately deletes a dummy row in each cloud table to surface
          the exact Postgres error the app is hitting. The rows never stick around and
          your real data is untouched. If a row reports an error, copy the error text —
          that&apos;s what the red &quot;Cloud sync failed&quot; pill is actually complaining about.
        </p>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3">
          {probes.length === 0 ? (
            <div className="py-2 text-sm text-[var(--text-muted)]">No probe run yet.</div>
          ) : (
            probes.map((p) => (
              <div
                key={p.table}
                className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] py-2 last:border-b-0"
              >
                <span className="text-sm font-medium text-[var(--text-muted)]">{p.table}</span>
                <span
                  className={`max-w-xs break-all text-right font-mono text-xs ${
                    p.ok === null
                      ? "text-[var(--text-muted)]"
                      : p.ok
                        ? "text-emerald-400"
                        : "text-red-400"
                  }`}
                >
                  {p.ok === null ? "…" : p.ok ? "OK ✓" : p.error || "failed"}
                  {p.hint ? (
                    <div className="mt-1 text-[10px] font-normal text-amber-300">{p.hint}</div>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <DuplicatePatientsSubsection />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={probing || !state.activeWorkspaceId || !state.workspaceMatchesAuth}
          onClick={async () => {
            // Try inserting + deleting a disposable row in each cloud table.
            // The row ids are prefixed `__probe__` so they're obvious in the
            // DB if anything ever gets left behind. Runs sequentially so we
            // can report results incrementally.
            setProbing(true);
            const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
            const supabase = getSupabaseBrowserClient();
            if (!supabase || !state.activeWorkspaceId) {
              setProbing(false);
              return;
            }
            const ws = state.activeWorkspaceId;
            const probeId = `__probe__${Date.now()}`;
            const targets: Array<{
              table: string;
              row: Record<string, unknown>;
            }> = [
              {
                table: "patients",
                row: {
                  id: probeId,
                  workspace_id: ws,
                  full_name: "__probe__",
                  dob: "",
                  phone: "",
                  attorney: "",
                  case_status: "Active",
                  date_of_loss: "",
                  last_update: "",
                  priority: "Normal",
                },
              },
              {
                table: "schedule_appointments",
                row: {
                  id: probeId,
                  workspace_id: ws,
                  patient_id: "",
                  patient_name: "__probe__",
                  provider: "",
                  location: "",
                  appointment_type: "",
                  case_label: "",
                  room: "",
                  date: "",
                  start_time: "08:00",
                  duration_min: 30,
                  status: "Scheduled",
                  note: "",
                  override_office_hours: false,
                },
              },
              {
                table: "encounter_notes",
                row: {
                  id: probeId,
                  workspace_id: ws,
                  patient_id: "",
                  patient_name: "__probe__",
                  provider: "",
                  appointment_type: "",
                  encounter_date: "",
                  start_time: "",
                  soap: { subjective: "", objective: "", assessment: "", plan: "" },
                  macro_runs: [],
                  diagnoses: [],
                  charges: [],
                  signed: false,
                  signed_at: "",
                  created_at_record: "",
                  updated_at_record: "",
                },
              },
              {
                table: "app_snapshots",
                row: {
                  workspace_id: ws,
                  snapshot: { "__probe__": "ignore" },
                  updated_at: new Date().toISOString(),
                },
              },
            ];

            // Seed all rows as pending so the UI shows progress
            setProbes(
              targets.map((t) => ({ table: t.table, ok: null, error: null })),
            );

            const results: ProbeResult[] = [];
            for (const t of targets) {
              try {
                // app_snapshots is the only table we don't want to insert-
                // then-delete against — the protect trigger would kick.
                // Instead we just do a select to confirm the caller can
                // read the row.
                if (t.table === "app_snapshots") {
                  const { error } = await supabase
                    .from("app_snapshots")
                    .select("workspace_id", { head: true, count: "exact" })
                    .eq("workspace_id", ws);
                  results.push({
                    table: "app_snapshots (read probe)",
                    ok: !error,
                    error: error ? `${error.code ?? ""} ${error.message}`.trim() : null,
                    hint: error
                      ? "If this fails, the legacy blob table is the problem."
                      : undefined,
                  });
                  setProbes([...results, ...targets.slice(results.length).map((x) => ({
                    table: x.table,
                    ok: null as boolean | null,
                    error: null,
                  }))]);
                  continue;
                }

                const upsertConflict =
                  t.table === "app_snapshots" ? "workspace_id" : "workspace_id,id";
                const { error: upErr } = await supabase
                  .from(t.table)
                  .upsert(t.row, { onConflict: upsertConflict });
                if (upErr) {
                  results.push({
                    table: t.table,
                    ok: false,
                    error: `${upErr.code ?? ""} ${upErr.message}`.trim(),
                    hint:
                      upErr.message.toLowerCase().includes("row-level security") ||
                      upErr.message.toLowerCase().includes("policy")
                        ? "RLS policy rejected — workspace_id prefix likely does not match auth.uid()."
                        : upErr.message.toLowerCase().includes("does not exist") ||
                            upErr.message.toLowerCase().includes("relation")
                          ? "Table missing — run the SQL migration for this table in Supabase."
                          : upErr.message.toLowerCase().includes("null value")
                            ? "A NOT NULL column is missing from the code path — schema drift."
                            : undefined,
                  });
                } else {
                  // Clean up the probe row immediately.
                  const { error: delErr } = await supabase
                    .from(t.table)
                    .delete()
                    .eq("workspace_id", ws)
                    .eq("id", probeId);
                  results.push({
                    table: t.table,
                    ok: !delErr,
                    error: delErr ? `${delErr.code ?? ""} ${delErr.message}`.trim() : null,
                  });
                }
              } catch (err) {
                results.push({
                  table: t.table,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              setProbes([...results, ...targets.slice(results.length).map((x) => ({
                table: x.table,
                ok: null as boolean | null,
                error: null,
              }))]);
            }
            setProbes(results);
            setProbing(false);
          }}
          className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
        >
          {probing ? "Probing…" : "Run Test Cloud Write"}
        </button>
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Duplicate Patients subsection
// ============================================================================
// Small diagnostic that scans the patient list for rows that look like the
// same person — same full name (normalized) + same DOB, or same name + same
// date of loss. A compact aesthetic table, collapsed by default. If the user
// decides one is a real duplicate, they can open the patient and soft-delete
// it from the patient page — we do not delete here.

type DuplicateConfidence = "very_likely" | "likely" | "possible";

type DuplicatePatient = {
  id: string;
  fullName: string;
  dob: string;
  dateOfLoss: string;
  caseStatus: string;
};

type DuplicateGroup = {
  key: string;
  confidence: DuplicateConfidence;
  reasons: string[];
  patients: DuplicatePatient[];
};

/**
 * Split a patient's fullName into first/last tokens. Supports both
 * "Last, First" (the canonical storage format in this app) and "First Last"
 * as a fallback. Lowercased and stripped of non-letter characters so
 * "O'Brien" and "Obrien" collide.
 */
function splitNameForDedup(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { first: "", last: "" };
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  if (trimmed.includes(",")) {
    const [last = "", first = ""] = trimmed.split(",", 2).map((s) => s.trim());
    return { first: normalize(first), last: normalize(last) };
  }
  const parts = trimmed.split(/\s+/);
  return {
    first: normalize(parts[0] ?? ""),
    last: normalize(parts.slice(1).join("")),
  };
}

function normalizeDateForDedup(value: string): string {
  // Collapse both MM/DD/YYYY and YYYY-MM-DD into YYYY-MM-DD so cross-format
  // duplicates are still caught. Used INTERNALLY for comparison only —
  // never rendered in the UI.
  if (!value) return "";
  const t = value.trim();
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return t;
}

/** Render any stored date string as MM/DD/YYYY for the UI. Never exposes
 *  the internal ISO format to the user. Returns "—" for empty/unparseable. */
function formatDateForDisplayUs(value: string | undefined): string {
  if (!value) return "—";
  const t = value.trim();
  if (!t) return "—";
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[2].padStart(2, "0")}/${iso[3].padStart(2, "0")}/${iso[1]}`;
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${us[1].padStart(2, "0")}/${us[2].padStart(2, "0")}/${year}`;
  }
  return t; // fallback: whatever it is
}

/**
 * Classic Levenshtein edit distance between two strings. Used for catching
 * misspelled first names like "Jhon" vs "John" or "Sahak" vs "Sahaak".
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Two first names are "similar" if exact, one is a prefix of the other
 *  (Sara vs Sarah), or they're within 2 edits of each other AND differ by
 *  less than 35% of the longer name (keeps "Bob" from matching "Tom"). */
function firstNamesSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) return false; // too short — too many false positives
  const dist = levenshtein(a, b);
  return dist <= 2 && dist / maxLen < 0.35;
}

function confidenceRank(c: DuplicateConfidence): number {
  return c === "very_likely" ? 3 : c === "likely" ? 2 : 1;
}

function DuplicatePatientsSubsection() {
  const [expanded, setExpanded] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);

  const runScan = async () => {
    const { patients } = await import("@/lib/mock-data");

    // Precompute normalized keys once — avoids O(n²) string manipulation.
    const indexed = patients
      .filter((p) => !p.deleted)
      .map((p) => ({
        id: p.id,
        fullName: p.fullName,
        dob: p.dob,
        dateOfLoss: p.dateOfLoss,
        caseStatus: p.caseStatus,
        name: splitNameForDedup(p.fullName),
        dobKey: normalizeDateForDedup(p.dob),
        dolKey: normalizeDateForDedup(p.dateOfLoss),
      }));

    // Bucket by last name first so we only compare people with the same
    // surname. A full n² scan over thousands of patients would be slow,
    // but within a last-name bucket it's cheap.
    const byLastName = new Map<string, typeof indexed>();
    for (const entry of indexed) {
      if (!entry.name.last) continue;
      const bucket = byLastName.get(entry.name.last) ?? [];
      bucket.push(entry);
      byLastName.set(entry.name.last, bucket);
    }

    type Pair = {
      aId: string;
      bId: string;
      confidence: DuplicateConfidence;
      reason: string;
    };
    const pairs: Pair[] = [];
    const seen = new Set<string>();

    byLastName.forEach((bucket) => {
      if (bucket.length < 2) return;
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          const pairKey = [a.id, b.id].sort().join("|");
          if (seen.has(pairKey)) continue;

          const firstMatches = Boolean(a.name.first) && a.name.first === b.name.first;
          const firstSimilar = !firstMatches && firstNamesSimilar(a.name.first, b.name.first);
          const dobMatches = Boolean(a.dobKey) && a.dobKey === b.dobKey;
          const dolMatches = Boolean(a.dolKey) && a.dolKey === b.dolKey;

          let confidence: DuplicateConfidence | null = null;
          let reason = "";

          // Very likely: exact name + DOB + DOL
          if (firstMatches && dobMatches && dolMatches) {
            confidence = "very_likely";
            reason = "Same name + DOB + DOL";
          }
          // Likely: exact name + one strong identifier
          else if (firstMatches && dobMatches) {
            confidence = "likely";
            reason = "Same name + DOB";
          } else if (firstMatches && dolMatches) {
            confidence = "likely";
            reason = "Same name + DOL";
          }
          // Possible: misspelled first name + DOB + DOL (very strong signal)
          else if (firstSimilar && dobMatches && dolMatches) {
            confidence = "possible";
            reason = "Similar name (misspelling?) + DOB + DOL";
          }
          // Possible: misspelled first name + DOB (same person, different injury?)
          else if (firstSimilar && dobMatches) {
            confidence = "possible";
            reason = "Similar name (misspelling?) + DOB";
          }
          // Possible: misspelled first name + DOL (same person, wrong DOB?)
          else if (firstSimilar && dolMatches) {
            confidence = "possible";
            reason = "Similar name (misspelling?) + DOL";
          }

          if (confidence) {
            pairs.push({ aId: a.id, bId: b.id, confidence, reason });
            seen.add(pairKey);
          }
        }
      }
    });

    if (pairs.length === 0) {
      setGroups([]);
      setScanned(true);
      return;
    }

    // Union-find: if A matches B and B matches C, treat {A,B,C} as one
    // cluster. The user almost always wants to see all members of a
    // duplicate cluster together, not as fragmented pairs.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root) ?? root;
      // Path compression
      let cur = x;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur) ?? cur;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const pair of pairs) {
      if (!parent.has(pair.aId)) parent.set(pair.aId, pair.aId);
      if (!parent.has(pair.bId)) parent.set(pair.bId, pair.bId);
      union(pair.aId, pair.bId);
    }

    // Collect members + reasons per cluster
    const clusters = new Map<
      string,
      { confidence: DuplicateConfidence; reasons: Set<string>; memberIds: Set<string> }
    >();
    for (const pair of pairs) {
      const root = find(pair.aId);
      const cluster = clusters.get(root) ?? {
        confidence: pair.confidence,
        reasons: new Set<string>(),
        memberIds: new Set<string>(),
      };
      cluster.reasons.add(pair.reason);
      cluster.memberIds.add(pair.aId);
      cluster.memberIds.add(pair.bId);
      if (confidenceRank(pair.confidence) > confidenceRank(cluster.confidence)) {
        cluster.confidence = pair.confidence;
      }
      clusters.set(root, cluster);
    }

    const byId = new Map(indexed.map((p) => [p.id, p]));
    const result: DuplicateGroup[] = [];
    clusters.forEach((cluster, root) => {
      const patients: DuplicatePatient[] = [];
      cluster.memberIds.forEach((id) => {
        const src = byId.get(id);
        if (!src) return;
        patients.push({
          id: src.id,
          fullName: src.fullName,
          dob: src.dob,
          dateOfLoss: src.dateOfLoss,
          caseStatus: src.caseStatus,
        });
      });
      // Sort cluster members alphabetically so the UI is stable
      patients.sort((a, b) => a.fullName.localeCompare(b.fullName));
      result.push({
        key: root,
        confidence: cluster.confidence,
        reasons: Array.from(cluster.reasons),
        patients,
      });
    });

    // Sort groups: very_likely first, then larger clusters first
    result.sort((a, b) => {
      const rc = confidenceRank(b.confidence) - confidenceRank(a.confidence);
      if (rc !== 0) return rc;
      return b.patients.length - a.patients.length;
    });

    setGroups(result);
    setScanned(true);
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Duplicate Patients
        </h3>
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
            if (!expanded && !scanned) void runScan();
          }}
          className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
        >
          {expanded ? "Hide" : scanned ? "Show" : "Scan"}
        </button>
      </div>
      {expanded ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2">
          {!scanned ? (
            <p className="text-sm text-[var(--text-muted)]">Scanning…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-emerald-400">✓ No duplicates found.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">
                Found {groups.length} possible duplicate group{groups.length === 1 ? "" : "s"}. Open
                each patient from the Patients page to compare and decide which to keep.
              </p>
              <ul className="space-y-2">
                {groups.map((g) => {
                  const badge =
                    g.confidence === "very_likely"
                      ? { label: "VERY LIKELY", classes: "bg-red-500/20 text-red-300 border-red-500/40" }
                      : g.confidence === "likely"
                        ? { label: "LIKELY", classes: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
                        : { label: "POSSIBLE", classes: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
                  return (
                    <li
                      key={g.key}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--surface-base)] p-2"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {g.reasons.join(" · ")}
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {g.patients.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="font-medium text-[var(--text-primary)]">
                              {p.fullName}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--text-muted)]">
                              DOB {formatDateForDisplayUs(p.dob)} · DOL {formatDateForDisplayUs(p.dateOfLoss)} · {p.caseStatus}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void runScan()}
                  className="text-xs text-[var(--brand-primary)] hover:underline"
                >
                  Rescan
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function SettingsPage() {
  const {
    officeSettings,
    updateOfficeSettings,
    resetToDefaults: resetOfficeSettingsToDefaults,
  } = useOfficeSettings();
  const {
    categories: contactCategories,
    addCategory: addContactCategory,
    removeCategory: removeContactCategory,
    resetToDefaults: resetContactCategoriesToDefaults,
  } = useContactCategories();
  const {
    caseStatuses,
    lienLabel,
    lienOptions,
    addStatus,
    removeStatus,
    toggleDashboardVisibility,
    setStatusColor,
    setStatusClosed,
    setStatusAutoFolder,
    setLienLabel,
    addLienOption,
    updateLienOption,
    moveLienOption,
    removeLienOption,
    resetLienOptionsToDefaults,
    resetToDefaults: resetCaseStatusesToDefaults,
  } = useCaseStatuses();
  const {
    priorityRules,
    setIncludeMriDue,
    setMriDueDaysFromInitial,
    setIncludeNoUpdate,
    setNoUpdateDaysThreshold,
    setIncludeRbStatusCheck,
    setRbStatusCheckDaysThreshold,
    setMaxItems,
    resetToDefaults: resetPriorityRulesToDefaults,
  } = usePriorityCaseRules();
  const {
    dashboardWorkspaceSettings,
    setTasksShowOnDashboard,
    setTasksOpenOnly,
    setTasksMaxItems,
    setFollowUpShowOnDashboard,
    setFollowUpIncludeXray,
    setFollowUpIncludeMriCt,
    setFollowUpIncludeSpecialist,
    setFollowUpIncludeLienLop,
    setXrayAppearAuto,
    setMriAppearMode,
    setMriAppearDays,
    setSpecialistAppearWhen,
    toggleXrayClearedBy,
    toggleMriCtClearedBy,
    toggleSpecialistClearedBy,
    setXrayNoReportWarningDays,
    setMriNoReportWarningDays,
    setMriNoScheduleWarningDays,
    setSpecialistNoReportWarningDays,
    setSpecialistNoScheduleWarningDays,
    setFollowUpLienLopClearStatuses,
    setFollowUpStaleDaysThreshold,
    setFollowUpMaxItems,
    resetToDefaults: resetDashboardWorkspaceSettingsToDefaults,
  } = useDashboardWorkspaceSettings();
  const {
    quickStatsSettings,
    setStatVisibility,
    setAllStatsVisible,
    resetToDefaults: resetQuickStatsToDefaults,
  } = useQuickStatsSettings();
  const {
    scheduleSettings,
    setEnforceOfficeHours,
    setAllowOverride,
    setAppointmentIntervalMin,
    setMaxAppointmentsPerSlot,
    updateOfficeHour,
    resetToDefaults: resetScheduleSettingsToDefaults,
  } = useScheduleSettings();
  const {
    appointmentTypes,
    addAppointmentType,
    updateAppointmentType,
    setDefaultAppointmentType,
    removeAppointmentType,
    resetToDefaults: resetAppointmentTypesToDefaults,
  } = useScheduleAppointmentTypes();
  const {
    rooms,
    addRoom,
    updateRoom,
    removeRoom,
    scheduleRooms,
    setEnableRoomSelectionOnCheckIn,
    resetToDefaults: resetRoomSettingsToDefaults,
  } = useScheduleRooms();
  const { emailSettings, updateEmailSettings, resetEmailSettings } = useEmailSettings();

  const [statusNameDraft, setStatusNameDraft] = useState("");
  const [statusColorDraft, setStatusColorDraft] = useState("#0d79bf");
  const [statusCaseClosedDraft, setStatusCaseClosedDraft] = useState(false);
  const [lienOptionDraft, setLienOptionDraft] = useState("");
  const [appointmentTypeNameDraft, setAppointmentTypeNameDraft] = useState("");
  const [appointmentTypeColorDraft, setAppointmentTypeColorDraft] = useState("#0d79bf");
  const [appointmentTypeDurationDraft, setAppointmentTypeDurationDraft] = useState(30);
  const [appointmentTypeDefaultDraft, setAppointmentTypeDefaultDraft] = useState(false);
  const [appointmentTypeError, setAppointmentTypeError] = useState("");
  const [roomNameDraft, setRoomNameDraft] = useState("");
  const [roomColorDraft, setRoomColorDraft] = useState("#0d79bf");
  const [roomError, setRoomError] = useState("");
  const [contactCategoryDraft, setContactCategoryDraft] = useState("");
  const [contactCategoryError, setContactCategoryError] = useState("");
  const [officeSettingsMessage, setOfficeSettingsMessage] = useState("");
  const [deletePasswordDraft, setDeletePasswordDraft] = useState("");
  const [deletePasswordLoginEmail, setDeletePasswordLoginEmail] = useState("");
  const [deletePasswordLoginPassword, setDeletePasswordLoginPassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [deletePasswordSuccess, setDeletePasswordSuccess] = useState("");
  const [deletePasswordSaving, setDeletePasswordSaving] = useState(false);

  // Force save state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Data recovery state
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{ exists: boolean; backedUpAt: string }>({ exists: false, backedUpAt: "" });
  const [backupSelections, setBackupSelections] = useState<Record<BackupModuleId, boolean>>(() =>
    backupModules.reduce<Record<BackupModuleId, boolean>>((accumulator, module) => {
      accumulator[module.id] = true;
      return accumulator;
    }, {} as Record<BackupModuleId, boolean>),
  );
  const [importBackupFile, setImportBackupFile] = useState<File | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [preferredDocumentScope] = useState<DocumentTemplateScope | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return parseDocumentTemplateScope(new URLSearchParams(window.location.search).get("scope"));
  });
  const [expandedSections, setExpandedSections] = useState<Record<SettingsSectionKey, boolean>>(() => {
    const next = { ...defaultExpandedSections };
    if (typeof window === "undefined") {
      return next;
    }
    const section = new URLSearchParams(window.location.search).get("section");
    if (section && isSettingsSectionKey(section)) {
      next[section] = true;
    }
    return next;
  });

  useEffect(() => {
    setBackupInfo(hasSafetyBackup());
  }, []);

  const toggleSection = (sectionKey: SettingsSectionKey) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const selectedBackupModules = useMemo(
    () => backupModules.filter((module) => backupSelections[module.id]),
    [backupSelections],
  );
  const selectedBackupKeys = useMemo(
    () => [...new Set(selectedBackupModules.flatMap((module) => module.keys))],
    [selectedBackupModules],
  );
  const followUpLienClearStatusOptions = useMemo(() => {
    const normalized = new Set(lienOptions.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const merged = [...lienOptions];
    dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses.forEach((status) => {
      const cleanStatus = status.trim();
      if (!cleanStatus) {
        return;
      }
      if (normalized.has(cleanStatus.toLowerCase())) {
        return;
      }
      merged.push(cleanStatus);
    });
    return merged;
  }, [dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses, lienOptions]);

  const setAllBackupSelections = (checked: boolean) => {
    setBackupSelections((current) => {
      const next: Record<BackupModuleId, boolean> = { ...current };
      backupModules.forEach((module) => {
        next[module.id] = checked;
      });
      return next;
    });
  };

  const applyBackupPreset = (moduleIds: BackupModuleId[]) => {
    setBackupSelections((current) => {
      const next: Record<BackupModuleId, boolean> = { ...current };
      backupModules.forEach((module) => {
        next[module.id] = moduleIds.includes(module.id);
      });
      return next;
    });
  };

  const toggleBackupSelection = (moduleId: BackupModuleId) => {
    setBackupSelections((current) => ({
      ...current,
      [moduleId]: !current[moduleId],
    }));
  };

  const setAllSections = (isOpen: boolean) => {
    setExpandedSections((current) => {
      const next: Record<SettingsSectionKey, boolean> = { ...current };
      (Object.keys(current) as SettingsSectionKey[]).forEach((sectionKey) => {
        next[sectionKey] = isOpen;
      });
      return next;
    });
  };

  const handleAddCaseStatus = () => {
    const nextName = statusNameDraft.trim();
    if (!nextName) {
      return;
    }
    addStatus(nextName, false, statusColorDraft, statusCaseClosedDraft);
    setStatusNameDraft("");
    setStatusColorDraft("#0d79bf");
    setStatusCaseClosedDraft(false);
  };

  const handleAddLienOption = () => {
    const nextName = lienOptionDraft.trim();
    if (!nextName) {
      return;
    }
    addLienOption(nextName);
    setLienOptionDraft("");
  };

  const handleAddAppointmentType = () => {
    const typeName = appointmentTypeNameDraft.trim();
    if (!typeName) {
      setAppointmentTypeError("Type name is required.");
      return;
    }

    const wasAdded = addAppointmentType(
      typeName,
      appointmentTypeColorDraft,
      appointmentTypeDurationDraft,
      appointmentTypeDefaultDraft,
    );

    if (!wasAdded) {
      setAppointmentTypeError("An appointment type with this name already exists.");
      return;
    }

    setAppointmentTypeError("");
    setAppointmentTypeNameDraft("");
    setAppointmentTypeColorDraft("#0d79bf");
    setAppointmentTypeDurationDraft(30);
    setAppointmentTypeDefaultDraft(false);
  };

  const handleAddRoom = () => {
    const result = addRoom(roomNameDraft, roomColorDraft);
    if (!result.ok) {
      setRoomError(result.reason);
      return;
    }
    setRoomError("");
    setRoomNameDraft("");
    setRoomColorDraft("#0d79bf");
  };

  const handleAddContactCategory = () => {
    const result = addContactCategory(contactCategoryDraft);
    if (!result.ok) {
      setContactCategoryError(result.reason);
      return;
    }
    setContactCategoryError("");
    setContactCategoryDraft("");
  };

  const handleRemoveContactCategory = (category: string) => {
    const result = removeContactCategory(category);
    if (!result.ok) {
      setContactCategoryError(result.reason);
      return;
    }
    setContactCategoryError("");
  };

  const handleOfficeLogoUpload = async (file: File | null) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setOfficeSettingsMessage("Please upload an image file for the logo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      updateOfficeSettings({ logoDataUrl: dataUrl });
      setOfficeSettingsMessage("Logo uploaded.");
    };
    reader.onerror = () => {
      setOfficeSettingsMessage("Could not read logo file.");
    };
    reader.readAsDataURL(file);
  };

  const handleSetDeletePassword = async () => {
    setDeletePasswordError("");
    setDeletePasswordSuccess("");
    const newPassword = deletePasswordDraft.trim();
    if (!newPassword) {
      setDeletePasswordError("Enter a delete password.");
      return;
    }
    if (!deletePasswordLoginEmail.trim() || !deletePasswordLoginPassword) {
      setDeletePasswordError("Enter your login email and password to verify your identity.");
      return;
    }
    setDeletePasswordSaving(true);
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setDeletePasswordError("Supabase is not configured. Cannot verify identity.");
        setDeletePasswordSaving(false);
        return;
      }
      // Verify the user's current session first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setDeletePasswordError("You must be signed in to set the delete password.");
        setDeletePasswordSaving(false);
        return;
      }
      // Verify the email matches the signed-in user
      if (session.user.email?.toLowerCase() !== deletePasswordLoginEmail.trim().toLowerCase()) {
        setDeletePasswordError("Email must match the currently signed-in account.");
        setDeletePasswordSaving(false);
        return;
      }
      // Use a separate Supabase client to verify password WITHOUT affecting
      // the current session. We create a throwaway client just for verification.
      const { createClient } = await import("@supabase/supabase-js");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        setDeletePasswordError("Supabase configuration missing.");
        setDeletePasswordSaving(false);
        return;
      }
      const verifyClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: authError } = await verifyClient.auth.signInWithPassword({
        email: deletePasswordLoginEmail.trim(),
        password: deletePasswordLoginPassword,
      });
      if (authError) {
        setDeletePasswordError("Login verification failed: " + authError.message);
        setDeletePasswordSaving(false);
        return;
      }
      // Sign out the throwaway client immediately
      await verifyClient.auth.signOut();
      // Verification succeeded — save the delete password
      updateOfficeSettings({ deletePassword: newPassword });
      setDeletePasswordSuccess("Delete password saved.");
      setDeletePasswordDraft("");
      setDeletePasswordLoginEmail("");
      setDeletePasswordLoginPassword("");
    } catch {
      setDeletePasswordError("Something went wrong. Please try again.");
    }
    setDeletePasswordSaving(false);
  };

  const handleExportBackup = () => {
    setBackupError("");
    setBackupMessage("");
    if (typeof window === "undefined") {
      return;
    }
    if (!selectedBackupModules.length) {
      setBackupError("Select at least one backup module.");
      return;
    }

    const data: Record<string, unknown> = {};
    selectedBackupKeys.forEach((key) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return;
      }
      try {
        data[key] = JSON.parse(raw) as unknown;
      } catch {
        data[key] = raw;
      }
    });

    const payload: BackupPayload = {
      app: "Note Goat",
      format: "notegoat-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      modules: selectedBackupModules.map((module) => module.id),
      data,
    };

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `notegoat-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setBackupMessage(
      `Backup exported (${selectedBackupModules.length} module${selectedBackupModules.length === 1 ? "" : "s"}).`,
    );
  };

  const handleBackupFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    setBackupError("");
    setBackupMessage("");
    const file = event.target.files?.[0] ?? null;
    setImportBackupFile(file);
  };

  const handleImportBackup = async () => {
    setBackupError("");
    setBackupMessage("");
    if (typeof window === "undefined") {
      return;
    }
    if (!importBackupFile) {
      setBackupError("Select a backup file first.");
      return;
    }
    if (!selectedBackupModules.length) {
      setBackupError("Select at least one module to import.");
      return;
    }
    const confirmed = window.confirm(
      "Import will overwrite selected modules in this office. Continue?",
    );
    if (!confirmed) {
      return;
    }

    try {
      const content = await importBackupFile.text();
      const parsed = JSON.parse(content) as unknown;
      const payload = extractImportPayload(parsed);
      if (!payload) {
        setBackupError("Invalid backup file format.");
        return;
      }
      const sourceData = payload.data;
      const legacyMappings = buildLegacyStorageMappings(selectedBackupKeys, sourceData);

      let appliedCount = 0;
      let legacyMappedCount = 0;
      selectedBackupKeys.forEach((key) => {
        let value: unknown | undefined;
        if (Object.prototype.hasOwnProperty.call(sourceData, key)) {
          value = sourceData[key];
        } else if (Object.prototype.hasOwnProperty.call(legacyMappings, key)) {
          value = legacyMappings[key].value;
          legacyMappedCount += 1;
        }

        if (typeof value === "undefined") {
          return;
        }
        const nextValue = typeof value === "string" ? value : JSON.stringify(value);
        window.localStorage.setItem(key, nextValue);
        appliedCount += 1;
      });

      if (!appliedCount) {
        setBackupError("No matching selected modules were found in that backup file.");
        return;
      }

      setBackupMessage(
        `${payload.source === "backup" ? "Import complete" : "Migration complete"} (${appliedCount} storage item${
          appliedCount === 1 ? "" : "s"
        }${legacyMappedCount ? `, ${legacyMappedCount} mapped from legacy keys` : ""}). Reloading...`,
      );
      setImportBackupFile(null);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
      setTimeout(() => {
        window.location.reload();
      }, 650);
    } catch {
      setBackupError("Could not import backup. Please verify the JSON file.");
    }
  };

  const toggleFollowUpLienLopClearStatus = (statusName: string, enabled: boolean) => {
    const normalizedTarget = statusName.trim().toLowerCase();
    const currentStatuses = dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses;
    if (!normalizedTarget) {
      return;
    }
    if (enabled) {
      if (currentStatuses.some((entry) => entry.trim().toLowerCase() === normalizedTarget)) {
        return;
      }
      setFollowUpLienLopClearStatuses([...currentStatuses, statusName]);
      return;
    }
    setFollowUpLienLopClearStatuses(
      currentStatuses.filter((entry) => entry.trim().toLowerCase() !== normalizedTarget),
    );
  };

  const defaultAppointmentTypeId = appointmentTypes.find((entry) => entry.isDefault)?.id ?? "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-md transition ${
            saveStatus === "saving"
              ? "bg-gray-400 cursor-wait"
              : saveStatus === "saved"
                ? "bg-emerald-600"
                : saveStatus === "error"
                  ? "bg-red-600"
                  : "bg-[var(--brand-primary)] hover:opacity-90"
          }`}
          disabled={saveStatus === "saving"}
          onClick={async () => {
            setSaveStatus("saving");
            try {
              await forceSyncNow();
              setSaveStatus("saved");
              setTimeout(() => setSaveStatus("idle"), 3000);
            } catch {
              setSaveStatus("error");
              setTimeout(() => setSaveStatus("idle"), 4000);
            }
          }}
          type="button"
        >
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "saved"
              ? "Saved to Cloud!"
              : saveStatus === "error"
                ? "Save Failed - Try Again"
                : "Save to Cloud"}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
            onClick={() => setAllSections(true)}
            type="button"
          >
            Expand All
          </button>
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
            onClick={() => setAllSections(false)}
            type="button"
          >
            Collapse All
          </button>
        </div>
      </div>

      <CollapsibleSection
        actions={
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetOfficeSettingsToDefaults(); }}
            type="button"
          >
            Reset Office Defaults
          </button>
        }
        isOpen={expandedSections.office}
        onToggle={() => toggleSection("office")}
        title="Office Settings"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Office Name</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => updateOfficeSettings({ officeName: event.target.value })}
              value={officeSettings.officeName}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Phone</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => updateOfficeSettings({ phone: formatUsPhoneInput(event.target.value) })}
              value={officeSettings.phone}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Fax</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => updateOfficeSettings({ fax: formatUsPhoneInput(event.target.value) })}
              value={officeSettings.fax}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Email</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => updateOfficeSettings({ email: event.target.value })}
              value={officeSettings.email}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Doctor Name</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => updateOfficeSettings({ doctorName: event.target.value })}
              value={officeSettings.doctorName}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Office Logo</span>
            <input
              accept="image/*"
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(event) => handleOfficeLogoUpload(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Address</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => updateOfficeSettings({ address: event.target.value })}
              value={officeSettings.address}
            />
          </label>
          {officeSettings.logoDataUrl && (
            <div className="sm:col-span-2">
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold text-[var(--text-muted)]">Logo Preview</p>
                <img
                  alt="Office logo preview"
                  className="mt-2 max-h-20 rounded border border-[var(--line-soft)] bg-white p-1"
                  src={officeSettings.logoDataUrl}
                />
                <button
                  className="mt-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold"
                  onClick={() => updateOfficeSettings({ logoDataUrl: "" })}
                  type="button"
                >
                  Remove Logo
                </button>
              </div>
            </div>
          )}
          <div className="sm:col-span-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4 space-y-3">
            <div>
              <h5 className="text-sm font-semibold text-[var(--text-main)]">Delete Password</h5>
              <p className="text-xs text-[var(--text-muted)]">
                {officeSettings.deletePassword
                  ? "A delete password is set. To change it, verify your identity below."
                  : "No delete password is set. Set one to enable patient deletion."}
              </p>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-[var(--text-muted)]">{officeSettings.deletePassword ? "New" : ""} Delete Password</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(e) => setDeletePasswordDraft(e.target.value)}
                placeholder={officeSettings.deletePassword ? "Enter new delete password" : "Create a delete password"}
                type="password"
                value={deletePasswordDraft}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Login Email (verify identity)</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setDeletePasswordLoginEmail(e.target.value)}
                  placeholder="you@clinic.com"
                  type="email"
                  value={deletePasswordLoginEmail}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Login Password (verify identity)</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setDeletePasswordLoginPassword(e.target.value)}
                  placeholder="Your account password"
                  type="password"
                  value={deletePasswordLoginPassword}
                />
              </label>
            </div>
            {deletePasswordError && <p className="text-sm font-semibold text-red-600">{deletePasswordError}</p>}
            {deletePasswordSuccess && <p className="text-sm font-semibold text-emerald-700">{deletePasswordSuccess}</p>}
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={deletePasswordSaving}
              onClick={handleSetDeletePassword}
              type="button"
            >
              {deletePasswordSaving ? "Verifying..." : officeSettings.deletePassword ? "Update Delete Password" : "Set Delete Password"}
            </button>
          </div>
        </div>
        {officeSettingsMessage && (
          <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">{officeSettingsMessage}</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetContactCategoriesToDefaults(); }}
            type="button"
          >
            Reset Category Defaults
          </button>
        }
        description="Control contact category names used by Contacts and patient attorney/referral workflows."
        isOpen={expandedSections.contactCategories}
        onToggle={() => toggleSection("contactCategories")}
        title="Contact Categories"
      >
        <div className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[240px] grow gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">New Category</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setContactCategoryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddContactCategory();
                  }
                }}
                placeholder="Example: Chiropractic"
                value={contactCategoryDraft}
              />
            </label>
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddContactCategory}
              type="button"
            >
              Add Category
            </button>
          </div>

          {contactCategoryError && (
            <p className="mt-2 text-sm font-semibold text-[#b43b34]">{contactCategoryError}</p>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {contactCategories.map((category) => (
              <div
                key={`contact-category-${category}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2"
              >
                <span className="font-semibold">{category}</span>
                <button
                  className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                  onClick={() => handleRemoveContactCategory(category)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            {contactCategories.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">No categories configured yet.</p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetScheduleSettingsToDefaults(); }}
            type="button"
          >
            Reset Schedule Defaults
          </button>
        }
        description="Configure appointment statuses and office hours used by the Schedule page."
        isOpen={expandedSections.schedule}
        onToggle={() => toggleSection("schedule")}
        title="Schedule Settings"
      >
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">Appointment Statuses</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              These statuses are available when clicking a patient in Schedule.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {appointmentStatusOptions.map((status) => (
                <span
                  key={`appointment-status-${status}`}
                  className="rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1 text-sm font-semibold"
                >
                  {formatAppointmentStatusLabel(status)}
                </span>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2">
                <input
                  checked={scheduleSettings.enforceOfficeHours}
                  className="mt-1"
                  onChange={(event) => setEnforceOfficeHours(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-semibold">Block appointments outside office hours</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Prevent booking beyond configured open hours.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2">
                <input
                  checked={scheduleSettings.allowOverride}
                  className="mt-1"
                  onChange={(event) => setAllowOverride(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-semibold">
                    Allow override for outside-hours booking
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Users can still schedule outside office hours when needed.
                  </span>
                </span>
              </label>

              <div className="grid gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold">Allowed appointment interval</span>
                  <select
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    onChange={(event) => setAppointmentIntervalMin(Number(event.target.value))}
                    value={scheduleSettings.appointmentIntervalMin}
                  >
                    {appointmentIntervalOptions.map((minutes) => (
                      <option key={`appointment-interval-${minutes}`} value={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-[var(--text-muted)]">
                    Example: with 15 minutes selected, appointments can start at 8:00, 8:15, 8:30, and so on.
                  </span>
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold">Max appointments per time slot</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    max={20}
                    min={1}
                    onChange={(event) =>
                      setMaxAppointmentsPerSlot(Math.max(1, Number(event.target.value) || 1))
                    }
                    type="number"
                    value={scheduleSettings.maxAppointmentsPerSlot}
                  />
                  <span className="text-xs text-[var(--text-muted)]">
                    Example: if set to 4, up to four appointments can share the same start time.
                  </span>
                </label>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">Office Hours</h4>
            <div className="mt-3 space-y-2">
              {scheduleSettings.officeHours.map((officeHour) => (
                <div
                  key={`office-hours-${officeHour.dayOfWeek}`}
                  className="grid items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2 sm:grid-cols-[130px_110px_1fr_1fr]"
                >
                  <span className="text-sm font-semibold">{weekdayLabels[officeHour.dayOfWeek]}</span>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      checked={officeHour.enabled}
                      onChange={(event) =>
                        updateOfficeHour(officeHour.dayOfWeek, { enabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                    Open
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      Start
                    </span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                      disabled={!officeHour.enabled}
                      onChange={(event) =>
                        updateOfficeHour(officeHour.dayOfWeek, { start: event.target.value })
                      }
                      type="time"
                      value={officeHour.start}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      End
                    </span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                      disabled={!officeHour.enabled}
                      onChange={(event) =>
                        updateOfficeHour(officeHour.dayOfWeek, { end: event.target.value })
                      }
                      type="time"
                      value={officeHour.end}
                    />
                  </label>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-lg font-semibold">Appointment Types</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Create types used in Schedule when booking appointments.
              </p>
            </div>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetAppointmentTypesToDefaults(); }}
              type="button"
            >
              Reset Type Defaults
            </button>
          </div>

          <div className="mb-3 grid gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 sm:grid-cols-[1.6fr_90px_130px_130px_auto]">
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Add Appointment Type
              </span>
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                onChange={(event) => setAppointmentTypeNameDraft(event.target.value)}
                placeholder="Example: Personal Injury Office Visit"
                value={appointmentTypeNameDraft}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Color
              </span>
              <input
                className="h-10 rounded-lg border border-[var(--line-soft)] bg-white p-1"
                onChange={(event) => setAppointmentTypeColorDraft(event.target.value)}
                type="color"
                value={appointmentTypeColorDraft}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Duration (Min)
              </span>
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                min={5}
                onChange={(event) => setAppointmentTypeDurationDraft(Number(event.target.value) || 5)}
                type="number"
                value={appointmentTypeDurationDraft}
              />
            </label>
            <label className="inline-flex items-center gap-2 self-end pb-2 text-sm font-semibold">
              <input
                checked={appointmentTypeDefaultDraft}
                onChange={(event) => setAppointmentTypeDefaultDraft(event.target.checked)}
                type="checkbox"
              />
              Default
            </label>
            <button
              className="self-end rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white"
              onClick={handleAddAppointmentType}
              type="button"
            >
              Add Type
            </button>
          </div>

          {appointmentTypeError && (
            <p className="mb-3 text-sm font-semibold text-[#b43b34]">{appointmentTypeError}</p>
          )}

          <label className="mb-3 grid gap-1 sm:max-w-[420px]">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Default Appointment Type</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setDefaultAppointmentType(event.target.value)}
              value={defaultAppointmentTypeId}
            >
              {appointmentTypes.map((entry) => (
                <option key={`default-type-${entry.id}`} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          <div className="overflow-x-auto">
            <div className="min-w-[760px] space-y-2">
              <div className="grid grid-cols-[40px_1.8fr_120px_140px_110px_90px] items-center gap-2 border-b border-[var(--line-soft)] pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                <span />
                <span>Name</span>
                <span>Color</span>
                <span>Duration</span>
                <span>Default</span>
                <span />
              </div>

              {appointmentTypes.map((entry) => (
                <div
                  key={`appointment-type-row-${entry.id}`}
                  className="grid grid-cols-[40px_1.8fr_120px_140px_110px_90px] items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2"
                >
                  <span className="text-xl font-semibold text-[var(--brand-primary)]">≡</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    onChange={(event) =>
                      updateAppointmentType(entry.id, {
                        name: event.target.value,
                      })
                    }
                    value={entry.name}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      className="h-10 w-14 rounded-lg border border-[var(--line-soft)] bg-white p-1"
                      onChange={(event) =>
                        updateAppointmentType(entry.id, {
                          color: event.target.value,
                        })
                      }
                      type="color"
                      value={entry.color}
                    />
                    <span
                      aria-hidden
                      className="inline-block h-4 w-4 rounded-full border border-[var(--line-soft)]"
                      style={{ backgroundColor: entry.color }}
                    />
                  </div>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    min={5}
                    onChange={(event) =>
                      updateAppointmentType(entry.id, {
                        durationMin: Number(event.target.value) || 5,
                      })
                    }
                    type="number"
                    value={entry.durationMin}
                  />
                  <label className="inline-flex items-center gap-2 text-sm font-semibold">
                    <input
                      checked={entry.isDefault}
                      onChange={() => setDefaultAppointmentType(entry.id)}
                      type="radio"
                    />
                    Default
                  </label>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                    disabled={appointmentTypes.length <= 1}
                    onClick={() => { if (window.confirm(`Remove appointment type "${entry.name}"?`)) removeAppointmentType(entry.id); }}
                    type="button"
                  >
                    Remove
                  </button>
                  <p className="col-start-2 text-xs text-[var(--text-muted)]">
                    {formatDurationMinutes(entry.durationMin)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-lg font-semibold">Room Settings</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Create rooms for optional assignment during patient check-in.
              </p>
            </div>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetRoomSettingsToDefaults(); }}
              type="button"
            >
              Reset Rooms
            </button>
          </div>

          <label className="mb-3 flex items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2">
            <input
              checked={scheduleRooms.enableRoomSelectionOnCheckIn}
              className="mt-1"
              onChange={(event) => setEnableRoomSelectionOnCheckIn(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="block text-sm font-semibold">Prompt for room at check-in</span>
              <span className="text-xs text-[var(--text-muted)]">
                When enabled, checking in from Schedule can assign a room. If skipped, check-in still proceeds.
              </span>
            </span>
          </label>

          <div className="mb-3 grid gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 sm:grid-cols-[1.6fr_110px_100px_auto]">
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Add Room
              </span>
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                onChange={(event) => setRoomNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddRoom();
                  }
                }}
                placeholder="Example: Room 1"
                value={roomNameDraft}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Color
              </span>
              <input
                className="h-10 rounded-lg border border-[var(--line-soft)] bg-white p-1"
                onChange={(event) => setRoomColorDraft(event.target.value)}
                type="color"
                value={roomColorDraft}
              />
            </label>

            <div className="self-end pb-2">
              <span
                aria-hidden
                className="inline-block h-5 w-5 rounded-full border border-[var(--line-soft)]"
                style={{ backgroundColor: roomColorDraft }}
              />
            </div>

            <button
              className="self-end rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white"
              onClick={handleAddRoom}
              type="button"
            >
              Add Room
            </button>
          </div>

          {roomError && <p className="mb-3 text-sm font-semibold text-[#b43b34]">{roomError}</p>}

          <div className="overflow-x-auto">
            <div className="min-w-[700px] space-y-2">
              <div className="grid grid-cols-[40px_1.9fr_140px_110px_90px] items-center gap-2 border-b border-[var(--line-soft)] pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                <span />
                <span>Room Name</span>
                <span>Color</span>
                <span>Active</span>
                <span />
              </div>

              {rooms.map((room) => (
                <div
                  key={`room-row-${room.id}`}
                  className="grid grid-cols-[40px_1.9fr_140px_110px_90px] items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2"
                >
                  <span className="text-xl font-semibold text-[var(--brand-primary)]">≡</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    onChange={(event) => updateRoom(room.id, { name: event.target.value })}
                    value={room.name}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      className="h-10 w-14 rounded-lg border border-[var(--line-soft)] bg-white p-1"
                      onChange={(event) => updateRoom(room.id, { color: event.target.value })}
                      type="color"
                      value={room.color}
                    />
                    <span
                      aria-hidden
                      className="inline-block h-4 w-4 rounded-full border border-[var(--line-soft)]"
                      style={{ backgroundColor: room.color }}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold">
                    <input
                      checked={room.active}
                      onChange={(event) => updateRoom(room.id, { active: event.target.checked })}
                      type="checkbox"
                    />
                    Active
                  </label>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                    onClick={() => { if (window.confirm(`Remove room "${room.name}"?`)) removeRoom(room.id); }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {rooms.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No rooms configured yet.</p>
              )}
            </div>
          </div>
        </article>
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetPriorityRulesToDefaults(); }}
              type="button"
            >
              Reset Priority Rules
            </button>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetDashboardWorkspaceSettingsToDefaults(); }}
              type="button"
            >
              Reset Task / Follow Up Defaults
            </button>
          </div>
        }
        description="Configure Case Flow rules, To Do preferences, and case status display."
        isOpen={expandedSections.dashboard}
        onToggle={() => toggleSection("dashboard")}
        title="Reminder Settings"
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">Case Status</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Choose which case statuses to track.
            </p>
            <div className="mt-3 grid gap-2">
              {caseStatuses.map((status) => (
                <label
                  key={`dashboard-case-status-${status.name}`}
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1.5 text-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                      style={{ backgroundColor: status.color }}
                    />
                    {status.name}
                  </span>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    <input
                      checked={status.showOnDashboard}
                      onChange={() => toggleDashboardVisibility(status.name)}
                      type="checkbox"
                    />
                    Show
                  </span>
                </label>
              ))}
              {caseStatuses.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">Add case statuses first.</p>
              )}
            </div>
          </article>

          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">To Do</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Controls default behavior for the To Do task list.
            </p>
            <div className="mt-3 space-y-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  checked={dashboardWorkspaceSettings.myTasks.openOnly}
                  onChange={(event) => setTasksOpenOnly(event.target.checked)}
                  type="checkbox"
                />
                Default to Open tasks only
              </label>
            </div>
          </article>

          <article className="xl:col-span-2 rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">Case Flow</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Configure when each category appears and clears in the Case Flow on the Dashboard.
            </p>

            <div className="mt-4 space-y-4">
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  checked={dashboardWorkspaceSettings.patientFollowUp.showOnDashboard}
                  onChange={(event) => setFollowUpShowOnDashboard(event.target.checked)}
                  type="checkbox"
                />
                Enable Case Flow
              </label>

              {/* X-Ray rules */}
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
                <div className="flex items-center gap-3">
                  <input
                    checked={dashboardWorkspaceSettings.patientFollowUp.includeXray}
                    onChange={(event) => setFollowUpIncludeXray(event.target.checked)}
                    type="checkbox"
                  />
                  <p className="text-sm font-bold">X-Ray</p>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Appear</span>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={dashboardWorkspaceSettings.patientFollowUp.xrayAppearAuto}
                        onChange={(event) => setXrayAppearAuto(event.target.checked)}
                        type="checkbox"
                      />
                      Auto (on case creation)
                    </label>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Cleared when</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {([
                        ["patientRefused", "Patient Refused"],
                        ["completedPriorCare", "Completed Prior Care"],
                        ["reviewed", "Reviewed"],
                        ["noXray", "No X-Ray"],
                      ] as const).map(([val, label]) => (
                        <label key={val} className="inline-flex items-center gap-1.5 text-sm">
                          <input
                            checked={dashboardWorkspaceSettings.patientFollowUp.xrayClearedBy.includes(val)}
                            onChange={(event) => toggleXrayClearedBy(val, event.target.checked)}
                            type="checkbox"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">No Report Received Warning</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Warn after</span>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        min={0}
                        onChange={(event) => setXrayNoReportWarningDays(Number(event.target.value) || 0)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.xrayNoReportWarningDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from sent date (0 = off)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* MRI rules */}
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
                <div className="flex items-center gap-3">
                  <input
                    checked={dashboardWorkspaceSettings.patientFollowUp.includeMriCt}
                    onChange={(event) => setFollowUpIncludeMriCt(event.target.checked)}
                    type="checkbox"
                  />
                  <p className="text-sm font-bold">MRI / CT</p>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Appear</span>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={dashboardWorkspaceSettings.patientFollowUp.mriAppearMode === "auto"}
                        name="mri-appear-mode"
                        onChange={() => setMriAppearMode("auto")}
                        type="radio"
                      />
                      Auto (on case creation)
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-sm font-medium">
                        <input
                          checked={dashboardWorkspaceSettings.patientFollowUp.mriAppearMode === "days_from_initial"}
                          name="mri-appear-mode"
                          onChange={() => setMriAppearMode("days_from_initial")}
                          type="radio"
                        />
                        After
                      </label>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        disabled={dashboardWorkspaceSettings.patientFollowUp.mriAppearMode !== "days_from_initial"}
                        min={1}
                        onChange={(event) => setMriAppearDays(Number(event.target.value) || 1)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.mriAppearDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from initial</span>
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Cleared when</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {([
                        ["patientRefused", "Patient Refused"],
                        ["completedPriorCare", "Completed Prior Care"],
                        ["reviewed", "Reviewed"],
                        ["noMri", "No MRI"],
                      ] as const).map(([val, label]) => (
                        <label key={val} className="inline-flex items-center gap-1.5 text-sm">
                          <input
                            checked={dashboardWorkspaceSettings.patientFollowUp.mriCtClearedBy.includes(val)}
                            onChange={(event) => toggleMriCtClearedBy(val, event.target.checked)}
                            type="checkbox"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">No Report Received Warning</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Warn after</span>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        min={0}
                        onChange={(event) => setMriNoReportWarningDays(Number(event.target.value) || 0)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.mriNoReportWarningDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from sent date (0 = off)</span>
                    </div>
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">No Schedule Date Warning</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Warn after</span>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        min={0}
                        onChange={(event) => setMriNoScheduleWarningDays(Number(event.target.value) || 0)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.mriNoScheduleWarningDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from sent date (0 = off)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Specialist rules */}
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
                <div className="flex items-center gap-3">
                  <input
                    checked={dashboardWorkspaceSettings.patientFollowUp.includeSpecialist}
                    onChange={(event) => setFollowUpIncludeSpecialist(event.target.checked)}
                    type="checkbox"
                  />
                  <p className="text-sm font-bold">Specialist</p>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Appear</span>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={dashboardWorkspaceSettings.patientFollowUp.specialistAppearWhen === "auto"}
                        name="specialist-appear-mode"
                        onChange={() => setSpecialistAppearWhen("auto")}
                        type="radio"
                      />
                      Auto (on case creation)
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={dashboardWorkspaceSettings.patientFollowUp.specialistAppearWhen === "mri_sent"}
                        name="specialist-appear-mode"
                        onChange={() => setSpecialistAppearWhen("mri_sent")}
                        type="radio"
                      />
                      After MRI Sent
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={dashboardWorkspaceSettings.patientFollowUp.specialistAppearWhen === "mri_reviewed"}
                        name="specialist-appear-mode"
                        onChange={() => setSpecialistAppearWhen("mri_reviewed")}
                        type="radio"
                      />
                      Once MRI Reviewed
                    </label>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Cleared when</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {([
                        ["patientRefused", "Patient Refused"],
                        ["completedPriorCare", "Completed Prior Care"],
                        ["report", "Received"],
                        ["noPm", "No Spcl"],
                      ] as const).map(([val, label]) => (
                        <label key={val} className="inline-flex items-center gap-1.5 text-sm">
                          <input
                            checked={dashboardWorkspaceSettings.patientFollowUp.specialistClearedBy.includes(val)}
                            onChange={(event) => toggleSpecialistClearedBy(val, event.target.checked)}
                            type="checkbox"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">No Report Received Warning</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Warn after</span>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        min={0}
                        onChange={(event) => setSpecialistNoReportWarningDays(Number(event.target.value) || 0)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.specialistNoReportWarningDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from sent date (0 = off)</span>
                    </div>
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">No Schedule Date Warning</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Warn after</span>
                      <input
                        className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        min={0}
                        onChange={(event) => setSpecialistNoScheduleWarningDays(Number(event.target.value) || 0)}
                        type="number"
                        value={dashboardWorkspaceSettings.patientFollowUp.specialistNoScheduleWarningDays}
                      />
                      <span className="text-sm text-[var(--text-muted)]">days from sent date (0 = off)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lien rules */}
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
                <div className="flex items-center gap-3">
                  <input
                    checked={dashboardWorkspaceSettings.patientFollowUp.includeLienLop}
                    onChange={(event) => setFollowUpIncludeLienLop(event.target.checked)}
                    type="checkbox"
                  />
                  <p className="text-sm font-bold">{lienLabel}</p>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Cleared when status is</span>
                    <select
                      className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      onChange={(event) => {
                        const selected = event.target.value;
                        if (selected) {
                          setFollowUpLienLopClearStatuses([selected]);
                        }
                      }}
                      value={dashboardWorkspaceSettings.patientFollowUp.lienLopClearStatuses[0] ?? ""}
                    >
                      {followUpLienClearStatusOptions.map((statusName) => (
                        <option key={statusName} value={statusName}>
                          {statusName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Additional alert rules */}
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                  Additional Alert Rules
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={priorityRules.includeNoUpdate}
                        onChange={(event) => setIncludeNoUpdate(event.target.checked)}
                        type="checkbox"
                      />
                      No Update alert after
                    </label>
                    <input
                      className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      disabled={!priorityRules.includeNoUpdate}
                      min={1}
                      onChange={(event) => setNoUpdateDaysThreshold(Number(event.target.value) || 1)}
                      type="number"
                      value={priorityRules.noUpdateDaysThreshold}
                    />
                    <span className="text-sm text-[var(--text-muted)]">days</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        checked={priorityRules.includeRbStatusCheck}
                        onChange={(event) => setIncludeRbStatusCheck(event.target.checked)}
                        type="checkbox"
                      />
                      Payment Status after
                    </label>
                    <input
                      className="w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      disabled={!priorityRules.includeRbStatusCheck}
                      min={1}
                      onChange={(event) => setRbStatusCheckDaysThreshold(Number(event.target.value) || 1)}
                      type="number"
                      value={priorityRules.rbStatusCheckDaysThreshold}
                    />
                    <span className="text-sm text-[var(--text-muted)]">days from report submitted</span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  MRI Due and No Update alerts pause after a case is Discharged or once a report is submitted. Paid/Dropped cases are automatically excluded from Case Flow.
                </p>
              </div>

              {/* Thresholds */}
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Stale after (days)</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    min={1}
                    onChange={(event) => setFollowUpStaleDaysThreshold(Number(event.target.value) || 1)}
                    type="number"
                    value={dashboardWorkspaceSettings.patientFollowUp.staleDaysThreshold}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Max Case Flow rows</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    min={1}
                    onChange={(event) => setFollowUpMaxItems(Number(event.target.value) || 1)}
                    type="number"
                    value={dashboardWorkspaceSettings.patientFollowUp.maxItems}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Max alert items</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    min={1}
                    onChange={(event) => setMaxItems(Number(event.target.value) || 1)}
                    type="number"
                    value={priorityRules.maxItems}
                  />
                </label>
              </div>
            </div>
          </article>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => setAllStatsVisible(true)}
              type="button"
            >
              Select All
            </button>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => setAllStatsVisible(false)}
              type="button"
            >
              Clear All
            </button>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetQuickStatsToDefaults(); }}
              type="button"
            >
              Reset Quick Stats Defaults
            </button>
          </div>
        }
        description="Choose which quick patient stats are shown in Patient File next to Re-Exam and Related Cases."
        isOpen={expandedSections.quickStats}
        onToggle={() => toggleSection("quickStats")}
        title="Quick Stats"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {quickStatOptions.map((option) => (
            <label
              className="flex items-start gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              key={`quick-stat-option-${option.key}`}
            >
              <input
                checked={quickStatsSettings.visibleStats[option.key]}
                className="mt-1"
                onChange={(event) => setStatVisibility(option.key, event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-[var(--text-muted)]">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetCaseStatusesToDefaults(); }}
              type="button"
            >
              Reset Status Defaults
            </button>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetLienOptionsToDefaults(); }}
              type="button"
            >
              Reset Lien / LOP Defaults
            </button>
          </div>
        }
        description="Create and maintain case status names and colors."
        isOpen={expandedSections.caseStatuses}
        onToggle={() => toggleSection("caseStatuses")}
        title="Case Status Categories"
      >
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <label className="min-w-[220px] grow space-y-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">New Case Status</span>
            <input
              className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setStatusNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddCaseStatus();
                }
              }}
              placeholder="Example: Pending Records"
              value={statusNameDraft}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Status Color</span>
            <input
              className="h-10 w-16 rounded-lg border border-[var(--line-soft)] bg-white p-1"
              onChange={(event) => setStatusColorDraft(event.target.value)}
              type="color"
              value={statusColorDraft}
            />
          </label>

          <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold">
            <input
              checked={statusCaseClosedDraft}
              onChange={(event) => setStatusCaseClosedDraft(event.target.checked)}
              type="checkbox"
            />
            Case Closed
          </label>

          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
            onClick={handleAddCaseStatus}
            type="button"
          >
            Add Status
          </button>
        </div>

        <div className="space-y-2">
          {caseStatuses.map((status) => (
            <div
              key={status.name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full border border-[var(--line-soft)]"
                  style={{ backgroundColor: status.color }}
                />
                <span className="font-semibold">{status.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    checked={status.isCaseClosed}
                    onChange={(event) => setStatusClosed(status.name, event.target.checked)}
                    type="checkbox"
                  />
                  Case Closed
                </label>
                <label className="inline-flex items-center gap-2 text-sm" title="Automatically move patient folder into a status-named folder in My Files">
                  <input
                    checked={status.autoFolder ?? false}
                    onChange={(event) => setStatusAutoFolder(status.name, event.target.checked)}
                    type="checkbox"
                  />
                  Auto Folder
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  Color
                  <input
                    className="h-8 w-10 rounded-md border border-[var(--line-soft)] bg-white p-1"
                    onChange={(event) => setStatusColor(status.name, event.target.value)}
                    type="color"
                    value={status.color}
                  />
                </label>
                <button
                  aria-label={`Remove ${status.name}`}
                  className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                  onClick={() => { if (window.confirm(`Remove status "${status.name}"?`)) removeStatus(status.name); }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {caseStatuses.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">No statuses configured yet.</p>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <h4 className="text-lg font-semibold">Lien / LOP</h4>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Configure the patient-file label and dropdown options for this field.
          </p>

          <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="self-start rounded-xl border border-[var(--line-soft)] bg-white p-3">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Field Label</span>
              <div className="mt-2 inline-flex w-full rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-1">
                {(["Lien", "LOP"] as const).map((label) => {
                  const active = lienLabel === label;
                  return (
                    <button
                      aria-pressed={active}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        active
                          ? "bg-[var(--brand-primary)] text-white shadow-sm"
                          : "text-[var(--text-main)] hover:bg-white"
                      }`}
                      key={label}
                      onClick={() => setLienLabel(label)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                This label appears in the patient-file field.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">
                  Add {lienLabel} Option
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-[240px] grow rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => setLienOptionDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddLienOption();
                      }
                    }}
                    placeholder="Example: Sent to Attorney"
                    value={lienOptionDraft}
                  />
                  <button
                    className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                    onClick={handleAddLienOption}
                    type="button"
                  >
                    Add Option
                  </button>
                </div>
              </label>

              <div className="mt-3 grid gap-2">
                {lienOptions.map((option, index) => (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white p-2"
                    key={`${option}-${index}`}
                  >
                    <input
                      className="min-w-[220px] grow rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5"
                      onChange={(event) => updateLienOption(index, event.target.value)}
                      value={option}
                    />
                    <button
                      className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                      disabled={index === 0}
                      onClick={() => moveLienOption(index, "up")}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                      disabled={index === lienOptions.length - 1}
                      onClick={() => moveLienOption(index, "down")}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                      disabled={lienOptions.length <= 1}
                      onClick={() => { if (window.confirm(`Remove lien option "${lienOptions[index]}"?`)) removeLienOption(index); }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        description="Configure Subjective, Objective, Assessment, and Plan macro templates."
        isOpen={expandedSections.soapMacros}
        onToggle={() => toggleSection("soapMacros")}
        title="SOAP Macro Settings"
      >
        <MacroSettingsPanel />
      </CollapsibleSection>

      <CollapsibleSection
        description="Manage treatment macros, diagnosis codes, and one-click diagnosis bundles."
        isOpen={expandedSections.billingMacros}
        onToggle={() => toggleSection("billingMacros")}
        title="Billing Macro Settings"
      >
        <BillingMacroSettingsPanel />
      </CollapsibleSection>

      <CollapsibleSection
        description="Create office cash packages (visits, included CPTs, discounted price, and auto discount %)."
        isOpen={expandedSections.packageBuilder}
        onToggle={() => toggleSection("packageBuilder")}
        title="Package Builder"
      >
        <PackageBuilderSettingsPanel />
      </CollapsibleSection>

      <CollapsibleSection
        description="Create and edit document templates that merge patient and case data into printable PDFs."
        isOpen={expandedSections.documents}
        onToggle={() => toggleSection("documents")}
        title="Document Template Settings"
      >
        <DocumentTemplateSettingsPanel
          officeSettings={officeSettings}
          preferredScope={preferredDocumentScope}
        />
      </CollapsibleSection>

      <CollapsibleSection
        description="Create fully customizable narrative report templates that can pull from patient demographics, encounters, imaging, specialists, diagnoses, and runtime prompts."
        isOpen={expandedSections.reports}
        onToggle={() => toggleSection("reports")}
        title="Narrative Report Builder"
      >
        <ReportTemplateSettingsPanel />
      </CollapsibleSection>

      <CollapsibleSection
        actions={
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={() => {
              if (window.confirm("Reset email settings to defaults?")) resetEmailSettings();
            }}
            type="button"
          >
            Reset Defaults
          </button>
        }
        description="Customize the subject line and body message used when emailing files from My Files."
        isOpen={expandedSections.emailSettings}
        onToggle={() => toggleSection("emailSettings")}
        title="Email Settings"
      >
        <div className="grid gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)]">Available Fields (click to copy)</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Paste these tokens into the subject or body. Patient fields auto-fill when emailing from a patient folder.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {emailAutoFields.map((field) => (
                <button
                  key={field}
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-mono hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(`{{${field}}}`);
                  }}
                  title={`${emailAutoFieldLabels[field]} — click to copy {{${field}}}`}
                  type="button"
                >
                  <span className="text-blue-600">{`{{${field}}}`}</span>
                  <span className="ml-1 font-sans text-[var(--text-muted)]">{emailAutoFieldLabels[field]}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Email Subject</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(e) => updateEmailSettings({ subjectTemplate: e.target.value })}
              placeholder={getDefaultEmailSettings().subjectTemplate}
              value={emailSettings.subjectTemplate}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Email Body</span>
            <textarea
              className="min-h-[100px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(e) => updateEmailSettings({ bodyTemplate: e.target.value })}
              placeholder={getDefaultEmailSettings().bodyTemplate}
              rows={4}
              value={emailSettings.bodyTemplate}
            />
          </label>
          <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <p className="text-xs font-semibold text-[var(--text-muted)]">Preview (example: John Doe, file X-Ray Report.pdf)</p>
            <p className="mt-1 text-sm"><span className="font-semibold">Subject:</span> {emailSettings.subjectTemplate.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_, key: string) => {
              const examples: Record<string, string> = { FILE_NAME: "X-Ray Report.pdf", FIRST_NAME: "John", LAST_NAME: "Doe", FULL_NAME: "John Doe", MR_MRS_MS_LAST_NAME: "Mr. Doe", DOB: "05/12/1990", INJURY_DATE: "03/01/2026", OFFICE_NAME: "Prime Spine", TODAY: new Date().toLocaleDateString("en-US") };
              return examples[key] ?? "";
            })}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm"><span className="font-semibold">Body:</span> {emailSettings.bodyTemplate.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_, key: string) => {
              const examples: Record<string, string> = { FILE_NAME: "X-Ray Report.pdf", FIRST_NAME: "John", LAST_NAME: "Doe", FULL_NAME: "John Doe", MR_MRS_MS_LAST_NAME: "Mr. Doe", DOB: "05/12/1990", INJURY_DATE: "03/01/2026", OFFICE_NAME: "Prime Spine", TODAY: new Date().toLocaleDateString("en-US") };
              return examples[key] ?? "";
            })}</p>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        description="Export selected settings/data into a backup file, then import into another office setup."
        isOpen={expandedSections.backup}
        onToggle={() => toggleSection("backup")}
        title="Backup & Restore"
      >
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() => setAllBackupSelections(true)}
                type="button"
              >
                Select All
              </button>
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() => setAllBackupSelections(false)}
                type="button"
              >
                Clear All
              </button>
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() =>
                  applyBackupPreset(["soapMacros", "billingMacros", "documentTemplates", "reportTemplates"])
                }
                type="button"
              >
                Macros + Letters Only
              </button>
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() =>
                  applyBackupPreset([
                    "officeSettings",
                    "quickStats",
                    "scheduleSettings",
                    "roomSettings",
                    "appointmentTypes",
                    "keyDates",
                  ])
                }
                type="button"
              >
                Office + Schedule Only
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {backupModules.map((module) => (
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2"
                  key={`backup-module-${module.id}`}
                >
                  <input
                    checked={backupSelections[module.id]}
                    className="mt-1"
                    onChange={() => toggleBackupSelection(module.id)}
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{module.label}</span>
                    <span className="text-xs text-[var(--text-muted)]">{module.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Selected modules: {selectedBackupModules.length} • Storage keys included: {selectedBackupKeys.length}
            </p>
          </article>

          <article className="space-y-3 rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <h4 className="text-lg font-semibold">Export Backup</h4>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Download a JSON backup for transfer to another office or for your own archive.
              </p>
              <button
                className="mt-3 w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={handleExportBackup}
                type="button"
              >
                Export Selected Backup
              </button>
            </div>

            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <h4 className="text-lg font-semibold">Import Backup</h4>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Import selected modules from a backup JSON and overwrite current values. Legacy migration also supports
                files with <span className="font-semibold">patients</span>, <span className="font-semibold">key dates</span>, and{" "}
                <span className="font-semibold">contacts</span> collections.
              </p>
              <input
                accept=".json,application/json"
                className="mt-3 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                onChange={handleBackupFileSelected}
                ref={importFileInputRef}
                type="file"
              />
              {importBackupFile && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">Selected file: {importBackupFile.name}</p>
              )}
              <button
                className="mt-3 w-full rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={handleImportBackup}
                type="button"
              >
                Import Selected Modules
              </button>
            </div>

            {backupError && <p className="text-sm font-semibold text-[#b43b34]">{backupError}</p>}
            {backupMessage && (
              <p className="text-sm font-semibold text-[var(--brand-primary)]">{backupMessage}</p>
            )}
          </article>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        isOpen={expandedSections.recovery}
        onToggle={() => toggleSection("recovery")}
        title="Data Recovery"
        description="Recover lost data from cloud backup or local safety snapshot."
      >
        <div className="space-y-4">
          <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h4 className="text-lg font-semibold text-amber-900">Recover From Cloud (Supabase)</h4>
            <p className="mt-1 text-sm text-amber-800">
              If your data was synced to the cloud before it was lost, this will pull the most recent cloud snapshot
              and restore it to your local workspace. This overwrites any current local data.
            </p>
            <button
              className="mt-3 rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              disabled={recoveryLoading}
              onClick={async () => {
                setRecoveryError("");
                setRecoveryMessage("");
                setRecoveryLoading(true);
                try {
                  // First try the direct client-side recovery
                  let recovered = await recoverFromRemote();
                  if (!recovered) {
                    // Fall back to the server-side recovery API. The endpoint
                    // REQUIRES a bearer token and rejects workspace ids whose
                    // prefix doesn't match the caller — so we must have a
                    // session AND a properly-prefixed workspace_id. Previously
                    // we fell back to the bare string "main-office" when no
                    // session was found, which let the server return the
                    // legacy cross-user blob. We now short-circuit with a
                    // clear error instead.
                    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
                    const supabase = getSupabaseBrowserClient();
                    const { data: { session } } = supabase
                      ? await supabase.auth.getSession()
                      : { data: { session: null } };
                    if (!session?.user?.id || !session.access_token) {
                      setRecoveryError("You must be signed in to recover from the cloud.");
                      setRecoveryLoading(false);
                      return;
                    }
                    const workspaceId = `${session.user.id}:main-office`;
                    const res = await fetch("/api/recover-snapshot", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                      },
                      body: JSON.stringify({ workspaceId }),
                    });
                    if (res.ok) {
                      const result = await res.json();
                      if (result.snapshot && typeof result.snapshot === "object") {
                        for (const [key, value] of Object.entries(result.snapshot)) {
                          if (typeof key === "string" && key.startsWith("casemate.") && key !== "casemate.__safety-backup__.v1") {
                            window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
                          }
                        }
                        recovered = true;
                      }
                    }
                  }
                  if (recovered) {
                    setRecoveryMessage("Data recovered from cloud! Reload the page to see your data.");
                  } else {
                    setRecoveryError("No cloud snapshot found for your account.");
                  }
                } catch {
                  setRecoveryError("Failed to connect to cloud. Check your internet connection.");
                }
                setRecoveryLoading(false);
              }}
              type="button"
            >
              {recoveryLoading ? "Recovering..." : "Recover From Cloud"}
            </button>
          </article>

          <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
            <h4 className="text-lg font-semibold">Recover From Local Safety Backup</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              A safety backup is automatically created before any data clear or sync overwrite.
              {backupInfo.exists
                ? ` Last backup: ${new Date(backupInfo.backedUpAt).toLocaleString("en-US")}.`
                : " No safety backup found."}
            </p>
            <button
              className="mt-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-4 py-2 font-semibold disabled:opacity-50"
              disabled={!backupInfo.exists || recoveryLoading}
              onClick={() => {
                setRecoveryError("");
                setRecoveryMessage("");
                const restored = restoreFromSafetyBackup();
                if (restored) {
                  setRecoveryMessage("Data restored from safety backup! Reload the page to see your data.");
                } else {
                  setRecoveryError("Could not restore from safety backup.");
                }
              }}
              type="button"
            >
              Restore From Safety Backup
            </button>
          </article>

          {recoveryError && <p className="text-sm font-semibold text-red-600">{recoveryError}</p>}
          {recoveryMessage && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-800">{recoveryMessage}</p>
              <button
                className="mt-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reload Page Now
              </button>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        isOpen={expandedSections.subscription}
        onToggle={() => toggleSection("subscription")}
        title="Subscription"
        description="Manage your plan and billing details through Stripe."
      >
        <SubscriptionSection />
      </CollapsibleSection>

      <CollapsibleSection
        isOpen={expandedSections.account}
        onToggle={() => toggleSection("account")}
        title="Account / Change Password"
        description="Update your sign-in password."
      >
        <ChangePasswordSection />
      </CollapsibleSection>

      <CollapsibleSection
        isOpen={expandedSections.security}
        onToggle={() => toggleSection("security")}
        title="Security Baseline (Pre-PHI Checklist)"
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-muted)]">
          <li>Use only test data in local mode.</li>
          <li>Add MFA and role-based permissions before production launch.</li>
          <li>Enable full audit logs for user actions and data edits.</li>
          <li>Run backup and restore tests before go-live.</li>
          <li>Switch to HIPAA cloud with BAA before storing real PHI.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        isOpen={expandedSections.diagnostics}
        onToggle={() => toggleSection("diagnostics")}
        title="Diagnostics"
        description="Live view of your account, workspace, cloud row counts, and local storage — useful when data looks wrong."
      >
        <DiagnosticsSection />
      </CollapsibleSection>
    </div>
  );
}

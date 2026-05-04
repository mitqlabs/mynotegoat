"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useDashboardWorkspaceSettings } from "@/hooks/use-dashboard-workspace-settings";
import { usePatientFollowUpOverrides } from "@/hooks/use-patient-follow-up-overrides";
import { useTasks } from "@/hooks/use-tasks";
import { loadDashboardWorkspaceSettings } from "@/lib/dashboard-workspace-settings";
import { formatUsDateFromIso, type TaskPriority, type TaskRecord } from "@/lib/tasks";
import { getContrastTextColor, withAlpha } from "@/lib/color-utils";
import {
  buildCaseNumber,
  buildFollowUpItems,
  formatLeadingDateDisplay,
  formatUsDateDisplay,
  type FollowUpCategory,
} from "@/lib/follow-up-queue";
import { createPatientRecord, patients, type PatientMatrixField, type PatientRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { SmsSendMenu } from "@/components/sms-send-menu";
import { UsDateInput } from "@/components/us-date-input";
import { ScrollLock } from "@/components/scroll-lock";

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  if (trimmed.includes(",")) {
    const [last, rest] = trimmed.split(",", 2);
    return { firstName: (rest ?? "").trim(), lastName: last.trim() };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const COLUMN_ORDER_KEY = "casemate.patient-column-order.v1";
const SORT_COLUMN_KEY = "casemate.patient-sort-column.v1";
const SORT_ASC_KEY = "casemate.patient-sort-asc.v1";
type ListColumnId = "patient" | "initialExam" | "dateOfLoss" | "attorney" | "status";
const defaultColumnOrder: ListColumnId[] = ["patient", "initialExam", "dateOfLoss", "attorney", "status"];

// Case Flow columns
const CF_COLUMN_ORDER_KEY = "casemate.cf-column-order.v1";
// Legacy single-level sort keys, preserved only for migration to v2.
const CF_SORT_COLUMN_KEY = "casemate.cf-sort-column.v1";
const CF_SORT_ASC_KEY = "casemate.cf-sort-asc.v1";
const CF_SECONDARY_SORT_COLUMN_KEY = "casemate.cf-secondary-sort-column.v1";
const CF_SECONDARY_SORT_ASC_KEY = "casemate.cf-secondary-sort-asc.v1";
// New multi-level sort: array of {column, asc} stored as JSON, max 3 levels.
const CF_SORT_LEVELS_KEY = "casemate.cf-sort-levels.v1";
const CF_MAX_SORT_LEVELS = 3;
type CfSortLevel = { column: CfColumnId; asc: boolean };
const defaultCfSortLevels: CfSortLevel[] = [{ column: "age", asc: false }];
type CfColumnId = "patient" | "caseNumber" | "attorney" | "category" | "followUp" | "anchorDate" | "age" | "caseStatus";
const defaultCfColumnOrder: CfColumnId[] = ["patient", "caseNumber", "attorney", "category", "followUp", "anchorDate", "age", "caseStatus"];
const cfColumnLabels: Record<CfColumnId, string> = {
  patient: "Patient",
  caseNumber: "Case #",
  attorney: "Attorney",
  category: "Category",
  followUp: "Follow Up",
  anchorDate: "Anchor Date",
  age: "Age",
  caseStatus: "Case Status",
};

/**
 * Extract a 4-digit year from a date string in either ISO (YYYY-MM-DD) or US
 * (MM/DD/YYYY, MM/DD/YY) format. Returns "" for empty/invalid values so the
 * UI can skip them instead of rendering "NaN". Both formats exist in the
 * patients list: SQL-imported patients are stored as MM/DD/YYYY, while
 * UI-created patients are stored as YYYY-MM-DD.
 */
function extractYearFromDateString(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return "";
  const iso = trimmed.match(/^(\d{4})-\d{1,2}-\d{1,2}/);
  if (iso) return iso[1];
  const us = trimmed.match(/^\d{1,2}\/\d{1,2}\/(\d{2,4})$/);
  if (us) return us[1].length === 2 ? `20${us[1]}` : us[1];
  return "";
}

function loadCfColumnOrder(): CfColumnId[] {
  if (typeof window === "undefined") return defaultCfColumnOrder;
  try {
    const raw = window.localStorage.getItem(CF_COLUMN_ORDER_KEY);
    if (!raw) return defaultCfColumnOrder;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length !== defaultCfColumnOrder.length) return defaultCfColumnOrder;
    const valid = parsed.every((id) => defaultCfColumnOrder.includes(id as CfColumnId));
    return valid ? (parsed as CfColumnId[]) : defaultCfColumnOrder;
  } catch { return defaultCfColumnOrder; }
}

function isCfColumnId(value: unknown): value is CfColumnId {
  return typeof value === "string" && defaultCfColumnOrder.includes(value as CfColumnId);
}

function loadCfSortLevels(): CfSortLevel[] {
  if (typeof window === "undefined") return defaultCfSortLevels;
  try {
    const raw = window.localStorage.getItem(CF_SORT_LEVELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned: CfSortLevel[] = [];
        const seen = new Set<CfColumnId>();
        for (const entry of parsed) {
          if (!entry || typeof entry !== "object") continue;
          const col = (entry as { column?: unknown }).column;
          const asc = (entry as { asc?: unknown }).asc;
          if (!isCfColumnId(col) || typeof asc !== "boolean") continue;
          if (seen.has(col)) continue;
          seen.add(col);
          cleaned.push({ column: col, asc });
          if (cleaned.length >= CF_MAX_SORT_LEVELS) break;
        }
        if (cleaned.length > 0) return cleaned;
      }
    }
    // One-time migration from the old single-key + secondary-key pair.
    const oldCol = window.localStorage.getItem(CF_SORT_COLUMN_KEY);
    const oldAsc = window.localStorage.getItem(CF_SORT_ASC_KEY);
    const secCol = window.localStorage.getItem(CF_SECONDARY_SORT_COLUMN_KEY);
    const secAsc = window.localStorage.getItem(CF_SECONDARY_SORT_ASC_KEY);
    const migrated: CfSortLevel[] = [];
    if (isCfColumnId(oldCol)) {
      migrated.push({ column: oldCol, asc: oldAsc === "true" });
    }
    if (isCfColumnId(secCol) && (!migrated[0] || migrated[0].column !== secCol)) {
      migrated.push({ column: secCol, asc: secAsc === null ? true : secAsc === "true" });
    }
    return migrated.length > 0 ? migrated : defaultCfSortLevels;
  } catch {
    return defaultCfSortLevels;
  }
}

function saveCfSortLevels(levels: CfSortLevel[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CF_SORT_LEVELS_KEY, JSON.stringify(levels));
}

function saveCfColumnOrder(order: CfColumnId[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CF_COLUMN_ORDER_KEY, JSON.stringify(order));
}

const columnLabels: Record<ListColumnId, string> = {
  patient: "Patient",
  initialExam: "Initial Exam",
  dateOfLoss: "Date Of Injury",
  attorney: "Attorney",
  status: "Status",
};

function loadColumnOrder(): ListColumnId[] {
  if (typeof window === "undefined") return defaultColumnOrder;
  try {
    const raw = window.localStorage.getItem(COLUMN_ORDER_KEY);
    if (!raw) return defaultColumnOrder;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length !== defaultColumnOrder.length) return defaultColumnOrder;
    const valid = parsed.every((id) => defaultColumnOrder.includes(id as ListColumnId));
    return valid ? (parsed as ListColumnId[]) : defaultColumnOrder;
  } catch { return defaultColumnOrder; }
}

function saveColumnOrder(order: ListColumnId[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(order));
}

type PatientView = "list" | "detail" | "caseFlow" | "toDo" | "birthdays";

type DetailRow = {
  label: string;
  key: "attorney" | "dob" | "dateOfLoss" | PatientMatrixField;
};

type NewPatientDraft = {
  lastName: string;
  firstName: string;
  sex: PatientRecord["sex"] | "";
  maritalStatus: PatientRecord["maritalStatus"] | "";
  attorney: string;
  attorneyPhone: string;
  dob: string;
  dateOfLoss: string;
  initialExam: string;
  phone: string;
  email: string;
  addressStreet: string;
  addressUnit: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  lienStatus: string;
  priorCare: string;
  caseStatus: PatientRecord["caseStatus"];
  notes: string;
  isCashPatient: boolean;
};

const detailRowsTemplate: DetailRow[] = [
  { label: "Attorney", key: "attorney" },
  { label: "Contact", key: "contact" },
  { label: "DOB", key: "dob" },
  { label: "Date Of Injury", key: "dateOfLoss" },
  { label: "Initial Exam", key: "initialExam" },
  { label: "Lien", key: "lien" },
  { label: "Prior Care", key: "priorCare" },
  { label: "Xray Sent", key: "xraySent" },
  { label: "Xray Done", key: "xrayDone" },
  { label: "Xray Received", key: "xrayReceived" },
  { label: "Xray Reviewed", key: "xrayReviewed" },
  { label: "Re-Exam 1", key: "reExam1" },
  { label: "MRI Sent", key: "mriSent" },
  { label: "MRI Scheduled", key: "mriScheduled" },
  { label: "MRI Done", key: "mriDone" },
  { label: "MRI Received", key: "mriReceived" },
  { label: "MRI Reviewed", key: "mriReviewed" },
  { label: "Specialist Sent", key: "specialistSent" },
  { label: "Specialist Scheduled", key: "specialistScheduled" },
  { label: "Specialist Report", key: "specialistReport" },
  { label: "Re-Exam 2", key: "reExam2" },
  { label: "Re-Exam 3", key: "reExam3" },
  { label: "Discharge", key: "discharge" },
  { label: "R&B Sent", key: "rbSent" },
  { label: "Billed", key: "billed" },
  { label: "Initial To Discharge", key: "initialToDischarge" },
  { label: "Discharge To R&B", key: "dischargeToRb" },
  { label: "Paid Date", key: "paidDate" },
  { label: "R&B To Paid", key: "rbToPaid" },
  { label: "Paid Amount", key: "paidAmount" },
  { label: "Bill %", key: "billPercent" },
  { label: "Notes", key: "notes" },
  { label: "Review", key: "review" },
];

const dateMatrixFields = new Set<PatientMatrixField>([
  "initialExam",
  "xraySent",
  "xrayDone",
  "xrayReceived",
  "xrayReviewed",
  "reExam1",
  "mriSent",
  "mriScheduled",
  "mriDone",
  "mriReceived",
  "mriReviewed",
  "specialistSent",
  "specialistScheduled",
  "specialistReport",
  "reExam2",
  "reExam3",
  "discharge",
  "rbSent",
  "paidDate",
]);

function normalizeAttorneyKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanAttorneyLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function formatUsDateInput(rawValue: string) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (!digits) {
    return "";
  }
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function buildCaseNumberPreview(dateOfLoss: string, lastName: string, firstName: string) {
  const dateDigits = dateOfLoss.replace(/\D/g, "");
  if (dateDigits.length < 8) {
    return "";
  }

  const lastInitials = lastName.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2);
  const firstInitials = firstName.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 2);
  const mmddyy = `${dateDigits.slice(0, 2)}${dateDigits.slice(2, 4)}${dateDigits.slice(6, 8)}`;
  return `${mmddyy}${lastInitials}${firstInitials}`;
}

function composePatientAddress(street: string, unit: string, city: string, state: string, zip: string) {
  const cleanStreet = street.trim();
  const cleanUnit = unit.trim();
  const cleanCity = city.trim();
  const cleanState = state.trim().toUpperCase();
  const cleanZip = zip.trim();

  const cityStateZip = [cleanCity, [cleanState, cleanZip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [cleanStreet, cleanUnit, cityStateZip].filter(Boolean).join(", ");
}

function getFollowUpBadgeClass(category: FollowUpCategory) {
  if (category === "X-Ray") {
    return "bg-[rgba(13,121,191,0.14)] text-[#0d79bf]";
  }
  if (category === "MRI / CT") {
    return "bg-[rgba(97,73,179,0.14)] text-[#4d3d8f]";
  }
  if (category === "Lien / LOP") {
    return "bg-[rgba(90,119,168,0.16)] text-[#35537b]";
  }
  return "bg-[rgba(238,139,42,0.16)] text-[#9a5a00]";
}

function getAgePillClass(days: number | null, staleDaysThreshold: number) {
  const warningThreshold = Math.max(1, Math.floor(staleDaysThreshold / 2));
  if (days === null) {
    return "bg-[var(--bg-soft)] text-[var(--text-muted)]";
  }
  if (days >= staleDaysThreshold) {
    return "bg-[rgba(201,66,58,0.15)] text-[#b43b34]";
  }
  if (days >= warningThreshold) {
    return "bg-[rgba(238,139,42,0.16)] text-[#9a5a00]";
  }
  if (days >= 0) {
    return "bg-[rgba(25,109,58,0.12)] text-[#196d3a]";
  }
  return "bg-[rgba(13,121,191,0.14)] text-[#0d79bf]";
}

function getDetailValue(patient: PatientRecord, key: DetailRow["key"]) {
  if (key === "attorney") {
    return cleanAttorneyLabel(patient.attorney) || "-";
  }
  if (key === "dob") {
    return formatUsDateDisplay(patient.dob || "-");
  }
  if (key === "dateOfLoss") {
    return formatUsDateDisplay(patient.dateOfLoss || "-");
  }
  if (key === "contact") {
    return patient.matrix?.contact || patient.phone || "-";
  }
  const value = patient.matrix?.[key] || "-";
  if (dateMatrixFields.has(key)) {
    return formatLeadingDateDisplay(value);
  }
  return value;
}

export default function PatientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When a patient page navigates here via Save & Close, it appends
  // ?saved=<patient name>. Pull the value once and clear it from the
  // URL so a refresh doesn't replay the banner.
  const savedFromQuery = searchParams.get("saved");
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!savedFromQuery) return;
    setSavedBanner(savedFromQuery);
    // Strip the query param so a refresh / navigation doesn't re-show
    // the banner. window.history.replaceState avoids the re-render
    // that router.replace would trigger.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      window.history.replaceState({}, "", url.toString());
    }
    // Auto-fade after 5 seconds — the message did its job.
    const timeoutId = window.setTimeout(() => setSavedBanner(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [savedFromQuery]);

  const { caseStatuses, lienLabel, lienOptions } = useCaseStatuses();
  const { contacts, addContact } = useContactDirectory();
  const { dashboardWorkspaceSettings } = useDashboardWorkspaceSettings();
  const { recordsByPatientId: followUpOverridesByPatientId } = usePatientFollowUpOverrides();
  const { tasks, addTask, updateTask, toggleTaskDone, removeTask, clearCompleted } = useTasks();
  const defaultCaseStatus = (caseStatuses[0]?.name ?? "Active") as PatientRecord["caseStatus"];
  const defaultLienOption = lienOptions[0] ?? "Not Set";
  const [view, setView] = useState<PatientView>("list");

  // To Do state
  const [taskQuickTitle, setTaskQuickTitle] = useState("");
  const [taskQuickPriority, setTaskQuickPriority] = useState<TaskPriority>("Medium");
  const [taskQuickDueDate, setTaskQuickDueDate] = useState("");
  const [taskQuickPatientId, setTaskQuickPatientId] = useState("");
  const [taskQuickPatientQuery, setTaskQuickPatientQuery] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"All" | "Open" | "Done">(() =>
    loadDashboardWorkspaceSettings().myTasks.openOnly ? "Open" : "All",
  );
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<"All" | TaskPriority>("All");
  const [taskMessage, setTaskMessage] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState<TaskPriority>("Medium");
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [editTaskError, setEditTaskError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [yearDraft, setYearDraft] = useState("ALL");
  const [attorneyDraft, setAttorneyDraft] = useState("ALL");
  const [statusDraft, setStatusDraft] = useState("ALL");
  const [year, setYear] = useState("ALL");
  const [attorney, setAttorney] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  // Sort state (persisted)
  const [sortColumn, setSortColumn] = useState<ListColumnId>(() => {
    if (typeof window === "undefined") return "patient";
    const saved = window.localStorage.getItem(SORT_COLUMN_KEY);
    return saved && defaultColumnOrder.includes(saved as ListColumnId) ? (saved as ListColumnId) : "patient";
  });
  const [sortAsc, setSortAsc] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(SORT_ASC_KEY);
    return saved === null ? true : saved === "true";
  });

  // Case Flow sort: ordered list of {column, asc} levels (max 3). Each
  // level breaks ties from the level above. The legacy primary/secondary
  // keys still feed in via loadCfSortLevels' migration path.
  const [cfSortLevels, setCfSortLevels] = useState<CfSortLevel[]>(() => loadCfSortLevels());
  const persistCfSortLevels = (next: CfSortLevel[]) => {
    setCfSortLevels(next);
    saveCfSortLevels(next);
  };
  const [cfColumnOrder, setCfColumnOrder] = useState<CfColumnId[]>(() => loadCfColumnOrder());
  const [cfDragColumnId, setCfDragColumnId] = useState<CfColumnId | null>(null);

  // Column order (draggable)
  const [columnOrder, setColumnOrder] = useState<ListColumnId[]>(() => loadColumnOrder());
  const [dragColumnId, setDragColumnId] = useState<ListColumnId | null>(null);

  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [newPatientMessage, setNewPatientMessage] = useState("");
  const [newPatientDraft, setNewPatientDraft] = useState<NewPatientDraft>({
    lastName: "",
    firstName: "",
    sex: "",
    maritalStatus: "",
    attorney: "",
    attorneyPhone: "",
    dob: "",
    dateOfLoss: "",
    initialExam: "",
    phone: "",
    email: "",
    addressStreet: "",
    addressUnit: "",
    addressCity: "",
    addressState: "",
    addressZip: "",
    lienStatus: defaultLienOption,
    priorCare: "",
    caseStatus: defaultCaseStatus,
    notes: "",
    isCashPatient: false,
  });

  const resetNewPatientDraft = () => {
    setNewPatientDraft({
      lastName: "",
      firstName: "",
      sex: "",
      maritalStatus: "",
      attorney: "",
      attorneyPhone: "",
      dob: "",
      dateOfLoss: "",
      initialExam: "",
      phone: "",
      email: "",
      addressStreet: "",
      addressUnit: "",
      addressCity: "",
      addressState: "",
      addressZip: "",
      lienStatus: defaultLienOption,
      priorCare: "",
      caseStatus: defaultCaseStatus,
      notes: "",
      isCashPatient: false,
    });
  };

  const openNewPatientModal = () => {
    setNewPatientMessage("");
    resetNewPatientDraft();
    setShowNewPatientModal(true);
  };

  const closeNewPatientModal = () => {
    setShowNewPatientModal(false);
    setNewPatientMessage("");
  };

  const attorneyContacts = useMemo(() => {
    const deduped = new Map<string, (typeof contacts)[number]>();
    contacts.forEach((contact) => {
      if (normalizeAttorneyKey(contact.category) !== "attorney") {
        return;
      }
      const key = normalizeAttorneyKey(contact.name);
      if (!key || deduped.has(key)) {
        return;
      }
      deduped.set(key, contact);
    });
    return Array.from(deduped.values());
  }, [contacts]);

  const createNewPatient = () => {
    const firstName = newPatientDraft.firstName.trim();
    const lastName = newPatientDraft.lastName.trim();
    if (!firstName || !lastName) {
      setNewPatientMessage("Patient first and last name are required.");
      return;
    }
    // Cash patients don't track a date-of-injury — they walk in and pay
    // at the desk. Skip the DOI requirement entirely in cash mode.
    if (!newPatientDraft.isCashPatient && !newPatientDraft.dateOfLoss.trim()) {
      setNewPatientMessage("Date Of Injury is required.");
      return;
    }

    const attorneyName = newPatientDraft.isCashPatient
      ? "Self"
      : cleanAttorneyLabel(newPatientDraft.attorney || "Self");
    const attorneyPhone = newPatientDraft.isCashPatient
      ? ""
      : formatUsPhoneInput(newPatientDraft.attorneyPhone);
    if (!newPatientDraft.isCashPatient && normalizeAttorneyKey(attorneyName) !== "self" && attorneyPhone) {
      const attorneyExists = contacts.some(
        (contact) =>
          normalizeAttorneyKey(contact.category) === "attorney" &&
          normalizeAttorneyKey(contact.name) === normalizeAttorneyKey(attorneyName),
      );
      if (!attorneyExists) {
        const contactResult = addContact({
          name: attorneyName,
          category: "Attorney",
          phone: attorneyPhone,
          email: "",
          fax: "",
          address: "",
        });
        if (!contactResult.added && !contactResult.contact) {
          setNewPatientMessage(contactResult.reason);
          return;
        }
      }
    }

    const createdPatient = createPatientRecord({
      firstName,
      lastName,
      sex: newPatientDraft.sex || undefined,
      maritalStatus: newPatientDraft.maritalStatus || undefined,
      attorney: attorneyName,
      dob: newPatientDraft.dob,
      dateOfLoss: newPatientDraft.isCashPatient ? "" : newPatientDraft.dateOfLoss,
      initialExam: newPatientDraft.isCashPatient ? "" : newPatientDraft.initialExam,
      phone: formatUsPhoneInput(newPatientDraft.phone),
      email: newPatientDraft.email.trim(),
      address: composePatientAddress(
        newPatientDraft.addressStreet,
        newPatientDraft.addressUnit,
        newPatientDraft.addressCity,
        newPatientDraft.addressState,
        newPatientDraft.addressZip,
      ),
      caseStatus: newPatientDraft.caseStatus,
      lienStatus: newPatientDraft.isCashPatient ? "" : newPatientDraft.lienStatus.trim(),
      priorCare: newPatientDraft.priorCare.trim(),
      notes: newPatientDraft.notes.trim(),
      isCashPatient: newPatientDraft.isCashPatient,
    });

    if (!createdPatient) {
      setNewPatientMessage("Could not create patient. Check required fields and try again.");
      return;
    }

    setShowNewPatientModal(false);
    setNewPatientMessage("");
    router.push(`/patients/${createdPatient.id}`);
  };

  const newPatientCaseNumberPreview = useMemo(
    () =>
      buildCaseNumberPreview(
        newPatientDraft.dateOfLoss,
        newPatientDraft.lastName,
        newPatientDraft.firstName,
      ),
    [newPatientDraft.dateOfLoss, newPatientDraft.firstName, newPatientDraft.lastName],
  );

  const detailRows = useMemo(
    () =>
      detailRowsTemplate.map((row) =>
        row.key === "lien"
          ? {
              ...row,
              label: lienLabel,
            }
          : row,
      ),
    [lienLabel],
  );

  const years = useMemo(
    () => {
      const collected = new Set<string>();
      for (const patient of patients) {
        const y = extractYearFromDateString(patient.dateOfLoss);
        if (y) collected.add(y);
      }
      // Newest year first so the dropdown opens to recent years
      const sorted = Array.from(collected).sort((a, b) => Number(b) - Number(a));
      return ["ALL", ...sorted];
    },
    [],
  );

  const attorneyOptions = useMemo(() => {
    const deduped = new Map<string, string>();
    patients.forEach((patient) => {
      const cleanName = cleanAttorneyLabel(patient.attorney);
      const key = normalizeAttorneyKey(cleanName);
      if (key && !deduped.has(key)) {
        deduped.set(key, cleanName);
      }
    });
    return ["ALL", ...Array.from(deduped.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))];
  }, []);

  const statusFilterOptions = useMemo(
    () => caseStatuses.map((statusConfig) => statusConfig.name),
    [caseStatuses],
  );

  const statusConfigByName = useMemo(
    () => new Map(caseStatuses.map((statusConfig) => [statusConfig.name.toLowerCase(), statusConfig] as const)),
    [caseStatuses],
  );
  const closedCaseStatuses = useMemo(
    () => caseStatuses.filter((statusConfig) => statusConfig.isCaseClosed).map((statusConfig) => statusConfig.name),
    [caseStatuses],
  );
  const followUpSettings = dashboardWorkspaceSettings.patientFollowUp;
  const enabledFollowUpCategories = useMemo(() => {
    const labels: string[] = [];
    if (followUpSettings.includeXray) {
      labels.push("X-Ray");
    }
    if (followUpSettings.includeMriCt) {
      labels.push("MRI / CT");
    }
    if (followUpSettings.includeSpecialist) {
      labels.push("Specialist");
    }
    if (followUpSettings.includeLienLop) {
      labels.push(lienLabel);
    }
    return labels;
  }, [
    followUpSettings.includeLienLop,
    followUpSettings.includeMriCt,
    followUpSettings.includeSpecialist,
    followUpSettings.includeXray,
    lienLabel,
  ]);

  const applyFilters = () => {
    setYear(yearDraft);
    setAttorney(attorneyDraft);
    setStatus(statusDraft);
  };

  const filteredPatients = useMemo(() => {
    const q = searchDraft.trim().toLowerCase();
    // Split query into individual words so "john doe" matches "Doe, John"
    const qWords = q.replace(/[,.:;]/g, " ").split(/\s+/).filter(Boolean);
    const filtered = patients.filter((patient) => {
      // Skip soft-deleted patients
      if (patient.deleted) return false;

      const nameNorm = patient.fullName.toLowerCase().replace(/[,.:;]/g, " ");
      const attNorm = patient.attorney.toLowerCase().replace(/[,.:;]/g, " ");
      const haystack = `${nameNorm} ${attNorm}`;
      const matchesSearch =
        !q || qWords.every((word) => haystack.includes(word));

      const matchesYear =
        year === "ALL" ||
        extractYearFromDateString(patient.dateOfLoss) === year;

      const matchesAttorney =
        attorney === "ALL" ||
        normalizeAttorneyKey(patient.attorney) === normalizeAttorneyKey(attorney);

      const matchesStatus = status === "ALL" || patient.caseStatus === status;

      return matchesSearch && matchesYear && matchesAttorney && matchesStatus;
    });

    // Sort
    // Dates are stored as strings in several historical shapes — `MM/DD/YYYY`,
    // `M/D/YY`, ISO `YYYY-MM-DD`, and any of those with trailing notes appended
    // (e.g. "04/02/2026 (rescheduled)"). We must accept ALL of them or rows
    // silently sort to "missing" (-1) and end up out of order. This previously
    // caused initial-exam sort to drop ISO-stored or note-suffixed rows into
    // the wrong position. We mirror the same leading-date detection that
    // `formatLeadingDateDisplay` already uses for rendering.
    const usDateToSortKey = (raw: string | undefined): number => {
      if (!raw) return -1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed === "-") return -1;
      // ISO leading: YYYY-MM-DD optionally followed by anything
      const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
          return year * 10000 + month * 100 + day;
        }
        return -1;
      }
      // US leading: M/D/YY or M/D/YYYY optionally followed by anything
      const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!usMatch) return -1;
      const month = Number(usMatch[1]);
      const day = Number(usMatch[2]);
      let year = Number(usMatch[3]);
      if (year < 100) year += 2000;
      if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return -1;
      return year * 10000 + month * 100 + day;
    };
    // Empty dates always sort to the BOTTOM regardless of asc/desc, so a
    // brand-new patient with no Initial Exam date doesn't fall to the top
    // when sorting newest-first.
    const compareUsDates = (aRaw: string | undefined, bRaw: string | undefined) => {
      const aKey = usDateToSortKey(aRaw);
      const bKey = usDateToSortKey(bRaw);
      const aMissing = aKey < 0;
      const bMissing = bKey < 0;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;  // a goes after b
      if (bMissing) return -1; // b goes after a
      return aKey - bKey;
    };

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      let datesNeutral = false; // when true, don't flip cmp for desc order
      if (sortColumn === "patient") {
        cmp = a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
      } else if (sortColumn === "attorney") {
        cmp = cleanAttorneyLabel(a.attorney).localeCompare(cleanAttorneyLabel(b.attorney), undefined, { sensitivity: "base" });
      } else if (sortColumn === "dateOfLoss") {
        cmp = compareUsDates(a.dateOfLoss, b.dateOfLoss);
        datesNeutral = true;
      } else if (sortColumn === "initialExam") {
        cmp = compareUsDates(a.matrix?.initialExam, b.matrix?.initialExam);
        datesNeutral = true;
      } else if (sortColumn === "status") {
        cmp = a.caseStatus.localeCompare(b.caseStatus);
      }
      if (datesNeutral) {
        // Anchor missing dates to the bottom: if exactly one is missing the
        // comparator already returned ±1; preserve that orientation regardless
        // of asc/desc so empty rows never bubble to the top.
        const aMissing =
          sortColumn === "initialExam"
            ? usDateToSortKey(a.matrix?.initialExam) < 0
            : usDateToSortKey(a.dateOfLoss) < 0;
        const bMissing =
          sortColumn === "initialExam"
            ? usDateToSortKey(b.matrix?.initialExam) < 0
            : usDateToSortKey(b.dateOfLoss) < 0;
        if (aMissing !== bMissing) {
          return aMissing ? 1 : -1;
        }
      }
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [attorney, searchDraft, status, year, sortColumn, sortAsc]);

  const toggleSort = (col: ListColumnId) => {
    if (sortColumn === col) {
      setSortAsc((prev) => {
        const next = !prev;
        window.localStorage.setItem(SORT_ASC_KEY, String(next));
        return next;
      });
    } else {
      setSortColumn(col);
      setSortAsc(true);
      window.localStorage.setItem(SORT_COLUMN_KEY, col);
      window.localStorage.setItem(SORT_ASC_KEY, "true");
    }
  };

  const handleColumnDragStart = (col: ListColumnId) => {
    setDragColumnId(col);
  };
  const handleColumnDragOver = (e: React.DragEvent, col: ListColumnId) => {
    e.preventDefault();
    if (!dragColumnId || dragColumnId === col) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(dragColumnId);
      const toIndex = next.indexOf(col);
      if (fromIndex === -1 || toIndex === -1) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, dragColumnId);
      saveColumnOrder(next);
      return next;
    });
  };
  const handleColumnDragEnd = () => {
    setDragColumnId(null);
  };

  const updateCfSortLevel = (index: number, patch: Partial<CfSortLevel>) => {
    const next = cfSortLevels.map((level, i) => (i === index ? { ...level, ...patch } : level));
    persistCfSortLevels(next);
  };
  const removeCfSortLevel = (index: number) => {
    if (cfSortLevels.length <= 1) return;
    persistCfSortLevels(cfSortLevels.filter((_, i) => i !== index));
  };
  const addCfSortLevel = () => {
    if (cfSortLevels.length >= CF_MAX_SORT_LEVELS) return;
    const used = new Set(cfSortLevels.map((l) => l.column));
    const nextCol = defaultCfColumnOrder.find((c) => !used.has(c)) ?? defaultCfColumnOrder[0];
    persistCfSortLevels([...cfSortLevels, { column: nextCol, asc: true }]);
  };

  // Case Flow column drag handlers
  const handleCfDragStart = (col: CfColumnId) => setCfDragColumnId(col);
  const handleCfDragOver = (e: React.DragEvent, col: CfColumnId) => {
    e.preventDefault();
    if (!cfDragColumnId || cfDragColumnId === col) return;
    setCfColumnOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(cfDragColumnId);
      const toIndex = next.indexOf(col);
      if (fromIndex === -1 || toIndex === -1) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, cfDragColumnId);
      saveCfColumnOrder(next);
      return next;
    });
  };
  const handleCfDragEnd = () => setCfDragColumnId(null);

  const followUpItems = useMemo(() => {
    return buildFollowUpItems(filteredPatients, {
      includeXray: followUpSettings.includeXray,
      includeMriCt: followUpSettings.includeMriCt,
      includeSpecialist: followUpSettings.includeSpecialist,
      includeLienLop: followUpSettings.includeLienLop,
      xrayAppearAuto: followUpSettings.xrayAppearAuto,
      mriAppearMode: followUpSettings.mriAppearMode,
      mriAppearDays: followUpSettings.mriAppearDays,
      specialistAppearWhen: followUpSettings.specialistAppearWhen,
      xrayClearedBy: followUpSettings.xrayClearedBy,
      mriCtClearedBy: followUpSettings.mriCtClearedBy,
      specialistClearedBy: followUpSettings.specialistClearedBy,
      lienLopClearStatuses: followUpSettings.lienLopClearStatuses,
      xrayClearStatuses: followUpSettings.xrayClearStatuses,
      mriCtClearStatuses: followUpSettings.mriCtClearStatuses,
      specialistClearStatuses: followUpSettings.specialistClearStatuses,
      xrayNoReportWarningDays: followUpSettings.xrayNoReportWarningDays,
      mriNoReportWarningDays: followUpSettings.mriNoReportWarningDays,
      mriNoScheduleWarningDays: followUpSettings.mriNoScheduleWarningDays,
      specialistNoReportWarningDays: followUpSettings.specialistNoReportWarningDays,
      specialistNoScheduleWarningDays: followUpSettings.specialistNoScheduleWarningDays,
      followUpOverrides: followUpOverridesByPatientId,
      closedCaseStatuses,
    });
  }, [
    closedCaseStatuses,
    filteredPatients,
    followUpSettings.includeLienLop,
    followUpSettings.includeMriCt,
    followUpSettings.includeSpecialist,
    followUpSettings.includeXray,
    followUpSettings.lienLopClearStatuses,
    followUpSettings.xrayClearStatuses,
    followUpSettings.mriCtClearStatuses,
    followUpSettings.specialistClearStatuses,
    followUpSettings.mriAppearMode,
    followUpSettings.mriAppearDays,
    followUpSettings.mriCtClearedBy,
    followUpSettings.specialistAppearWhen,
    followUpSettings.specialistClearedBy,
    followUpSettings.xrayAppearAuto,
    followUpSettings.xrayClearedBy,
    followUpOverridesByPatientId,
  ]);

  const followUpCounts = useMemo(
    () => ({
      total: followUpItems.length,
      xray: followUpItems.filter((entry) => entry.category === "X-Ray").length,
      mri: followUpItems.filter((entry) => entry.category === "MRI / CT").length,
      specialist: followUpItems.filter((entry) => entry.category === "Specialist").length,
      lienLop: followUpItems.filter((entry) => entry.category === "Lien / LOP").length,
    }),
    [followUpItems],
  );

  const sortedFollowUpItems = useMemo(() => {
    const compareBy = (
      a: (typeof followUpItems)[number],
      b: (typeof followUpItems)[number],
      column: CfColumnId,
    ) => {
      if (column === "patient") return a.patientName.localeCompare(b.patientName);
      if (column === "caseNumber") return (a.caseNumber || "").localeCompare(b.caseNumber || "");
      if (column === "attorney") return (a.attorney || "").localeCompare(b.attorney || "");
      if (column === "category") return a.category.localeCompare(b.category);
      if (column === "followUp") return a.stage.localeCompare(b.stage);
      if (column === "anchorDate") return (a.anchorDate || "").localeCompare(b.anchorDate || "");
      if (column === "age") return (a.daysFromAnchor ?? -99999) - (b.daysFromAnchor ?? -99999);
      if (column === "caseStatus") return a.caseStatus.localeCompare(b.caseStatus);
      return 0;
    };
    const items = [...followUpItems];
    items.sort((a, b) => {
      for (const level of cfSortLevels) {
        const cmp = compareBy(a, b, level.column);
        const directed = level.asc ? cmp : -cmp;
        if (directed !== 0) return directed;
      }
      return 0;
    });
    return items;
  }, [followUpItems, cfSortLevels]);

  // --- To Do helpers ---
  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    return tasks.filter((task) => {
      if (taskStatusFilter === "Done" && !task.done) return false;
      if (taskStatusFilter === "Open" && task.done) return false;
      if (taskPriorityFilter !== "All" && task.priority !== taskPriorityFilter) return false;
      if (!query) return true;
      const dueDateUs = formatUsDateFromIso(task.dueDate).toLowerCase();
      return task.title.toLowerCase().includes(query) || dueDateUs.includes(query);
    });
  }, [tasks, taskSearch, taskStatusFilter, taskPriorityFilter]);

  const taskOpenCount = tasks.filter((t) => !t.done).length;
  const taskDoneCount = tasks.length - taskOpenCount;

  // formatTaskDateInput removed — <UsDateInput> does its own formatting.

  function toIsoFromUsDate(value: string) {
    const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return "";
    const month = Number(match[1]);
    const day = Number(match[2]);
    const yr = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const d = new Date(Date.UTC(yr, month - 1, day));
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== yr || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return "";
    return `${yr}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
  }

  function priorityBadgeClass(priority: TaskPriority) {
    if (priority === "Urgent") return "bg-[rgba(201,66,58,0.14)] text-[#b43b34]";
    if (priority === "High") return "bg-[rgba(238,139,42,0.18)] text-[#9a5a00]";
    if (priority === "Medium") return "bg-[rgba(21,123,191,0.14)] text-[#0b5c93]";
    return "bg-[rgba(25,109,58,0.12)] text-[#196d3a]";
  }

  const handleAddTask = () => {
    const dueDateIso = taskQuickDueDate.trim() ? toIsoFromUsDate(taskQuickDueDate) : "";
    if (taskQuickDueDate.trim() && !dueDateIso) { setTaskMessage("Enter due date as MM/DD/YYYY."); return; }
    const linkedPatient = taskQuickPatientId ? patients.find((p) => p.id === taskQuickPatientId) : undefined;
    const result = addTask({
      title: taskQuickTitle,
      priority: taskQuickPriority,
      dueDate: dueDateIso,
      patientId: linkedPatient?.id,
      patientName: linkedPatient?.fullName,
    });
    if (!result.added) { setTaskMessage(result.reason); return; }
    setTaskQuickTitle(""); setTaskQuickPriority("Medium"); setTaskQuickDueDate("");
    setTaskQuickPatientId(""); setTaskQuickPatientQuery("");
    setTaskMessage("Task added.");
  };

  const taskPatientCaseEntries = useMemo(
    () => patients.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      caseNumber: buildCaseNumber(p.dateOfLoss, p.fullName),
    })),
    [],
  );

  const taskPatientMatches = useMemo(() => {
    const q = taskQuickPatientQuery.trim().toLowerCase();
    if (!q || taskQuickPatientId) return [];
    return taskPatientCaseEntries
      .filter((e) => e.fullName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [taskPatientCaseEntries, taskQuickPatientQuery, taskQuickPatientId]);

  const selectTaskPatient = (entry: { id: string; fullName: string; caseNumber: string }) => {
    setTaskQuickPatientId(entry.id);
    setTaskQuickPatientQuery(entry.fullName);
  };

  const clearTaskPatient = () => {
    setTaskQuickPatientId("");
    setTaskQuickPatientQuery("");
  };

  const startEditingTask = (task: TaskRecord) => {
    setEditingTaskId(task.id); setEditTaskTitle(task.title); setEditTaskPriority(task.priority);
    setEditTaskDueDate(formatUsDateFromIso(task.dueDate)); setEditTaskError("");
  };
  const cancelEditingTask = () => {
    setEditingTaskId(null); setEditTaskTitle(""); setEditTaskPriority("Medium"); setEditTaskDueDate(""); setEditTaskError("");
  };
  const saveEditingTask = (taskId: string) => {
    const title = editTaskTitle.trim();
    if (!title) { setEditTaskError("Task name is required."); return; }
    const dueDateIso = editTaskDueDate.trim() ? toIsoFromUsDate(editTaskDueDate) : "";
    if (editTaskDueDate.trim() && !dueDateIso) { setEditTaskError("Enter due date as MM/DD/YYYY."); return; }
    updateTask(taskId, { title, priority: editTaskPriority, dueDate: dueDateIso });
    setTaskMessage("Task updated."); cancelEditingTask();
  };

  // ── Birthday helpers ──
  const birthdayEntries = useMemo(() => {
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    const todayDay = today.getDay(); // 0=Sun

    // Compute start of the week (Sunday) and end (Saturday)
    const weekStart = new Date(today);
    weekStart.setDate(todayDate - todayDay);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const wsMonth = weekStart.getMonth();
    const wsDate = weekStart.getDate();
    const weMonth = weekEnd.getMonth();
    const weDate = weekEnd.getDate();

    type BirthdayEntry = {
      id: string;
      fullName: string;
      phone: string;
      dob: string;
      birthdayMonth: number;
      birthdayDay: number;
      isToday: boolean;
    };

    const entries: BirthdayEntry[] = [];
    for (const p of patients) {
      if (!p.dob) continue;
      const match = p.dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) continue;
      const bMonth = Number(match[2]) - 1;
      const bDay = Number(match[3]);

      let inWeek = false;
      if (wsMonth === weMonth) {
        inWeek = bMonth === wsMonth && bDay >= wsDate && bDay <= weDate;
      } else {
        inWeek =
          (bMonth === wsMonth && bDay >= wsDate) ||
          (bMonth === weMonth && bDay <= weDate);
      }

      if (inWeek) {
        entries.push({
          id: p.id,
          fullName: p.fullName,
          phone: p.phone || "",
          dob: p.dob,
          birthdayMonth: bMonth,
          birthdayDay: bDay,
          isToday: bMonth === todayMonth && bDay === todayDate,
        });
      }
    }

    // Sort: today first, then by day of week
    entries.sort((a, b) => {
      if (a.isToday && !b.isToday) return -1;
      if (!a.isToday && b.isToday) return 1;
      // Sort by month then day
      if (a.birthdayMonth !== b.birthdayMonth) return a.birthdayMonth - b.birthdayMonth;
      return a.birthdayDay - b.birthdayDay;
    });

    return entries;
  }, []);

  const birthdayWeekLabel = useMemo(() => {
    const today = new Date();
    const todayDay = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - todayDay);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(weekStart)} - ${fmt(weekEnd)}, ${weekEnd.getFullYear()}`;
  }, []);

  return (
    <div className="space-y-5">
      {savedBanner && (
        <div
          className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
          role="status"
        >
          <span className="text-lg">✓</span>
          <span>
            Saved &amp; synced to cloud:{" "}
            <span className="font-bold">{savedBanner}</span>
          </span>
        </div>
      )}
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">All Patients Workspace</h3>
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
            onClick={openNewPatientModal}
            type="button"
          >
            New Patient
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              view === "list" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setView("list")}
            type="button"
          >
            List
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              view === "detail" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setView("detail")}
            type="button"
          >
            Detail
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              view === "caseFlow" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setView("caseFlow")}
            type="button"
          >
            Case Flow
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              view === "toDo" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setView("toDo")}
            type="button"
          >
            To Do
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold ${
              view === "birthdays" ? "bg-[var(--brand-primary)] text-white" : "bg-[var(--bg-soft)]"
            }`}
            onClick={() => setView("birthdays")}
            type="button"
          >
            <span className="text-base leading-none">&#127874;</span>
            Birthdays
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Search</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search patient or attorney..."
              value={searchDraft}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_96px]">
            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Year
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => { setYearDraft(event.target.value); setYear(event.target.value); }}
                value={yearDraft}
              >
                {years.map((yearOption) => (
                  <option key={yearOption} value={yearOption}>
                    {yearOption}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Attorney
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => { setAttorneyDraft(event.target.value); setAttorney(event.target.value); }}
                value={attorneyDraft}
              >
                {attorneyOptions.map((attorneyOption) => (
                  <option key={attorneyOption} value={attorneyOption}>
                    {attorneyOption}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[var(--text-muted)]">
              Status
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-normal text-[var(--text-primary)]"
                onChange={(event) => { setStatusDraft(event.target.value); setStatus(event.target.value); }}
                value={statusDraft}
              >
                <option value="ALL">ALL</option>
                {statusFilterOptions.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {view === "list" && (
        <section className="panel-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  {columnOrder.map((colId) => (
                    <th
                      key={colId}
                      className={`cursor-pointer select-none px-4 py-3 transition-colors hover:bg-[rgba(13,121,191,0.06)] ${dragColumnId === colId ? "opacity-50" : ""}`}
                      draggable
                      onClick={() => toggleSort(colId)}
                      onDragEnd={handleColumnDragEnd}
                      onDragOver={(e) => handleColumnDragOver(e, colId)}
                      onDragStart={() => handleColumnDragStart(colId)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {columnLabels[colId]}
                        {sortColumn === colId && (
                          <span className="text-[10px]">{sortAsc ? "▲" : "▼"}</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((patient) => (
                  <tr key={patient.id} className="border-t border-[var(--line-soft)]">
                    {columnOrder.map((colId) => {
                      if (colId === "patient") {
                        return (
                          <td key={colId} className="px-4 py-3">
                            <Link
                              href={`/patients/${patient.id}`}
                              className="font-semibold text-[var(--brand-primary)] underline"
                            >
                              {patient.fullName}
                            </Link>
                            {patient.phone && (
                              <p className="text-sm text-[var(--text-muted)]">
                                <SmsSendMenu
                                  context={{
                                    patient: {
                                      ...splitFullName(patient.fullName),
                                      fullName: patient.fullName,
                                    },
                                  }}
                                  phone={patient.phone}
                                />
                              </p>
                            )}
                          </td>
                        );
                      }
                      if (colId === "initialExam") {
                        return <td key={colId} className="px-4 py-3">{formatLeadingDateDisplay(patient.matrix?.initialExam || "-")}</td>;
                      }
                      if (colId === "dateOfLoss") {
                        return <td key={colId} className="px-4 py-3">{formatUsDateDisplay(patient.dateOfLoss)}</td>;
                      }
                      if (colId === "attorney") {
                        return <td key={colId} className="px-4 py-3">{cleanAttorneyLabel(patient.attorney)}</td>;
                      }
                      if (colId === "status") {
                        return (
                          <td key={colId} className="px-4 py-3">
                            <span
                              className="status-pill"
                              style={{
                                backgroundColor: withAlpha(
                                  statusConfigByName.get(patient.caseStatus.toLowerCase())?.color ?? "#0d79bf",
                                  0.2,
                                ),
                                color: getContrastTextColor(
                                  statusConfigByName.get(patient.caseStatus.toLowerCase())?.color ?? "#0d79bf",
                                ),
                              }}
                            >
                              {patient.caseStatus}
                            </span>
                          </td>
                        );
                      }
                      return null;
                    })}
                  </tr>
                ))}
                {filteredPatients.length === 0 && (
                  <tr className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={columnOrder.length}>
                      No patients match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "detail" && (
        <section className="panel-card overflow-hidden">
          <div className="border-b border-[var(--line-soft)] p-4">
            <h4 className="text-lg font-semibold">Detail Matrix</h4>
            <p className="text-sm text-[var(--text-muted)]">
              All filtered patients shown in one side-by-side case matrix.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1800px] border-collapse">
              <tbody>
                <tr className="bg-[var(--bg-soft)]">
                  <th className="w-[220px] border-r border-[var(--line-soft)] px-4 py-3 text-left">
                    Patient
                  </th>
                  {filteredPatients.map((patient) => (
                    <th key={`name-${patient.id}`} className="border-r border-[var(--line-soft)] px-4 py-3 text-left">
                      {patient.fullName}
                    </th>
                  ))}
                </tr>
                {detailRows.map((row) => (
                  <tr key={row.label} className="border-t border-[var(--line-soft)]">
                    <td className="border-r border-[var(--line-soft)] bg-[var(--bg-soft)] px-4 py-3 font-semibold">
                      {row.label}
                    </td>
                    {filteredPatients.map((patient) => (
                      <td key={`${row.label}-${patient.id}`} className="border-r border-[var(--line-soft)] px-4 py-3">
                        {getDetailValue(patient, row.key)}
                      </td>
                    ))}
                  </tr>
                ))}
                {filteredPatients.length === 0 && (
                  <tr className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={2}>
                      No patients match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "caseFlow" && (
        <section className="panel-card overflow-hidden">
          <div className="border-b border-[var(--line-soft)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold">Case Flow</h4>
                <p className="text-sm text-[var(--text-muted)]">
                  All filtered patients with pending follow-up steps. Categories shown:{" "}
                  {enabledFollowUpCategories.length ? enabledFollowUpCategories.join(", ") : "None selected"}.
                </p>
              </div>
              <div className="grid gap-1 text-right text-sm">
                <p>
                  <span className="font-semibold text-[var(--text-main)]">{followUpCounts.total}</span> Total
                </p>
                <p>
                  X-Ray <span className="font-semibold">{followUpCounts.xray}</span> • MRI/CT{" "}
                  <span className="font-semibold">{followUpCounts.mri}</span> • Specialist{" "}
                  <span className="font-semibold">{followUpCounts.specialist}</span> • {lienLabel}{" "}
                  <span className="font-semibold">{followUpCounts.lienLop}</span>
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1.5 text-xs">
              {cfSortLevels.map((level, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 font-semibold text-[var(--text-muted)]">
                    {index === 0 ? "Sort by:" : "+ Then by:"}
                  </span>
                  <select
                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    value={level.column}
                    onChange={(e) => updateCfSortLevel(index, { column: e.target.value as CfColumnId })}
                  >
                    {defaultCfColumnOrder.map((colId) => (
                      <option key={colId} value={colId}>
                        {cfColumnLabels[colId]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm hover:bg-[rgba(13,121,191,0.06)]"
                    onClick={() => updateCfSortLevel(index, { asc: !level.asc })}
                    title="Toggle direction"
                  >
                    {level.asc ? "▲ Asc" : "▼ Desc"}
                  </button>
                  {cfSortLevels.length > 1 && (
                    <button
                      type="button"
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[rgba(180,59,52,0.08)] hover:text-[#b43b34]"
                      onClick={() => removeCfSortLevel(index)}
                      title="Remove this sort level"
                      aria-label="Remove sort level"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {cfSortLevels.length < CF_MAX_SORT_LEVELS && (
                <div className="ml-24">
                  <button
                    type="button"
                    className="rounded-md border border-dashed border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold text-[var(--brand-primary)] hover:bg-[rgba(13,121,191,0.06)]"
                    onClick={addCfSortLevel}
                  >
                    + Add sort level
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full border-collapse">
              <thead>
                <tr className="bg-[var(--bg-soft)] text-left text-sm">
                  {cfColumnOrder.map((colId) => {
                    const sortIndex = cfSortLevels.findIndex((l) => l.column === colId);
                    const sortLevel = sortIndex >= 0 ? cfSortLevels[sortIndex] : null;
                    return (
                      <th
                        key={colId}
                        className={`cursor-grab select-none px-4 py-3 transition-colors ${cfDragColumnId === colId ? "opacity-50" : ""}`}
                        draggable
                        onDragEnd={handleCfDragEnd}
                        onDragOver={(e) => handleCfDragOver(e, colId)}
                        onDragStart={() => handleCfDragStart(colId)}
                        title="Drag to reorder columns"
                      >
                        <span className="inline-flex items-center gap-1">
                          {cfColumnLabels[colId]}
                          {sortLevel && (
                            <span className={`text-[10px] ${sortIndex === 0 ? "" : "text-[var(--text-muted)]"}`}>
                              {sortIndex === 0 ? "" : `${sortIndex + 1}°`}
                              {sortLevel.asc ? "▲" : "▼"}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedFollowUpItems.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--line-soft)]">
                    {cfColumnOrder.map((colId) => {
                      if (colId === "patient") {
                        return (
                          <td key={colId} className="px-4 py-3">
                            <Link href={`/patients/${item.patientId}`} className="font-semibold text-[var(--brand-primary)] underline">
                              {item.patientName}
                            </Link>
                            {item.note && <p className="text-xs text-[var(--text-muted)]">{item.note}</p>}
                          </td>
                        );
                      }
                      if (colId === "caseNumber") {
                        return <td key={colId} className="px-4 py-3 font-semibold">{item.caseNumber || "-"}</td>;
                      }
                      if (colId === "attorney") {
                        return <td key={colId} className="px-4 py-3">{item.attorney || "-"}</td>;
                      }
                      if (colId === "category") {
                        return (
                          <td key={colId} className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getFollowUpBadgeClass(item.category)}`}>
                              {item.category === "Lien / LOP" ? lienLabel : item.category}
                            </span>
                          </td>
                        );
                      }
                      if (colId === "followUp") {
                        return <td key={colId} className="px-4 py-3">{item.stage}</td>;
                      }
                      if (colId === "anchorDate") {
                        return <td key={colId} className="px-4 py-3">{item.anchorDate ? formatUsDateDisplay(item.anchorDate) : "-"}</td>;
                      }
                      if (colId === "age") {
                        return (
                          <td key={colId} className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${getAgePillClass(
                                item.daysFromAnchor,
                                followUpSettings.staleDaysThreshold,
                              )}`}
                            >
                              {item.daysFromAnchor === null
                                ? "No date"
                                : item.daysFromAnchor < 0
                                  ? `In ${Math.abs(item.daysFromAnchor)}d`
                                  : item.daysFromAnchor >= followUpSettings.staleDaysThreshold
                                    ? `Stale ${item.daysFromAnchor}d`
                                    : `${item.daysFromAnchor}d`}
                            </span>
                          </td>
                        );
                      }
                      // caseStatus
                      return (
                        <td key={colId} className="px-4 py-3">
                          <span
                            className="status-pill"
                            style={{
                              backgroundColor: withAlpha(
                                statusConfigByName.get(item.caseStatus.toLowerCase())?.color ?? "#0d79bf",
                                0.2,
                              ),
                              color: getContrastTextColor(
                                statusConfigByName.get(item.caseStatus.toLowerCase())?.color ?? "#0d79bf",
                              ),
                            }}
                          >
                            {item.caseStatus}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {sortedFollowUpItems.length === 0 && (
                  <tr className="border-t border-[var(--line-soft)]">
                    <td className="px-4 py-5 text-sm text-[var(--text-muted)]" colSpan={8}>
                      No follow-up items in the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "toDo" && (
        <div className="space-y-4">
          <section className="panel-card p-4">
            <h4 className="text-lg font-semibold">Quick Add</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-12">
              <label className="grid gap-1 md:col-span-12">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Task *</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setTaskQuickTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTask(); } }}
                  placeholder="Call attorney re: lien update"
                  value={taskQuickTitle}
                />
              </label>
              <label className="relative grid gap-1 md:col-span-5">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Patient</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => {
                    const v = e.target.value;
                    setTaskQuickPatientQuery(v);
                    if (taskQuickPatientId) {
                      setTaskQuickPatientId("");
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && taskPatientMatches.length === 0) { e.preventDefault(); handleAddTask(); } }}
                  placeholder="Search patient..."
                  value={taskQuickPatientQuery}
                />
                {taskQuickPatientId && (
                  <button
                    className="absolute right-2 top-[30px] rounded-md px-2 text-xs text-[var(--text-muted)]"
                    onClick={clearTaskPatient}
                    type="button"
                  >
                    Clear
                  </button>
                )}
                {taskPatientMatches.length > 0 && (
                  <ul className="absolute left-0 right-0 top-[60px] z-10 max-h-56 overflow-auto rounded-xl border border-[var(--line-soft)] bg-white shadow-lg">
                    {taskPatientMatches.map((entry) => (
                      <li key={entry.id}>
                        <button
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
                          onClick={() => selectTaskPatient(entry)}
                          type="button"
                        >
                          <span>{entry.fullName}</span>
                          <span className="text-xs text-[var(--text-muted)]">{entry.caseNumber}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Priority</span>
                <select className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" onChange={(e) => setTaskQuickPriority(e.target.value as TaskPriority)} value={taskQuickPriority}>
                  <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Urgent">Urgent</option>
                </select>
              </label>
              <label className="grid gap-1 md:col-span-3">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Due Date</span>
                <UsDateInput
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(formatted) => setTaskQuickDueDate(formatted)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTask(); } }}
                  value={taskQuickDueDate}
                />
              </label>
              <div className="flex items-end md:col-span-2">
                <button className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90" onClick={handleAddTask} type="button">Add</button>
              </div>
            </div>
            {taskMessage && <p className="mt-3 text-sm font-semibold text-[var(--text-muted)]">{taskMessage}</p>}
          </section>

          <section className="panel-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-lg font-semibold">Tasks</h4>
              <div className="flex items-center gap-3 text-sm">
                <span className="rounded-full bg-[rgba(21,123,191,0.12)] px-3 py-1 font-semibold text-[#0b5c93]">{taskOpenCount} Open</span>
                <span className="rounded-full bg-[rgba(25,109,58,0.12)] px-3 py-1 font-semibold text-[#196d3a]">{taskDoneCount} Done</span>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <label className="grid gap-1 md:col-span-7">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Search</span>
                <input className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search task or due date..." value={taskSearch} />
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Status</span>
                <select className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" onChange={(e) => setTaskStatusFilter(e.target.value as "All" | "Open" | "Done")} value={taskStatusFilter}>
                  <option value="All">All</option><option value="Open">Open</option><option value="Done">Done</option>
                </select>
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Priority</span>
                <select className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2" onChange={(e) => setTaskPriorityFilter(e.target.value as "All" | TaskPriority)} value={taskPriorityFilter}>
                  <option value="All">All</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Urgent">Urgent</option>
                </select>
              </label>
              <div className="flex items-end md:col-span-1">
                <button className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold" onClick={() => { if (window.confirm("Clear all completed tasks?")) clearCompleted(); }} type="button">Clear Done</button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {filteredTasks.map((task) => (
                <article className={`rounded-xl border px-3 py-3 ${task.done ? "border-[var(--line-soft)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)] bg-white"}`} key={task.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <input checked={task.done} className="mt-1" onChange={() => toggleTaskDone(task.id)} type="checkbox" />
                      <div className="grid gap-2">
                        {editingTaskId === task.id ? (
                          <div className="grid gap-2 sm:grid-cols-12">
                            <label className="grid gap-1 sm:col-span-6"><span className="text-xs font-semibold text-[var(--text-muted)]">Task</span><input className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm" onChange={(e) => setEditTaskTitle(e.target.value)} value={editTaskTitle} /></label>
                            <label className="grid gap-1 sm:col-span-3"><span className="text-xs font-semibold text-[var(--text-muted)]">Priority</span><select className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm" onChange={(e) => setEditTaskPriority(e.target.value as TaskPriority)} value={editTaskPriority}><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Urgent">Urgent</option></select></label>
                            <label className="grid gap-1 sm:col-span-3"><span className="text-xs font-semibold text-[var(--text-muted)]">Due Date</span><UsDateInput className="w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm" onChange={(formatted) => setEditTaskDueDate(formatted)} value={editTaskDueDate} /></label>
                          </div>
                        ) : (
                          <>
                            <p className={`font-semibold ${task.done ? "text-[var(--text-muted)] line-through" : ""}`}>{task.title}</p>
                            <p className="text-xs text-[var(--text-muted)]">Created: {new Date(task.createdAt).toLocaleDateString("en-US")}{task.dueDate ? ` • Due: ${formatUsDateFromIso(task.dueDate)}` : ""}{task.patientName ? ` • Patient: ${task.patientName}` : ""}</p>
                          </>
                        )}
                        {editingTaskId === task.id && editTaskError ? <p className="text-xs font-semibold text-[#b43b34]">{editTaskError}</p> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {editingTaskId === task.id ? (
                        <>
                          <button className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-sm font-semibold text-white" onClick={() => saveEditingTask(task.id)} type="button">Save</button>
                          <button className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold" onClick={cancelEditingTask} type="button">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${priorityBadgeClass(task.priority)}`}>{task.priority}</span>
                          <select className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm" onChange={(e) => updateTask(task.id, { priority: e.target.value as TaskPriority })} value={task.priority}>
                            <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Urgent">Urgent</option>
                          </select>
                          <button className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold" onClick={() => startEditingTask(task)} type="button">Edit</button>
                        </>
                      )}
                      <button className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold" onClick={() => { if (!window.confirm("Remove this task?")) return; if (editingTaskId === task.id) cancelEditingTask(); removeTask(task.id); }} type="button">Remove</button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredTasks.length === 0 && (
                <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-4 text-sm text-[var(--text-muted)]">No tasks found.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {view === "birthdays" && (
        <div className="space-y-4">
          <section className="panel-card p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" role="img" aria-label="cake">🎂</span>
              <div>
                <h4 className="text-lg font-semibold">Birthdays This Week</h4>
                <p className="text-sm text-[var(--text-muted)]">{birthdayWeekLabel}</p>
              </div>
            </div>
          </section>

          {birthdayEntries.length === 0 ? (
            <section className="panel-card p-6 text-center">
              <p className="text-3xl" role="img" aria-label="party">🎉</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                No patient birthdays this week.
              </p>
            </section>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {birthdayEntries.map((entry) => {
                const birthYear = Number(entry.dob.split("-")[0]);
                const birthdayDate = new Date(new Date().getFullYear(), entry.birthdayMonth, entry.birthdayDay);
                const dayLabel = birthdayDate.toLocaleDateString("en-US", { weekday: "long" });
                const dateLabel = `${String(entry.birthdayMonth + 1).padStart(2, "0")}/${String(entry.birthdayDay).padStart(2, "0")}`;
                const age = new Date().getFullYear() - birthYear;
                return (
                  <article
                    key={entry.id}
                    className={`panel-card overflow-hidden ${entry.isToday ? "ring-2 ring-amber-400" : ""}`}
                  >
                    {entry.isToday && (
                      <div className="bg-amber-400 px-3 py-1 text-center text-xs font-bold text-amber-900">
                        🎉 Today!
                      </div>
                    )}
                    <div className="flex items-start gap-3 p-4">
                      <span className="text-2xl leading-none" role="img" aria-label="birthday">{entry.isToday ? "🎂" : "🎁"}</span>
                      <div className="min-w-0 flex-1">
                        <Link
                          className="text-base font-bold text-[var(--brand-primary)] hover:underline"
                          href={`/patients/${entry.id}`}
                        >
                          {entry.fullName}
                        </Link>
                        {entry.phone && (
                          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                            <SmsSendMenu
                              context={{
                                patient: {
                                  ...splitFullName(entry.fullName),
                                  fullName: entry.fullName,
                                },
                              }}
                              phone={entry.phone}
                            />
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 font-semibold">
                            {dayLabel}, {dateLabel}
                          </span>
                          <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 font-semibold text-[var(--text-muted)]">
                            Turning {age}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showNewPatientModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-8">
          <ScrollLock />
          <form className="panel-card mx-auto w-full max-w-6xl p-4 md:p-5" onSubmit={(e) => { e.preventDefault(); createNewPatient(); }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl font-semibold">New Patient</h3>
                  <p className="text-sm text-[var(--text-muted)]">
                    Enter core patient details to create a new case file.
                  </p>
                </div>
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                  onClick={closeNewPatientModal}
                  type="button"
                >
                  Close
                </button>
              </div>

              <label className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2">
                <input
                  checked={newPatientDraft.isCashPatient}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setNewPatientDraft((current) => ({
                      ...current,
                      isCashPatient: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-semibold">Cash Patient</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    No attorney, no injury date, no case-number workflow. Just the essentials.
                  </span>
                </span>
              </label>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Last Name *</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        lastName: event.target.value,
                      }))
                    }
                    value={newPatientDraft.lastName}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient First Name *</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        firstName: event.target.value,
                      }))
                    }
                    value={newPatientDraft.firstName}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Sex</span>
                  <select
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        sex: event.target.value as NewPatientDraft["sex"],
                      }))
                    }
                    value={newPatientDraft.sex}
                  >
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Marital Status</span>
                  <select
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        maritalStatus: event.target.value as NewPatientDraft["maritalStatus"],
                      }))
                    }
                    value={newPatientDraft.maritalStatus}
                  >
                    <option value="">—</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Divorced">Divorced</option>
                    <option value="Widowed">Widowed</option>
                  </select>
                </label>

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      list="new-patient-attorney-options"
                      onChange={(event) => {
                        const value = event.target.value;
                        const matchedAttorney = attorneyContacts.find(
                          (contact) => normalizeAttorneyKey(contact.name) === normalizeAttorneyKey(value),
                        );
                        setNewPatientDraft((current) => ({
                          ...current,
                          attorney: value,
                          attorneyPhone: matchedAttorney
                            ? formatUsPhoneInput(matchedAttorney.phone)
                            : value.trim()
                              ? current.attorneyPhone
                              : "",
                        }));
                      }}
                      placeholder="Self"
                      value={newPatientDraft.attorney}
                    />
                  </label>
                )}

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney Phone</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      inputMode="numeric"
                      maxLength={12}
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          attorneyPhone: formatUsPhoneInput(event.target.value),
                        }))
                      }
                      placeholder="818-555-0123"
                      value={newPatientDraft.attorneyPhone}
                    />
                  </label>
                )}

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient DOB</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        dob: formatUsDateInput(event.target.value),
                      }))
                    }
                    placeholder="MM/DD/YYYY"
                    value={newPatientDraft.dob}
                  />
                </label>

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Date Of Injury *</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          dateOfLoss: formatUsDateInput(event.target.value),
                        }))
                      }
                      placeholder="MM/DD/YYYY"
                      value={newPatientDraft.dateOfLoss}
                    />
                  </label>
                )}

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Initial Exam</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          initialExam: formatUsDateInput(event.target.value),
                        }))
                      }
                      placeholder="MM/DD/YYYY"
                      value={newPatientDraft.initialExam}
                    />
                  </label>
                )}

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Case #</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-[rgba(242,247,252,0.65)] px-3 py-2 font-semibold tracking-[0.08em] text-[var(--text-strong)]"
                      placeholder="MMDDYYLASTFIRST"
                      readOnly
                      value={newPatientCaseNumberPreview}
                    />
                  </label>
                )}

                <label className="grid gap-1 md:col-span-1 xl:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Phone</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        phone: formatUsPhoneInput(event.target.value),
                      }))
                    }
                    placeholder="818-555-0123"
                    value={newPatientDraft.phone}
                  />
                </label>

                <label className="grid gap-1 md:col-span-1 xl:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Email</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setNewPatientDraft((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="patient@email.com"
                    value={newPatientDraft.email}
                  />
                </label>

                <div className="grid gap-3 md:col-span-2 xl:col-span-4 xl:grid-cols-[1.6fr_1fr_1.2fr_0.8fr_0.9fr]">
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Address 1</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          addressStreet: event.target.value,
                        }))
                      }
                      placeholder="Street address"
                      value={newPatientDraft.addressStreet}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Address 2</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          addressUnit: event.target.value,
                        }))
                      }
                      placeholder="Unit / Apt / Suite"
                      value={newPatientDraft.addressUnit}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">City</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          addressCity: event.target.value,
                        }))
                      }
                      placeholder="City"
                      value={newPatientDraft.addressCity}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">State</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 uppercase"
                      maxLength={2}
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          addressState: event.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                        }))
                      }
                      placeholder="CA"
                      value={newPatientDraft.addressState}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">ZIP</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          addressZip: event.target.value.replace(/[^\d-]/g, ""),
                        }))
                      }
                      placeholder="91205"
                      value={newPatientDraft.addressZip}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">{lienLabel}</span>
                    <select
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          lienStatus: event.target.value,
                        }))
                      }
                      value={newPatientDraft.lienStatus}
                    >
                      {lienOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Prior Care</span>
                    <input
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          priorCare: event.target.value,
                        }))
                      }
                      placeholder="Any prior treatment details"
                      value={newPatientDraft.priorCare}
                    />
                  </label>
                )}

                {!newPatientDraft.isCashPatient && (
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Case Status</span>
                    <select
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) =>
                        setNewPatientDraft((current) => ({
                          ...current,
                          caseStatus: event.target.value as PatientRecord["caseStatus"],
                        }))
                      }
                      value={newPatientDraft.caseStatus}
                    >
                      {caseStatuses.map((statusConfig) => (
                        <option key={statusConfig.name} value={statusConfig.name}>
                          {statusConfig.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="mt-3 grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Notes</span>
                <textarea
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setNewPatientDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder={
                    newPatientDraft.isCashPatient
                      ? "Anything relevant — chief complaint, preferences, reminders."
                      : "Optional notes about the patient."
                  }
                  rows={3}
                  value={newPatientDraft.notes}
                />
              </label>

              {newPatientMessage && (
                <p className="mt-3 text-sm font-semibold text-[#b43b34]">{newPatientMessage}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={closeNewPatientModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  type="submit"
                >
                  Create Patient
                </button>
              </div>

              <datalist id="new-patient-attorney-options">
                {attorneyContacts.map((contact) => (
                  <option key={contact.id} value={contact.name} />
                ))}
              </datalist>
            </form>
        </div>
      )}

    </div>
  );
}

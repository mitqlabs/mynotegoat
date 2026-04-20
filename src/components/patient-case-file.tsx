"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ContactGapPrompt, findContactByName, type ContactGap } from "@/components/contact-gap-prompt";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useDocumentTemplates } from "@/hooks/use-document-templates";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { usePatientDiagnoses } from "@/hooks/use-patient-diagnoses";
import { usePatientBilling } from "@/hooks/use-patient-billing";
import { usePatientFollowUpOverrides } from "@/hooks/use-patient-follow-up-overrides";
import { useQuickStatsSettings } from "@/hooks/use-quick-stats-settings";
import { useReportTemplates } from "@/hooks/use-report-templates";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { filterAppointmentTypesForPatient } from "@/lib/schedule-appointment-types";
import { useTasks } from "@/hooks/use-tasks";
import { getContrastTextColor, withAlpha } from "@/lib/color-utils";
import { renderDocumentTemplate, type DocumentTemplateScope } from "@/lib/document-templates";
import { createEncounterMacroRunId, encounterSections } from "@/lib/encounter-notes";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { type QuickStatOptionKey } from "@/lib/quick-stats-settings";
import { buildNarrativeReportContext, renderNarrativeReportBody } from "@/lib/report-generator";
import {
  appointmentStatusOptions,
  formatAppointmentStatusLabel,
  formatTimeLabel,
  getStatusBadgeClass,
  isAppointmentStatusSelectable,
  confirmStatusChangeIfNeeded,
  type AppointmentStatus,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import { NewAppointmentModal } from "@/components/new-appointment-modal";
import { RescheduleAppointmentModal } from "@/components/reschedule-appointment-modal";
import { EditAppointmentModal } from "@/components/edit-appointment-modal";
import { DocumentScannerModal } from "@/components/document-scanner-modal";
import { SmsSendMenu } from "@/components/sms-send-menu";
import { CashPaymentsSection } from "@/components/cash-payments-section";
import { AddressFieldGroup } from "@/components/address-field-group";
import { forceSyncNow } from "@/lib/storage-sync-interceptor";
import { buildFollowUpItems } from "@/lib/follow-up-queue";
import { type TaskPriority } from "@/lib/tasks";
import {
  patients as allPatients,
  type PatientRecord,
  type UpdatePatientRecordPatch,
  updatePatientRecordById,
  deletePatientRecord,
  syncRelatedCasesGroup,
  removeFromRelatedCasesGroup,
} from "@/lib/mock-data";
import {
  type FileManagerState,
  type FileRecord,
  getFilesInFolder,
  getFoldersInParent,
  loadFileManagerState,
  saveFileManagerState,
  addFileRecord,
  removeFileRecord,
  renameFileRecord,
  syncPatientFolders,
} from "@/lib/file-manager";
import {
  formatFileSize,
  getSignedUrl,
  downloadFile,
  uploadFileToStorage,
  deleteFileFromStorage,
} from "@/lib/file-storage";
import { loadEmailSettings, renderEmailTemplate } from "@/lib/email-settings";
import { loadOfficeSettings } from "@/lib/office-settings";
import { usePlanTier } from "@/lib/plan-context";

type ImagingMode = "xray" | "mri";
type ImagingPanelKey = "xray" | "mri" | "specialist";
type SectionPanelKey =
  | "notes"
  | "reExam"
  | "relatedCases"
  | "quickStats"
  | "appointments"
  | "diagnosis"
  | "letters"
  | "narrative"
  | "patientFiles"
  | "additionalDetails";
type PopupAnchor = {
  x: number;
  y: number;
};
type ImagingLaterality = "L" | "R" | "BL";
type ImagingRegionOption = {
  label: string;
  modalities: ImagingMode[];
};

type ImagingFormState = {
  sentDate: string;
  center: string;
  isCt?: boolean;
  regions: string[];
  lateralityByRegion: Record<string, ImagingLaterality>;
  flexExtRegions: string[];
  scheduledDate: string;
  doneDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  findings: string;
};

type ImagingReferral = ImagingFormState & {
  id: string;
  modalityLabel: "X-Ray" | "MRI" | "CT";
};

type SpecialistReferral = {
  id: string;
  specialist: string;
  sentDate: string;
  scheduledDate: string;
  completedDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  recommendations: string;
};

type RelatedCaseEntry = {
  patientId: string;
  fullName: string;
  dateOfLoss: string;
};

type NarrativePreviewState = {
  title: string;
  fontFamily: string;
  headerHtml: string;
  bodyHtml: string;
};

const imagingRegions: ImagingRegionOption[] = [
  { label: "Brain", modalities: ["mri"] },
  { label: "Cervical", modalities: ["xray", "mri"] },
  { label: "Thoracic", modalities: ["xray", "mri"] },
  { label: "Lumbar", modalities: ["xray", "mri"] },
  { label: "Chest", modalities: ["xray", "mri"] },
  { label: "Sacrum", modalities: ["xray", "mri"] },
  { label: "Shoulder", modalities: ["xray", "mri"] },
  { label: "Humerus", modalities: ["xray"] },
  { label: "Elbow", modalities: ["xray", "mri"] },
  { label: "Forearm", modalities: ["xray"] },
  { label: "Wrist", modalities: ["xray", "mri"] },
  { label: "Hand", modalities: ["xray", "mri"] },
  { label: "Hip", modalities: ["xray", "mri"] },
  { label: "Femur", modalities: ["xray"] },
  { label: "Tibula/Fibula", modalities: ["xray"] },
  { label: "Knee", modalities: ["xray", "mri"] },
  { label: "Ankle", modalities: ["xray", "mri"] },
  { label: "Foot", modalities: ["xray", "mri"] },
];
const lateralityOptions: ImagingLaterality[] = ["L", "R", "BL"];
const lateralityEnabledRegions = new Set([
  "shoulder",
  "elbow",
  "wrist",
  "hand",
  "hip",
  "knee",
  "ankle",
  "foot",
]);
const xrayFlexExtEnabledRegions = new Set(["cervical", "thoracic", "lumbar"]);

const reviewOptions = ["Not Requested", "Requested", "Received"];

function getNames(fullName: string) {
  const [lastName = "", firstName = ""] = fullName.split(",").map((value) => value.trim());
  return { firstName, lastName };
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNameForLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildPatientNameLookupSet(fullName: string, firstName: string, lastName: string) {
  const set = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizeNameForLookup(value);
    if (normalized) {
      set.add(normalized);
    }
  };
  push(fullName);
  if (firstName || lastName) {
    push(`${firstName} ${lastName}`);
    push(`${lastName} ${firstName}`);
    push(`${lastName}, ${firstName}`);
    push(`${firstName}, ${lastName}`);
  }
  return set;
}

function isSpecialistReferralContactCategory(category: string) {
  // Only the fixed "Specialist" top-level category is a specialist.
  // Attorneys and Imaging Centers are categorically different; the
  // "Hospital/ER" label is now a sub-category under Specialist rather
  // than its own top-level.
  return normalizeLookupValue(category) === "specialist";
}

function supportsRegionLaterality(region: string) {
  return lateralityEnabledRegions.has(normalizeLookupValue(region));
}

function supportsXrayFlexExt(region: string) {
  return xrayFlexExtEnabledRegions.has(normalizeLookupValue(region));
}

function formatRegionLabel(region: string, lateralityByRegion: Record<string, ImagingLaterality>) {
  if (!supportsRegionLaterality(region)) {
    return region;
  }
  const laterality = lateralityByRegion[region];
  return laterality ? `${region} (${laterality})` : region;
}

function cloneImagingFormState(value: ImagingFormState): ImagingFormState {
  return {
    ...value,
    regions: [...value.regions],
    flexExtRegions: [...value.flexExtRegions],
    lateralityByRegion: { ...value.lateralityByRegion },
    findings: value.findings ?? "",
  };
}

function emptyImagingFormState(mode: ImagingMode): ImagingFormState {
  return {
    sentDate: "",
    center: "",
    isCt: mode === "mri" ? false : undefined,
    regions: [],
    lateralityByRegion: {},
    flexExtRegions: [],
    scheduledDate: "",
    doneDate: "",
    reportReceivedDate: "",
    reportReviewedDate: "",
    findings: "",
  };
}

function formatImagingRegionsSummary(entry: ImagingReferral, mode: ImagingMode) {
  if (!entry.regions.length) {
    return "No regions selected";
  }
  return entry.regions
    .map((region) => {
      const baseLabel = formatRegionLabel(region, entry.lateralityByRegion);
      const hasFlexExt = mode === "xray" && entry.flexExtRegions.includes(region);
      return hasFlexExt ? `${baseLabel} (Flex/Ext)` : baseLabel;
    })
    .join(", ");
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

function toUsDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    return `${month}/${day}/${year}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day, year2] = trimmed.split("/");
    return `${month}/${day}/20${year2}`;
  }

  return formatUsDateInput(trimmed);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPopupAnchorFromEvent(event: MouseEvent<HTMLElement>): PopupAnchor {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function getPopupAnchorFromElement(element: HTMLElement | null): PopupAnchor | null {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getAnchoredModalStyle(
  anchor: PopupAnchor | null,
  maxWidthPx: number,
  maxHeightVh: number,
): CSSProperties {
  if (typeof window === "undefined") {
    return {};
  }
  const margin = 16;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(maxWidthPx, Math.max(360, viewportWidth - margin * 2));
  const maxHeight = Math.min(
    (viewportHeight * maxHeightVh) / 100,
    Math.max(320, viewportHeight - margin * 2),
  );
  const centerX = anchor?.x ?? viewportWidth / 2;
  const centerY = anchor?.y ?? viewportHeight / 2;
  const left = clamp(centerX - width / 2, margin, viewportWidth - width - margin);
  const top = clamp(centerY - 48, margin, viewportHeight - maxHeight - margin);

  return {
    position: "absolute",
    left,
    top,
    width,
    maxHeight,
  };
}

function getTodayUsDate() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  const year = now.getFullYear();
  return `${month}/${day}/${year}`;
}

function parseUsDate(value: string) {
  const formatted = toUsDate(value);
  const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toIsoDateFromUsDate(value: string) {
  const parsed = parseUsDate(value);
  if (!parsed) {
    return "";
  }
  const year = parsed.getUTCFullYear();
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toSortStampFromUsDate(dateValue: string) {
  const parsedDate = parseUsDate(dateValue);
  if (!parsedDate) {
    return 0;
  }
  const stamp = new Date(
    Date.UTC(
      parsedDate.getUTCFullYear(),
      parsedDate.getUTCMonth(),
      parsedDate.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  ).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function addMonthsClamped(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(year, month + months, day));
  if (shifted.getUTCDate() !== day) {
    shifted.setUTCDate(0);
  }
  return shifted;
}

function getMonthDayDiff(start: Date, end: Date) {
  if (end < start) {
    return null;
  }

  let cursor = new Date(start.getTime());
  let months = 0;

  while (true) {
    const next = addMonthsClamped(cursor, 1);
    if (next <= end) {
      cursor = next;
      months += 1;
      continue;
    }
    break;
  }

  const days = Math.floor((end.getTime() - cursor.getTime()) / 86400000);
  return { months, days };
}

function formatMonthDayDiff(diff: { months: number; days: number } | null) {
  if (!diff) {
    return "-";
  }
  const monthLabel = `${diff.months} month${diff.months === 1 ? "" : "s"}`;
  const dayLabel = `${diff.days} day${diff.days === 1 ? "" : "s"}`;
  return `${monthLabel}, ${dayLabel}`;
}

function formatPercentage(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatUsdCurrency(value: number) {
  if (!Number.isFinite(value)) {
    return "$0.00";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildCaseNumber(dateOfLoss: string, lastName: string, firstName: string) {
  const formattedDate = toUsDate(dateOfLoss);
  const dateMatch = formattedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return "";
  }

  const month = dateMatch[1];
  const day = dateMatch[2];
  const year = dateMatch[3].slice(-2);
  const cleanLast = lastName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  const cleanFirst = firstName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);

  return `${month}${day}${year}${cleanLast}${cleanFirst}`;
}

function buildDocumentTitle(caseNumber: string, lastName: string, firstName: string, docType: string) {
  const nameStr = [lastName, firstName].filter(Boolean).join(", ");
  const prefix = [caseNumber, nameStr].filter(Boolean).join(" ");
  return prefix ? `${prefix} - ${docType}` : docType;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type PrintableDocumentConfig = {
  title: string;
  headerHtml: string;
  bodyHtml: string;
  headerFontFamily: string;
  fontFamily: string;
  includeLogo: boolean;
  logoDataUrl: string;
  encounterPagesHtml?: string;
  billingPagesHtml?: string;
};

/** Strip leading whitespace from each line if the content contains HTML tags.
 *  This prevents pre-wrap from indenting AI-generated narrative HTML,
 *  while leaving plain-text templates with tabs intact. */
function stripHtmlIndentation(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html; // plain text — keep tabs
  return html.replace(/^[ \t]+/gm, "");
}

function buildPrintableDocumentHtml(config: PrintableDocumentConfig) {
  const { title, headerHtml, fontFamily, includeLogo, logoDataUrl } = config;
  const bodyHtml = stripHtmlIndentation(config.bodyHtml);
  const encounterPagesHtml = config.encounterPagesHtml ?? "";
  const billingPagesHtml = config.billingPagesHtml ?? "";
  const headerFontFamily = config.headerFontFamily;
  const safeTitle = escapeHtml(title);
  const safeHeaderFontFamily = escapeHtml(headerFontFamily || "Georgia, 'Times New Roman', serif");
  const safeFontFamily = escapeHtml(fontFamily || "Georgia, 'Times New Roman', serif");
  const safeLogoDataUrl = escapeHtml(logoDataUrl || "");
  const logoMarkup =
    includeLogo && safeLogoDataUrl
      ? `<img alt="Office Logo" src="${safeLogoDataUrl}" class="office-logo" />`
      : "";
  const headerTopMarkup = (logoMarkup || headerHtml.trim())
    ? `<div class="header-top">${headerHtml.trim() ? `<div class="header">${headerHtml}</div>` : ""}${logoMarkup}</div>`
    : "";
  const headerMarkup = "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #13293d;
        font-family: ${safeFontFamily};
        font-size: 14px;
        line-height: 1.6;
      }
      .content div, .content section, .content article, .content aside,
      .content details, .content summary, .content figure, .content figcaption,
      .content dl, .content dt, .content dd, .content blockquote, .content pre,
      .content fieldset, .content legend, .content nav, .content footer, .content header {
        margin: 0 !important; padding: 0 !important; border: 0 !important; text-indent: 0 !important;
        margin-left: 0 !important; padding-left: 0 !important;
      }
      h1, h2, h3, h4, h5, h6 { margin: 14px 0 4px 0; text-indent: 0; }
      p { margin: 0 0 6px 0; text-indent: 0; }
      ul, ol { margin: 0 0 6px 0; padding-left: 20px; text-indent: 0; }
      li { margin: 0 0 2px 0; text-indent: 0; }
      dd { margin-left: 0; }
      blockquote { margin: 0 0 6px 0; padding-left: 12px; border-left: 3px solid #ccc; }
      table { border-collapse: collapse; width: 100%; margin: 0 0 8px 0; }
      td, th { padding: 3px 6px; text-align: left; font-size: 13px; }
      .wrapper {
        width: 100%;
        margin: 0;
        padding: 0;
      }
      .content {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ${safeFontFamily};
        font-size: 14px;
        line-height: 1.6;
      }
      .header {
        flex: 1;
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ${safeHeaderFontFamily};
        font-size: 13px;
        line-height: 1.5;
      }
      .header-top {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        margin: 0 0 12px 0 !important;
        gap: 16px !important;
      }
      .office-logo {
        max-height: 100px;
        min-height: 60px;
        width: auto;
        max-width: 300px;
        min-width: 120px;
        object-fit: contain;
        display: block;
      }

      /* ── Attached SOAP encounter pages ──
         Use "all: initial" to completely isolate from the narrative
         document's CSS (its global p, *, body rules were leaking in
         and causing visible paragraph-indent / tab artefacts).
         After the reset we re-declare every style the encounter print
         needs — this is an EXACT copy of the standalone encounter
         print CSS from encounter-workspace.tsx.                       */
      .soap-pages {
        all: initial !important;
        display: block !important;
        box-sizing: border-box !important;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif !important;
        font-size: 12px !important;
        line-height: 1.4 !important;
        color: #1a1a1a !important;
        white-space: normal !important;
        background: #fff !important;
      }
      /* Reset every child element to inherit from .soap-pages, not from body/global */
      .soap-pages * {
        all: unset;
        display: revert;
        box-sizing: border-box;
        white-space: normal !important;
        text-indent: 0 !important;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        color: inherit;
      }
      /* Re-declare every style exactly matching the standalone encounter print */
      .soap-pages .letterhead {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding-bottom: 8px;
        border-bottom: 2px solid #0d79bf;
        margin-bottom: 10px;
      }
      .soap-pages .logo {
        height: 70px;
        width: auto;
        max-width: 200px;
        object-fit: contain;
        flex-shrink: 0;
        display: block;
        margin: 0;
        padding: 0;
      }
      .soap-pages .office-info { flex: 1; text-align: right; margin: 0; padding: 0; }
      .soap-pages .office-name-lh { font-size: 15px; font-weight: 700; color: #0d79bf; margin: 0; padding: 0; line-height: 1.2; }
      .soap-pages .office-detail { font-size: 11px; color: #444; line-height: 1.5; margin: 0; }
      .soap-pages p { display: block; margin: 0 0 3px 0; padding: 0; text-indent: 0 !important; }
      .soap-pages strong, .soap-pages b { font-weight: 700; }
      .soap-pages em, .soap-pages i { font-style: italic; }
      .soap-pages u { text-decoration: underline; }
      .soap-pages s, .soap-pages strike, .soap-pages del { text-decoration: line-through; }
      .soap-pages sub { vertical-align: sub; font-size: smaller; }
      .soap-pages sup { vertical-align: super; font-size: smaller; }
      .soap-pages br { display: block; }
      .soap-pages img { display: inline; }
      .soap-pages .patient-banner {
        background: #f0f6fb;
        border: 1px solid #d0dfe9;
        border-radius: 4px;
        padding: 6px 10px;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .soap-pages .patient-banner .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #5a7a8f; }
      .soap-pages .patient-banner .name { font-size: 14px; font-weight: 700; color: #13293d; }
      .soap-pages .patient-banner .doc-title { font-size: 11px; font-weight: 600; color: #0d79bf; }
      .soap-pages .encounter {
        border: 1px solid #d0dfe9;
        border-radius: 4px;
        margin-bottom: 8px;
        display: block;
      }
      .soap-pages .encounter-header {
        background: #0d79bf;
        color: #fff;
        padding: 4px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .soap-pages .encounter-date { font-size: 12px; font-weight: 700; color: #fff; }
      .soap-pages .encounter-type { font-size: 11px; opacity: 0.9; color: #fff; }
      .soap-pages .encounter-meta {
        background: #f7fafc;
        padding: 3px 10px;
        border-bottom: 1px solid #e2eaf0;
        font-size: 10px;
        color: #5a7a8f;
        display: flex;
        gap: 16px;
      }
      .soap-pages .soap-section {
        padding: 4px 10px;
        border-bottom: 1px solid #eef2f6;
        display: block;
      }
      .soap-pages .soap-section:last-child { border-bottom: none; }
      .soap-pages .soap-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #0d79bf;
        margin-bottom: 2px;
        display: block;
      }
      .soap-pages .soap-content {
        font-size: 12px;
        line-height: 1.45;
        color: #1a1a1a;
        word-break: break-word;
        display: block;
      }
      .soap-pages .soap-content p { margin: 0 0 3px 0; padding: 0; text-indent: 0 !important; display: block; }
      .soap-pages .soap-content div { margin: 0; padding: 0; text-indent: 0 !important; display: block; }
      .soap-pages .soap-content span { font-size: inherit; color: inherit; }
      .soap-pages .soap-content b, .soap-pages .soap-content strong { font-weight: 700; }
      .soap-pages .soap-content em, .soap-pages .soap-content i { font-style: italic; }
      .soap-pages .soap-content u { text-decoration: underline; }
      .soap-pages .print-footer {
        margin-top: 14px;
        padding-top: 6px;
        border-top: 1px solid #d0dfe9;
        font-size: 9px;
        color: #8899a6;
        text-align: center;
        display: block;
      }

      /* ── Attached Billing Statement pages ── */
      .billing-pages {
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 11px;
        line-height: 1.4;
        color: #121a27;
        white-space: normal !important;
      }
      .billing-pages, .billing-pages * { white-space: normal !important; }
      .billing-pages .bill-letterhead {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding-bottom: 6px;
        border-bottom: 2px solid #0d79bf;
        margin-bottom: 8px;
      }
      .billing-pages .bill-logo {
        height: 60px;
        width: auto;
        max-width: 160px;
        object-fit: contain;
        flex-shrink: 0;
      }
      .billing-pages .bill-office-info { flex: 1; text-align: right; }
      .billing-pages .bill-office-name { font-size: 14px; font-weight: 700; color: #0d79bf; margin: 0; line-height: 1.2; }
      .billing-pages .bill-office-detail { font-size: 10px; color: #444; line-height: 1.4; margin: 0; }
      .billing-pages .bill-title { text-align: center; font-size: 16px; font-weight: 700; margin: 10px 0 8px 0; color: #0d79bf; }
      .billing-pages .bill-meta-row {
        border-top: 1px solid #d0dfe9;
        padding-top: 6px;
        margin-bottom: 8px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        font-size: 10px;
      }
      .billing-pages .bill-section { margin-top: 8px; }
      .billing-pages .bill-section h3 { margin: 0 0 4px 0; font-size: 12px; font-weight: 700; color: #0d79bf; }
      .billing-pages table { width: 100%; border-collapse: collapse; }
      .billing-pages th, .billing-pages td {
        border: 1px solid #d0dfe9;
        padding: 3px 6px;
        font-size: 10px;
        vertical-align: top;
        text-align: left;
      }
      .billing-pages th {
        background: #f0f6fb;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #5a7a8f;
      }
      .billing-pages .bill-totals { margin-top: 8px; display: flex; justify-content: flex-end; }
      .billing-pages .bill-total-box {
        background: #0d79bf !important;
        color: #fff !important;
        padding: 8px 18px;
        font-size: 14px;
        font-weight: 700;
        border-radius: 4px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      @page {
        size: Letter;
        margin: 0.55in;
      }
      @media print {
        .soap-pages * { break-inside: auto !important; break-before: auto !important; break-after: auto !important; }
        .encounter { page-break-inside: auto !important; }
      }
    </style>
  </head>
  <body>
    ${encounterPagesHtml}
    <main class="wrapper"${encounterPagesHtml ? ' style="page-break-before: always;"' : ""}>
      ${headerTopMarkup}
      ${headerMarkup}
      <div class="content">${bodyHtml}</div>
    </main>
    ${billingPagesHtml}
  </body>
</html>`;
}

/**
 * Build a full standalone SOAP-notes HTML document — identical styling to the
 * encounter workspace print. Returns a complete `<!doctype html>…</html>`
 * string that can be concatenated before the narrative document.
 */
function buildSoapPrintHtmlForNarrative(config: {
  officeName: string;
  officeAddress: string;
  officePhone: string;
  officeFax: string;
  officeEmail: string;
  logoDataUrl: string;
  patientName: string;
  encounters: Array<{
    encounterDate: string;
    provider: string;
    appointmentType: string;
    signed: boolean;
    soap: Record<string, string>;
  }>;
}) {
  if (!config.encounters.length) return "";

  const formatSoapText = (text: string) => {
    let cleaned = text.trim();
    if (!cleaned) return "-";
    // Nuclear fix: strip ALL inline style attributes from the HTML.
    // The editor saves style="..." on <p>, <div>, <span> etc. with
    // text-indent, padding, margins, white-space that cause visible
    // tab/indent artefacts when embedded inside the narrative document.
    // The print CSS handles all visual styling — inline styles only hurt.
    cleaned = cleaned
      .replace(/\s*style\s*=\s*"[^"]*"/gi, "")
      .replace(/\s*style\s*=\s*'[^']*'/gi, "")
      .replace(/\t/g, "")
      .replace(/&(emsp|ensp|Tab|#9|#x9);/gi, "")
      .replace(/^[ \t]+/gm, "");
    return cleaned;
  };

  const logoMarkup = config.logoDataUrl.trim()
    ? `<img alt="Office Logo" src="${escapeHtml(config.logoDataUrl)}" class="logo" />`
    : "";

  const encounterMarkup = config.encounters
    .map(
      (encounter) => `<section class="encounter">
  <div class="encounter-header">
    <div class="encounter-date">${escapeHtml(encounter.encounterDate)}</div>
    <div class="encounter-type">${escapeHtml(encounter.appointmentType)}</div>
  </div>
  <div class="encounter-meta">
    <span>Provider: <strong>${escapeHtml(encounter.provider)}</strong></span>
  </div>
  <div class="soap-section">
    <div class="soap-label">Subjective</div>
    <div class="soap-content">${formatSoapText(encounter.soap.subjective ?? "")}</div>
  </div>
  <div class="soap-section">
    <div class="soap-label">Objective</div>
    <div class="soap-content">${formatSoapText(encounter.soap.objective ?? "")}</div>
  </div>
  <div class="soap-section">
    <div class="soap-label">Assessment</div>
    <div class="soap-content">${formatSoapText(encounter.soap.assessment ?? "")}</div>
  </div>
  <div class="soap-section">
    <div class="soap-label">Plan</div>
    <div class="soap-content">${formatSoapText(encounter.soap.plan ?? "")}</div>
  </div>
</section>`,
    )
    .join("");

  return `<div class="soap-pages" style="page-break-after: always;">
    <header class="letterhead">
      ${logoMarkup}
      <div class="office-info">
        <p class="office-name-lh">${escapeHtml(config.officeName)}</p>
        <p class="office-detail">
          ${escapeHtml(config.officeAddress)}<br />
          T: ${escapeHtml(config.officePhone)}${config.officeFax.trim() ? ` &nbsp;|&nbsp; F: ${escapeHtml(config.officeFax)}` : ""}<br />
          ${escapeHtml(config.officeEmail)}
        </p>
      </div>
    </header>
    <div class="patient-banner">
      <div>
        <p class="label">Patient</p>
        <p class="name">${escapeHtml(config.patientName)}</p>
      </div>
      <div class="doc-title">Clinical SOAP Notes</div>
    </div>
    ${encounterMarkup}
    <div class="print-footer">
      ${escapeHtml(config.officeName)} &bull; Confidential Medical Record
    </div>
  </div>`;
}

/**
 * Build a billing statement HTML fragment for attaching to the narrative PDF.
 * Uses the same compact professional layout as the billing page print.
 */
function buildBillingStatementHtmlForNarrative(config: {
  officeName: string;
  officeAddress: string;
  officePhone: string;
  officeFax: string;
  officeEmail: string;
  logoDataUrl: string;
  patientName: string;
  patientDob: string;
  patientDoi: string;
  caseNumber: string;
  attorneyName: string;
  attorneyPhone: string;
  providerName: string;
  diagnoses: Array<{ code: string; description: string }>;
  charges: Array<{
    encounterDate: string;
    procedureCode: string;
    description: string;
    units: number;
    lineTotal: number;
  }>;
  total: number;
}): string {
  if (!config.charges.length) return "";

  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);

  const logoMarkup = config.logoDataUrl.trim()
    ? `<img alt="Office Logo" src="${escapeHtml(config.logoDataUrl)}" class="bill-logo" />`
    : "";

  const diagnosisRows = config.diagnoses
    .map(
      (d, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(d.code)}</td><td>${escapeHtml(d.description)}</td></tr>`,
    )
    .join("");

  const diagnosisSection = config.diagnoses.length
    ? `<section class="bill-section">
        <h3>Diagnoses</h3>
        <table><thead><tr><th>#</th><th>Code</th><th>Description</th></tr></thead>
        <tbody>${diagnosisRows}</tbody></table>
      </section>`
    : "";

  const chargeRows = config.charges
    .map(
      (c, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(c.encounterDate)}</td>
        <td>${escapeHtml(`${c.procedureCode} - ${c.description}`)}</td>
        <td>11</td>
        <td>${c.units}</td>
        <td>${escapeHtml(fmtMoney(c.lineTotal))}</td>
        <td>${escapeHtml(fmtMoney(0))}</td>
      </tr>`,
    )
    .join("");

  return `<div class="billing-pages" style="page-break-before: always;">
    <header class="bill-letterhead">
      ${logoMarkup}
      <div class="bill-office-info">
        <p class="bill-office-name">${escapeHtml(config.officeName)}</p>
        <p class="bill-office-detail">
          ${escapeHtml(config.officeAddress)}<br />
          T: ${escapeHtml(config.officePhone)}${config.officeFax.trim() ? ` | F: ${escapeHtml(config.officeFax)}` : ""}<br />
          ${escapeHtml(config.officeEmail)}
        </p>
      </div>
    </header>
    <div class="bill-title">Statement for Reimbursement</div>
    <div class="bill-meta-row">
      <div>
        <strong>Patient:</strong> ${escapeHtml(config.patientName)}${config.caseNumber ? ` (${escapeHtml(config.caseNumber)})` : ""}<br />
        <strong>DOB:</strong> ${escapeHtml(config.patientDob || "-")}<br />
        <strong>Date of Injury:</strong> ${escapeHtml(config.patientDoi || "-")}
      </div>
      <div style="text-align:right">
        <strong>Attorney:</strong> ${escapeHtml(config.attorneyName || "-")}<br />
        <strong>Attorney Phone:</strong> ${escapeHtml(config.attorneyPhone || "-")}<br />
        <strong>Provider:</strong> ${escapeHtml(config.providerName || "-")}
      </div>
    </div>
    ${diagnosisSection}
    <section class="bill-section">
      <h3>Procedures</h3>
      <table>
        <thead><tr><th>ID</th><th>Date</th><th>Service</th><th>POS</th><th>Un</th><th>Charge</th><th>Tax</th></tr></thead>
        <tbody>${chargeRows}</tbody>
      </table>
    </section>
    <div class="bill-totals">
      <div class="bill-total-box">Total: ${escapeHtml(fmtMoney(config.total))}</div>
    </div>
  </div>`;
}

function printHtmlWithIframeFallback(printableHtml: string) {
  const popup = window.open("", "_blank");
  if (popup) {
    popup.document.open();
    popup.document.write(printableHtml);
    popup.document.close();

    const triggerPopupPrint = () => {
      try {
        popup.focus();
        popup.print();
        return true;
      } catch {
        return false;
      }
    };

    if (popup.document.readyState === "complete") {
      setTimeout(() => {
        triggerPopupPrint();
      }, 80);
    } else {
      popup.onload = () => {
        setTimeout(() => {
          triggerPopupPrint();
        }, 80);
      };
    }
    return true;
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument ?? iframe.contentWindow?.document;
  const frameWindow = iframe.contentWindow;
  if (!frameDocument || !frameWindow) {
    iframe.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(printableHtml);
  frameDocument.close();

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    iframe.remove();
  };

  frameWindow.onafterprint = cleanup;
  setTimeout(cleanup, 6000);

  setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
    }
  }, 120);

  return true;
}

export function PatientCaseFile({ patient }: { patient: PatientRecord }) {
  const router = useRouter();
  const { officeSettings } = useOfficeSettings();
  const { caseStatuses, lienLabel, lienOptions } = useCaseStatuses();
  const { billingMacros } = useBillingMacros();
  const { contacts, addContact } = useContactDirectory();
  const { documentTemplates } = useDocumentTemplates();
  const { reportTemplates } = useReportTemplates();
  const { quickStatsSettings } = useQuickStatsSettings();
  const { getRecord: getPatientBillingRecord, setCoreFields: setPatientBillingCoreFields } = usePatientBilling();
  const { scheduleAppointments, updateAppointment, removeAppointment } = useScheduleAppointments();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { tasks, addTask, toggleTaskDone } = useTasks();
  // patientFlowItems moved below usePatientFollowUpOverrides so overrides are available
  const patientTasks = useMemo(
    () => tasks.filter((task) => task.patientId === patient.id),
    [tasks, patient.id],
  );
  const { encountersByNewest, createEncounter, setSoapSection, addMacroRun, addCharge, deleteEncounter } = useEncounterNotes();
  const { macroLibrary } = useMacroTemplates();
  const { entries: patientDiagnoses, addDiagnosis, addBulkDiagnoses, removeDiagnosis, reorderDiagnoses } = usePatientDiagnoses(patient.id);
  const { recordsByPatientId: followUpOverridesByPatientId, getRecord: getPatientFollowUpOverride, setPatientRefused, setCompletedPriorCare, setNotNeeded } =
    usePatientFollowUpOverrides();
  const patientFlowItems = useMemo(
    () => buildFollowUpItems([patient], { followUpOverrides: followUpOverridesByPatientId }),
    [patient, followUpOverridesByPatientId],
  );
  const patientBillingRecord = getPatientBillingRecord(patient.id);
  const currentPlanTier = usePlanTier();
  const isCompletePlan = currentPlanTier === "complete";
  const names = useMemo(() => getNames(patient.fullName), [patient.fullName]);

  const attorneyContacts = useMemo(
    () =>
      contacts
        .filter((contact) => normalizeLookupValue(contact.category) === "attorney")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );
  const imagingCenterContacts = useMemo(
    () =>
      contacts
        .filter(
          (contact) => normalizeLookupValue(contact.category) === "imaging center",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );
  const imagingCenters = useMemo(
    () => imagingCenterContacts.map((contact) => contact.name),
    [imagingCenterContacts],
  );
  // Case-insensitive lookup so a user who typed "advanced imaging" matches
  // the stored "Advanced Imaging" contact and still gets the address/phone
  // rendered below the input.
  const imagingCenterByName = useMemo(() => {
    const map = new Map<string, (typeof contacts)[number]>();
    for (const contact of imagingCenterContacts) {
      map.set(contact.name.trim().toLowerCase(), contact);
    }
    return map;
  }, [imagingCenterContacts]);
  const specialistContactDirectory = useMemo(
    () =>
      contacts
        .filter((contact) => isSpecialistReferralContactCategory(contact.category))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );
  const specialistContacts = useMemo(
    () => specialistContactDirectory.map((contact) => contact.name),
    [specialistContactDirectory],
  );

  const [firstName, setFirstName] = useState(names.firstName);
  const [lastName, setLastName] = useState(names.lastName);
  const [patientAlerts, setPatientAlerts] = useState<string[]>(patient.alerts ?? []);
  const [alertDraft, setAlertDraft] = useState("");
  const [attorney, setAttorney] = useState(patient.attorney);
  const [showAddAttorneyPrompt, setShowAddAttorneyPrompt] = useState(false);
  const [showAddAttorneyForm, setShowAddAttorneyForm] = useState(false);
  const [dismissedAttorneyDrafts, setDismissedAttorneyDrafts] = useState<string[]>([]);
  const [attorneyModalError, setAttorneyModalError] = useState("");
  const [newAttorneyDraft, setNewAttorneyDraft] = useState({
    name: "",
    phone: "",
    fax: "",
    email: "",
    address: "",
  });
  const [patientDob, setPatientDob] = useState(toUsDate(patient.dob));
  const [patientSex, setPatientSex] = useState<"Male" | "Female" | "Other" | "">(patient.sex ?? "");
  const [maritalStatus, setMaritalStatus] = useState<"Single" | "Married" | "Divorced" | "Widowed" | "Other" | "">(patient.maritalStatus ?? "");
  const [dateOfLoss, setDateOfLoss] = useState(toUsDate(patient.dateOfLoss));
  const [initialExam, setInitialExam] = useState(toUsDate(patient.matrix?.initialExam ?? ""));
  const [patientPhone, setPatientPhone] = useState(formatUsPhoneInput(patient.phone));
  const [patientEmail, setPatientEmail] = useState(patient.email ?? "");
  const [patientAddress, setPatientAddress] = useState(patient.address ?? "");
  const [lienStatus, setLienStatus] = useState(() => {
    const currentLien = patient.matrix?.lien?.trim();
    if (currentLien) {
      return currentLien;
    }
    return lienOptions[0] || "Not Set";
  });
  const [priorCare, setPriorCare] = useState(patient.matrix?.priorCare ?? "");
  const [xrayFindings, setXrayFindings] = useState(patient.matrix?.xrayFindings ?? "");
  const [mriCtFindings, setMriCtFindings] = useState(patient.matrix?.mriCtFindings ?? "");
  const [specialistRecommendations, setSpecialistRecommendations] = useState(
    patient.matrix?.specialistRecommendations ?? "",
  );
  const [patientNotes, setPatientNotes] = useState(patient.matrix?.notes ?? "");
  const [caseStatus, setCaseStatus] = useState<string>(patient.caseStatus);
  const [isCashPatient, setIsCashPatient] = useState<boolean>(Boolean(patient.isCashPatient));

  const [xray, setXray] = useState<ImagingFormState>({
    sentDate: "",
    center: "",
    regions: [],
    lateralityByRegion: {},
    flexExtRegions: [],
    scheduledDate: "",
    doneDate: "",
    reportReceivedDate: toUsDate(patient.matrix?.xrayReceived ?? ""),
    reportReviewedDate: toUsDate(patient.matrix?.xrayReviewed ?? ""),
    findings: "",
  });
  const [xrayReferrals, setXrayReferrals] = useState<ImagingReferral[]>(() =>
    Array.isArray(patient.xrayReferrals)
      ? (patient.xrayReferrals as ImagingReferral[]).map((r) => ({ ...r, findings: r.findings ?? "" }))
      : [],
  );
  const [xrayMessage, setXrayMessage] = useState("");
  const [editingXrayReferralId, setEditingXrayReferralId] = useState<string | null>(null);

  const [mri, setMri] = useState<ImagingFormState>({
    sentDate: "",
    center: "",
    isCt: false,
    regions: [],
    lateralityByRegion: {},
    flexExtRegions: [],
    scheduledDate: toUsDate(patient.matrix?.mriScheduled ?? ""),
    doneDate: "",
    reportReceivedDate: toUsDate(patient.matrix?.mriReceived ?? ""),
    reportReviewedDate: toUsDate(patient.matrix?.mriReviewed ?? ""),
    findings: "",
  });
  const [mriReferrals, setMriReferrals] = useState<ImagingReferral[]>(() =>
    Array.isArray(patient.mriReferrals)
      ? (patient.mriReferrals as ImagingReferral[]).map((r) => ({ ...r, findings: r.findings ?? "" }))
      : [],
  );
  const [mriMessage, setMriMessage] = useState("");
  const [editingMriReferralId, setEditingMriReferralId] = useState<string | null>(null);
  const [editingImagingReferral, setEditingImagingReferral] = useState<(ImagingReferral & { mode: ImagingMode }) | null>(null);
  const [imagingEditorAnchor, setImagingEditorAnchor] = useState<PopupAnchor | null>(null);

  const [specialistDraft, setSpecialistDraft] = useState({
    specialist: "",
    sentDate: "",
  });
  const [specialistReferrals, setSpecialistReferrals] = useState<SpecialistReferral[]>(() => {
    if (!Array.isArray(patient.specialistReferrals)) return [];
    return (patient.specialistReferrals as Record<string, unknown>[]).map((raw) => ({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      specialist: typeof raw.specialist === "string" ? raw.specialist : "",
      sentDate: typeof raw.sentDate === "string" ? raw.sentDate : "",
      scheduledDate: typeof raw.scheduledDate === "string" ? raw.scheduledDate : "",
      completedDate: typeof raw.completedDate === "string" ? raw.completedDate : "",
      reportReceivedDate: typeof raw.reportReceivedDate === "string" ? raw.reportReceivedDate : "",
      reportReviewedDate: typeof raw.reportReviewedDate === "string" ? raw.reportReviewedDate : "",
      recommendations: typeof raw.recommendations === "string" ? raw.recommendations : "",
    }));
  });
  const [specialistMessage, setSpecialistMessage] = useState("");
  const [contactGap, setContactGap] = useState<ContactGap | null>(null);
  const [editingSpecialist, setEditingSpecialist] = useState<SpecialistReferral | null>(null);
  const [imagingPanelsOpen, setImagingPanelsOpen] = useState<Record<ImagingPanelKey, boolean>>({
    xray: false,
    mri: false,
    specialist: false,
  });
  const [sectionPanelsOpen, setSectionPanelsOpen] = useState<Record<SectionPanelKey, boolean>>({
    notes: false,
    reExam: false,
    relatedCases: false,
    quickStats: false,
    appointments: false,
    diagnosis: false,
    letters: false,
    narrative: false,
    patientFiles: false,
    additionalDetails: false,
  });
  const quickTaskButtonRef = useRef<HTMLButtonElement | null>(null);
  const attorneyInputRef = useRef<HTMLInputElement | null>(null);
  const [regionModalAnchor, setRegionModalAnchor] = useState<PopupAnchor | null>(null);
  const [attorneyPromptAnchor, setAttorneyPromptAnchor] = useState<PopupAnchor | null>(null);
  const [attorneyFormAnchor, setAttorneyFormAnchor] = useState<PopupAnchor | null>(null);
  const [specialistEditorAnchor, setSpecialistEditorAnchor] = useState<PopupAnchor | null>(null);
  const [quickTaskAnchor, setQuickTaskAnchor] = useState<PopupAnchor | null>(null);
  const [showQuickTaskModal, setShowQuickTaskModal] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");
  const [quickTaskPriority, setQuickTaskPriority] = useState<TaskPriority>("Medium");
  const [quickTaskDueDate, setQuickTaskDueDate] = useState("");
  const [quickTaskModalMessage, setQuickTaskModalMessage] = useState("");
  const [quickTaskStatusMessage, setQuickTaskStatusMessage] = useState("");

  const [reExamDraft, setReExamDraft] = useState("");
  const [reExams, setReExams] = useState<string[]>(
    [patient.matrix?.reExam1, patient.matrix?.reExam2, patient.matrix?.reExam3].filter(
      (value): value is string => Boolean(value?.trim()),
    ),
  );

  const [relatedCaseDraft, setRelatedCaseDraft] = useState("");
  const [relatedCases, setRelatedCases] = useState<RelatedCaseEntry[]>(
    () => (patient.relatedCases ?? []).map((entry) => ({
      patientId: entry.patientId,
      fullName: entry.fullName,
      dateOfLoss: entry.dateOfLoss,
    })),
  );
  const [selectedRelatedPatientId, setSelectedRelatedPatientId] = useState<string | null>(null);
  const [relatedCaseMessage, setRelatedCaseMessage] = useState("");
  const [showRelatedCaseSuggestions, setShowRelatedCaseSuggestions] = useState(false);
  const [relatedCaseNavigateTarget, setRelatedCaseNavigateTarget] = useState<RelatedCaseEntry | null>(null);
  const [relatedCaseNavigateAnchor, setRelatedCaseNavigateAnchor] = useState<PopupAnchor | null>(null);

  const [dischargeDate, setDischargeDate] = useState(toUsDate(patient.matrix?.discharge ?? ""));
  const [rbSentDate, setRbSentDate] = useState(toUsDate(patient.matrix?.rbSent ?? ""));
  const [billedAmount, setBilledAmount] = useState(() => {
    if (patientBillingRecord) {
      return patientBillingRecord.billedAmount.toString();
    }
    return (patient.matrix?.billed ?? "").toString().replace(/[^0-9.]/g, "");
  });
  const [paidDate, setPaidDate] = useState(() =>
    toUsDate(patientBillingRecord?.paidDate ?? patient.matrix?.paidDate ?? ""),
  );
  const [paidAmount, setPaidAmount] = useState(() => {
    if (patientBillingRecord) {
      return patientBillingRecord.paidAmount.toString();
    }
    return (patient.matrix?.paidAmount ?? "").toString().replace(/[^0-9.]/g, "");
  });
  const [reviewStatus, setReviewStatus] = useState(patient.matrix?.review || "Not Requested");
  const [diagnosisMacroIdDraft, setDiagnosisMacroIdDraft] = useState("");
  const [diagnosisBundleIdDraft, setDiagnosisBundleIdDraft] = useState("");
  const [customDiagnosisCodeDraft, setCustomDiagnosisCodeDraft] = useState("");
  const [customDiagnosisDescriptionDraft, setCustomDiagnosisDescriptionDraft] = useState("");
  const [diagnosisMessage, setDiagnosisMessage] = useState("");
  const [letterTemplateIdDraft, setLetterTemplateIdDraft] = useState("");
  const [letterMessage, setLetterMessage] = useState("");
  const [narrativeTemplateIdDraft, setNarrativeTemplateIdDraft] = useState("");
  const [narrativeMessage, setNarrativeMessage] = useState("");
  const [narrativePromptValues, setNarrativePromptValues] = useState<Record<string, string>>({});
  const [narrativePromptTemplateId, setNarrativePromptTemplateId] = useState<string | null>(null);
  const [showNarrativePromptModal, setShowNarrativePromptModal] = useState(false);
  const [narrativePromptError, setNarrativePromptError] = useState("");
  const [narrativePreview, setNarrativePreview] = useState<NarrativePreviewState | null>(null);
  const [showNarrativePreviewModal, setShowNarrativePreviewModal] = useState(false);
  const [narrativeAttachedEncounterIds, setNarrativeAttachedEncounterIds] = useState<Set<string>>(new Set());
  const [narrativeAttachBilling, setNarrativeAttachBilling] = useState(false);
  const [encounterMessage, setEncounterMessage] = useState("");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState<string | null>(null);
  const [quickTimeEditId, setQuickTimeEditId] = useState<string | null>(null);
  const [quickTimeDraft, setQuickTimeDraft] = useState("");
  const [quickDateEditId, setQuickDateEditId] = useState<string | null>(null);
  const [quickDateDraft, setQuickDateDraft] = useState("");
  const [quickTypeEditId, setQuickTypeEditId] = useState<string | null>(null);
  const [editAppointmentId, setEditAppointmentId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");

  // Delete patient state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePasswordInput, setDeletePasswordInput] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const [activeRegionModal, setActiveRegionModal] = useState<ImagingMode | null>(null);
  const [showDiagnosisModal, setShowDiagnosisModal] = useState(false);
  const [diagnosisModalAnchor, setDiagnosisModalAnchor] = useState<PopupAnchor | null>(null);
  const [diagnosisModalTab, setDiagnosisModalTab] = useState<"codes" | "bundles" | "custom">("codes");
  const [diagnosisSearchDraft, setDiagnosisSearchDraft] = useState("");
  const [diagnosisFolderFilter, setDiagnosisFolderFilter] = useState("all");
  const [diagnosisListSearch, setDiagnosisListSearch] = useState("");
  const [dxDragIndex, setDxDragIndex] = useState<number | null>(null);
  const [dxDragOverIndex, setDxDragOverIndex] = useState<number | null>(null);
  const dxTouchStartY = useRef<number | null>(null);
  const dxTouchRowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const caseNumber = useMemo(
    () => buildCaseNumber(dateOfLoss, lastName, firstName),
    [dateOfLoss, firstName, lastName],
  );
  const mriStudyLabel = mri.isCt ? "CT" : "MRI";
  const toggleImagingPanel = (panel: ImagingPanelKey) => {
    setImagingPanelsOpen((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };
  const toggleSectionPanel = (panel: SectionPanelKey) => {
    setSectionPanelsOpen((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };
  // ── Patient Files state ────────────────────────────────────────────────
  const [fileManagerState, setFileManagerState] = useState<FileManagerState>(() => {
    const loaded = loadFileManagerState();
    const synced = syncPatientFolders(loaded, allPatients, caseStatuses);
    // Persist the synced state so orphan-folder recovery (ID migration,
    // reparenting, etc.) sticks across page navigations.
    if (synced.folders.length !== loaded.folders.length ||
        synced.folders.some((sf) => {
          const lf = loaded.folders.find((l) => l.id === sf.id);
          return !lf || lf.name !== sf.name || lf.parentId !== sf.parentId || lf.patientId !== sf.patientId || !!lf.deleted !== !!sf.deleted;
        }) ||
        synced.files.some((sf) => {
          const lf = loaded.files.find((l) => l.id === sf.id);
          return !lf || lf.folderId !== sf.folderId || !!lf.deleted !== !!sf.deleted;
        })) {
      saveFileManagerState(synced);
    }
    return synced;
  });
  // Look up the patient's folder by its patientId field instead of
  // constructing the ID — after orphan-folder recovery the folder ID may
  // not follow the SYSTEM-PATIENT-<id> pattern.
  const patientFolderId = useMemo(() => {
    const folder = fileManagerState.folders.find(
      (f) => f.patientId === patient.id && f.isSystemFolder && !f.deleted,
    );
    return folder?.id ?? `SYSTEM-PATIENT-${patient.id}`;
  }, [fileManagerState.folders, patient.id]);

  // Collect all files in the patient folder + any subfolders
  const patientFiles = useMemo(() => {
    const collectFiles = (folderId: string): FileRecord[] => {
      const files = getFilesInFolder(fileManagerState, folderId);
      const subFolders = getFoldersInParent(fileManagerState, folderId);
      for (const sub of subFolders) {
        files.push(...collectFiles(sub.id));
      }
      return files;
    };
    return collectFiles(patientFolderId).sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
  }, [fileManagerState, patientFolderId]);

  const narrativeEditableRef = useRef<HTMLDivElement | null>(null);
  const narrativePrintingRef = useRef(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);

  const handlePatientFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setFileUploading(true);
      for (const file of Array.from(files)) {
        const { storagePath, error } = await uploadFileToStorage(patientFolderId, file);
        if (!error && storagePath) {
          setFileManagerState((current) => {
            const next = addFileRecord(current, {
              folderId: patientFolderId,
              name: file.name,
              storagePath,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            });
            saveFileManagerState(next);
            return next;
          });
        }
      }
      setFileUploading(false);

    },
    [patientFolderId],
  );

  const handlePatientFileDelete = useCallback(
    async (file: FileRecord) => {
      if (
        !window.confirm(
          `Permanently delete "${file.name}"?\n\nThis file will be removed from the cloud forever and cannot be recovered.`,
        )
      ) {
        return;
      }
      setFileManagerState((current) => {
        const result = removeFileRecord(current, file.id);
        saveFileManagerState(result.state);
        return result.state;
      });
      await deleteFileFromStorage(file.storagePath);
    },
    [],
  );

  const handlePatientFilePreview = useCallback(async (file: FileRecord) => {
    const { url, error } = await getSignedUrl(file.storagePath);
    if (!error && url) {
      window.open(url, "_blank");
    }
  }, []);

  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRenameFile = useCallback((file: FileRecord) => {
    setRenamingFileId(file.id);
    setRenameDraft(file.name);
  }, []);

  const commitRenameFile = useCallback(() => {
    const trimmed = renameDraft.trim();
    if (!renamingFileId || !trimmed) {
      setRenamingFileId(null);
      return;
    }
    setFileManagerState((current) => {
      const next = renameFileRecord(current, renamingFileId, trimmed);
      saveFileManagerState(next);
      return next;
    });
    setRenamingFileId(null);
  }, [renamingFileId, renameDraft]);

  const [emailingFileId, setEmailingFileId] = useState<string | null>(null);
  const [emailToast, setEmailToast] = useState("");

  const handleEmailPatientFile = useCallback(async (file: FileRecord) => {
    setEmailingFileId(file.id);
    try {
      const settings = loadEmailSettings();
      const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
      const [ptLastName = "", ptFirstName = ""] = patient.fullName.split(",").map((s) => s.trim());
      const ctx: Record<string, string> = {
        FILE_NAME: file.name,
        TODAY: today,
        OFFICE_NAME: loadOfficeSettings().officeName || "",
        FIRST_NAME: ptFirstName,
        LAST_NAME: ptLastName,
        FULL_NAME: `${ptFirstName} ${ptLastName}`.trim(),
        DOB: toUsDate(patient.dob ?? ""),
        INJURY_DATE: toUsDate(patient.dateOfLoss ?? ""),
      };
      const subject = encodeURIComponent(renderEmailTemplate(settings.subjectTemplate, ctx));
      const body = encodeURIComponent(renderEmailTemplate(settings.bodyTemplate, ctx));

      await downloadFile(file.storagePath, file.name);

      setEmailToast(`"${file.name}" downloaded — check your Downloads folder to attach it.`);
      setTimeout(() => setEmailToast(""), 6000);

      setTimeout(() => {
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      }, 600);
    } finally {
      setTimeout(() => setEmailingFileId(null), 1500);
    }
  }, [patient]);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const [sharingFileId, setSharingFileId] = useState<string | null>(null);

  const handleSharePatientFile = useCallback(async (file: FileRecord) => {
    setSharingFileId(file.id);
    try {
      const { url, error } = await getSignedUrl(file.storagePath);
      if (error || !url) return;
      const response = await fetch(url);
      const blob = await response.blob();
      const shareFile = new File([blob], file.name, { type: file.mimeType });
      const shareData: ShareData = { title: file.name, files: [shareFile] };
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.share({ title: file.name, text: `File: ${file.name}`, url });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      setSharingFileId(null);
    }
  }, []);


  const availableImagingRegions = useMemo(() => {
    if (!activeRegionModal) {
      return [];
    }
    return imagingRegions.filter((entry) => entry.modalities.includes(activeRegionModal));
  }, [activeRegionModal]);
  const xrayFindingsForTemplates = useMemo(() => {
    const perReferral = xrayReferrals
      .filter((r) => r.findings?.trim())
      .map((r) => {
        const regionLabel = formatImagingRegionsSummary(r, "xray");
        return `${r.modalityLabel} (${r.sentDate}) — ${regionLabel}\n${r.findings!.trim()}`;
      })
      .join("\n\n");
    if (perReferral) return perReferral;
    // Fallback to old global field if it has content
    const legacy = xrayFindings.trim();
    if (legacy) return legacy;
    return "-";
  }, [xrayReferrals, xrayFindings]);
  const mriCtFindingsForTemplates = useMemo(() => {
    const perReferral = mriReferrals
      .filter((r) => r.findings?.trim())
      .map((r) => {
        const regionLabel = formatImagingRegionsSummary(r, "mri");
        return `${r.modalityLabel} (${r.sentDate}) — ${regionLabel}\n${r.findings!.trim()}`;
      })
      .join("\n\n");
    if (perReferral) return perReferral;
    const legacy = mriCtFindings.trim();
    if (legacy) return legacy;
    return "-";
  }, [mriReferrals, mriCtFindings]);
  const specialistRecommendationsForTemplates = useMemo(() => {
    const perSpec = specialistReferrals
      .filter((s) => s.recommendations?.trim())
      .map((s) => `${s.specialist}: ${s.recommendations!.trim()}`)
      .join("\n\n");
    if (perSpec) return perSpec;
    const legacy = specialistRecommendations.trim();
    return legacy || "-";
  }, [specialistReferrals, specialistRecommendations]);

  const statusConfig = caseStatuses.find(
    (statusConfigEntry) => statusConfigEntry.name.toLowerCase() === caseStatus.toLowerCase(),
  );
  const statusColor = statusConfig?.color ?? "#0d79bf";
  const patientFollowUpOverride = getPatientFollowUpOverride(patient.id);
  const xrayFollowUpOverride = patientFollowUpOverride.xray;
  const mriCtFollowUpOverride = patientFollowUpOverride.mriCt;
  const specialistFollowUpOverride = patientFollowUpOverride.specialist;
  const resolvedLienStatus = lienStatus.trim() ? lienStatus : lienOptions[0] || "Not Set";
  const lienSelectOptions = useMemo(() => {
    const normalizedCurrent = resolvedLienStatus.trim().toLowerCase();
    const hasCurrentOption = lienOptions.some(
      (option) => option.trim().toLowerCase() === normalizedCurrent,
    );
    if (hasCurrentOption) {
      return lienOptions;
    }
    return [resolvedLienStatus, ...lienOptions];
  }, [lienOptions, resolvedLienStatus]);

  const activeImaging = activeRegionModal === "xray" ? xray : mri;
  const setActiveImaging = activeRegionModal === "xray" ? setXray : setMri;
  const activeDiagnosisMacros = useMemo(
    () => billingMacros.diagnoses.filter((entry) => entry.active),
    [billingMacros.diagnoses],
  );
  const activeDiagnosisBundles = useMemo(
    () => billingMacros.bundles.filter((entry) => entry.active),
    [billingMacros.bundles],
  );
  const diagnosisById = useMemo(
    () => new Map(billingMacros.diagnoses.map((entry) => [entry.id, entry] as const)),
    [billingMacros.diagnoses],
  );
  const diagnosisFolderById = useMemo(
    () => new Map(billingMacros.diagnosisFolders.map((entry) => [entry.id, entry] as const)),
    [billingMacros.diagnosisFolders],
  );
  const diagnosisMacrosByFolder = useMemo(() => {
    type Group = { id: string; name: string; macros: typeof activeDiagnosisMacros };
    const groups: Group[] = billingMacros.diagnosisFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      macros: activeDiagnosisMacros
        .filter((m) => m.folderId === folder.id)
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));
    const knownFolderIds = new Set(billingMacros.diagnosisFolders.map((f) => f.id));
    const orphans = activeDiagnosisMacros
      .filter((m) => !knownFolderIds.has(m.folderId))
      .sort((a, b) => a.code.localeCompare(b.code));
    if (orphans.length) {
      groups.push({ id: "__uncategorized__", name: "Uncategorized", macros: orphans });
    }
    return groups.filter((g) => g.macros.length > 0);
  }, [activeDiagnosisMacros, billingMacros.diagnosisFolders]);

  const filteredDiagnosisMacros = useMemo(() => {
    const q = diagnosisSearchDraft.trim().toLowerCase();
    const qWords = q.replace(/[,.:;]/g, " ").split(/\s+/).filter(Boolean);
    return activeDiagnosisMacros
      .filter((entry) =>
        diagnosisFolderFilter === "all" ? true : entry.folderId === diagnosisFolderFilter,
      )
      .filter((entry) => {
        if (!qWords.length) {
          return true;
        }
        const haystack = `${entry.code.toLowerCase()} ${entry.description.toLowerCase()}`;
        return qWords.every((word) => haystack.includes(word));
      })
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [activeDiagnosisMacros, diagnosisFolderFilter, diagnosisSearchDraft]);
  const relatedCaseSuggestions = useMemo(() => {
    const usedPatientIds = new Set(relatedCases.map((entry) => entry.patientId));
    const query = relatedCaseDraft.trim().toLowerCase();

    return allPatients
      .filter((entry) => entry.id !== patient.id)
      .filter((entry) => !usedPatientIds.has(entry.id))
      .filter((entry) => {
        if (!query) {
          return true;
        }
        const dateOfInjury = toUsDate(entry.dateOfLoss).toLowerCase();
        return (
          entry.fullName.toLowerCase().includes(query) ||
          entry.dateOfLoss.toLowerCase().includes(query) ||
          dateOfInjury.includes(query)
        );
      })
      .slice(0, 8);
  }, [patient.id, relatedCaseDraft, relatedCases]);
  const patientEncounterRecords = useMemo(
    () =>
      encountersByNewest
        .filter((entry) => entry.patientId === patient.id)
        .sort(
          (left, right) =>
            toSortStampFromUsDate(right.encounterDate) - toSortStampFromUsDate(left.encounterDate),
        ),
    [encountersByNewest, patient.id],
  );
  const openPatientEncounterRecords = useMemo(
    () =>
      patientEncounterRecords.filter((entry) => !entry.signed).sort(
        (left, right) =>
          toSortStampFromUsDate(right.encounterDate) - toSortStampFromUsDate(left.encounterDate),
      ),
    [patientEncounterRecords],
  );
  const patientAppointmentRecords = useMemo(() => {
    const patientNameLookup = buildPatientNameLookupSet(patient.fullName, firstName, lastName);
    return scheduleAppointments
      .filter((entry) => {
        // Hard rule first: if the appointment has a patientId, that's the
        // source of truth — match by id exactly. The old code OR'd a
        // name-based fallback on top of this, which cross-contaminated
        // two patients who happened to share a name (e.g. two "John Smith"
        // records from two separate accidents). Appointments from case A
        // would then bleed into case B's appointments table.
        if (entry.patientId) return entry.patientId === patient.id;
        // Only fall back to name-matching when the appointment has no
        // patientId at all — that's the legacy-data shape from before
        // every appointment row carried an id. Same-name collision is
        // still possible here but only for the legacy subset, and the
        // user can fix those by re-assigning the appointment to the
        // right patient from the schedule page.
        return patientNameLookup.has(normalizeNameForLookup(entry.patientName));
      })
      .sort((left, right) => {
        const byDate = right.date.localeCompare(left.date);
        if (byDate !== 0) {
          return byDate;
        }
        return right.startTime.localeCompare(left.startTime);
      });
  }, [firstName, lastName, patient.fullName, patient.id, scheduleAppointments]);
  const appointmentRows = useMemo(
    () => {
      type AppointmentEncounterRow = {
        rowId: string;
        dateLabel: string;
        typeLabel: string;
        statusLabel: string;
        appointment: ScheduleAppointmentRecord | null;
        linkedEncounter: (typeof patientEncounterRecords)[number] | null;
      };
      const rows: AppointmentEncounterRow[] = [];
      const matchedEncounterIds = new Set<string>();
      const encounterByDateType = new Map<string, (typeof patientEncounterRecords)[number]>();
      patientEncounterRecords.forEach((encounter) => {
        const key = `${encounter.encounterDate}|${normalizeLookupValue(encounter.appointmentType)}`;
        if (!encounterByDateType.has(key)) {
          encounterByDateType.set(key, encounter);
        }
      });

      patientAppointmentRecords.forEach((appointment) => {
        const appointmentDate = toUsDate(appointment.date);
        const exactTypeMatch =
          encounterByDateType.get(
            `${appointmentDate}|${normalizeLookupValue(appointment.appointmentType)}`,
          ) ?? null;
        const sameDateMatch =
          exactTypeMatch ??
          patientEncounterRecords.find((entry) => entry.encounterDate === appointmentDate) ??
          null;

        if (sameDateMatch) {
          matchedEncounterIds.add(sameDateMatch.id);
        }

        rows.push({
          rowId: `appointment-encounter-row-${appointment.id}`,
          dateLabel: appointmentDate,
          typeLabel: appointment.appointmentType,
          statusLabel: formatAppointmentStatusLabel(appointment.status),
          appointment,
          linkedEncounter: sameDateMatch,
        });
      });

      patientEncounterRecords.forEach((encounter) => {
        if (matchedEncounterIds.has(encounter.id)) {
          return;
        }
        rows.push({
          rowId: `appointment-encounter-row-encounter-${encounter.id}`,
          dateLabel: encounter.encounterDate,
          typeLabel: encounter.appointmentType || "Encounter",
          statusLabel: encounter.signed ? "Closed (Encounter Only)" : "Open (Encounter Only)",
          appointment: null,
          linkedEncounter: encounter,
        });
      });

      rows.sort((left, right) => {
        const byDate = toSortStampFromUsDate(right.dateLabel) - toSortStampFromUsDate(left.dateLabel);
        if (byDate !== 0) {
          return byDate;
        }
        return left.typeLabel.localeCompare(right.typeLabel);
      });

      return rows;
    },
    [patientAppointmentRecords, patientEncounterRecords],
  );
  const checkedInCount = useMemo(
    () => patientAppointmentRecords.filter((entry) => entry.status === "Check In").length,
    [patientAppointmentRecords],
  );
  const checkedOutCount = useMemo(
    () => patientAppointmentRecords.filter((entry) => entry.status === "Check Out").length,
    [patientAppointmentRecords],
  );
  const checkedInOutCount = checkedInCount + checkedOutCount;
  const canceledCount = useMemo(
    () => patientAppointmentRecords.filter((entry) => entry.status === "Canceled").length,
    [patientAppointmentRecords],
  );
  const closedEncounterCount = useMemo(
    () => patientEncounterRecords.filter((entry) => entry.signed).length,
    [patientEncounterRecords],
  );
  const encounterChargesTotal = useMemo(
    () =>
      patientEncounterRecords.reduce((sum, encounter) => {
        const encounterTotal = encounter.charges.reduce(
          (chargeSum, charge) => chargeSum + charge.unitPrice * charge.units,
          0,
        );
        return sum + encounterTotal;
      }, 0),
    [patientEncounterRecords],
  );
  // Auto-sync billedAmount from encounter charges when charges exist
  const prevChargesTotal = useRef<number | null>(null);
  if (encounterChargesTotal > 0 && encounterChargesTotal !== prevChargesTotal.current) {
    prevChargesTotal.current = encounterChargesTotal;
    setBilledAmount(encounterChargesTotal.toFixed(2));
  }
  const currentBillTotal = Number.parseFloat(billedAmount) || 0;
  // Quick Stats rolls up to THREE consolidated boxes per user request:
  //   1. Appointments — total count + "In · Out · Canceled" breakdown
  //   2. Encounters    — total count + "Open · Closed" breakdown
  //   3. Current Bill  — total encounter charges
  // The per-metric visibility settings are retained for backwards
  // compatibility but no longer render individual cards; if every
  // metric inside a group is toggled off in Settings, the group box
  // is hidden too so the user can still collapse sections if they want.
  const quickStatRows = useMemo(
    () => {
      const appointmentsVisible =
        quickStatsSettings.visibleStats.checkedInOut ||
        quickStatsSettings.visibleStats.canceled ||
        quickStatsSettings.visibleStats.noShow;
      const encountersVisible =
        quickStatsSettings.visibleStats.openEncounters ||
        quickStatsSettings.visibleStats.closedEncounters;

      const rows: Array<{
        key: "appointments" | "encounters" | "currentBill";
        label: string;
        value: string;
        helper?: string;
      }> = [];

      if (appointmentsVisible) {
        const totalAppointments = checkedInOutCount + canceledCount;
        rows.push({
          key: "appointments",
          label: "Appointments",
          value: `${totalAppointments}`,
          helper: `In ${checkedInCount} · Out ${checkedOutCount} · Canceled ${canceledCount}`,
        });
      }
      if (encountersVisible) {
        const openCount = openPatientEncounterRecords.length;
        rows.push({
          key: "encounters",
          label: "Encounters",
          value: `${openCount + closedEncounterCount}`,
          helper: `Open ${openCount} · Closed ${closedEncounterCount}`,
        });
      }
      if (quickStatsSettings.visibleStats.currentBill) {
        rows.push({
          key: "currentBill",
          label: "Current Bill",
          value: formatUsdCurrency(currentBillTotal),
        });
      }
      return rows;
    },
    [
      canceledCount,
      checkedInCount,
      checkedInOutCount,
      checkedOutCount,
      closedEncounterCount,
      currentBillTotal,
      openPatientEncounterRecords.length,
      quickStatsSettings.visibleStats,
    ],
  );

  const matchedAttorneyContact = useMemo(
    () =>
      attorneyContacts.find(
        (contact) => normalizeLookupValue(contact.name) === normalizeLookupValue(attorney),
      ) ?? null,
    [attorney, attorneyContacts],
  );
  const specialistReferralTemplate = useMemo(
    () => {
      const specialistTemplates = documentTemplates.templates.filter(
        (template) => template.scope === "specialistReferral",
      );
      return specialistTemplates.find((template) => template.active) ?? specialistTemplates[0] ?? null;
    },
    [documentTemplates.templates],
  );
  const imagingRequestTemplate = useMemo(
    () => {
      const imagingTemplates = documentTemplates.templates.filter(
        (template) => template.scope === "imagingRequest",
      );
      return imagingTemplates.find((template) => template.active) ?? imagingTemplates[0] ?? null;
    },
    [documentTemplates.templates],
  );
  const letterTemplates = useMemo(
    () => documentTemplates.templates.filter((template) => template.scope === "generalLetter"),
    [documentTemplates.templates],
  );
  const availableLetterTemplates = useMemo(() => {
    const activeTemplates = letterTemplates.filter((template) => template.active);
    return activeTemplates.length ? activeTemplates : letterTemplates;
  }, [letterTemplates]);
  const selectedLetterTemplate = useMemo(() => {
    if (letterTemplateIdDraft) {
      const matched = availableLetterTemplates.find((template) => template.id === letterTemplateIdDraft);
      if (matched) {
        return matched;
      }
    }
    return availableLetterTemplates[0] ?? null;
  }, [availableLetterTemplates, letterTemplateIdDraft]);
  const availableNarrativeTemplates = useMemo(() => {
    const activeTemplates = reportTemplates.templates.filter((template) => template.active);
    return activeTemplates.length ? activeTemplates : reportTemplates.templates;
  }, [reportTemplates.templates]);
  const selectedNarrativeTemplate = useMemo(() => {
    if (narrativeTemplateIdDraft) {
      const matched = availableNarrativeTemplates.find((template) => template.id === narrativeTemplateIdDraft);
      if (matched) {
        return matched;
      }
    }
    return availableNarrativeTemplates[0] ?? null;
  }, [availableNarrativeTemplates, narrativeTemplateIdDraft]);
  const narrativePromptTemplate = useMemo(() => {
    if (!narrativePromptTemplateId) {
      return null;
    }
    return reportTemplates.templates.find((template) => template.id === narrativePromptTemplateId) ?? null;
  }, [narrativePromptTemplateId, reportTemplates.templates]);
  const attorneyPhone = matchedAttorneyContact?.phone ?? "";

  const openTemplateSettings = (scope: DocumentTemplateScope) => {
    router.push(`/settings?section=documents&scope=${scope}`);
  };

  const closeQuickTaskModal = () => {
    setShowQuickTaskModal(false);
    setQuickTaskAnchor(null);
    setQuickTaskModalMessage("");
  };

  const openQuickTaskModal = (event?: MouseEvent<HTMLElement>) => {
    const defaultTitle = caseNumber
      ? `Follow up: ${patient.fullName} (${caseNumber})`
      : `Follow up: ${patient.fullName}`;
    setQuickTaskTitle(defaultTitle);
    setQuickTaskPriority("Medium");
    setQuickTaskDueDate("");
    setQuickTaskModalMessage("");
    setQuickTaskStatusMessage("");
    setQuickTaskAnchor(
      event ? getPopupAnchorFromEvent(event) : getPopupAnchorFromElement(quickTaskButtonRef.current),
    );
    setShowQuickTaskModal(true);
  };

  const saveQuickTask = () => {
    const dueDateIso = quickTaskDueDate.trim() ? toIsoDateFromUsDate(quickTaskDueDate) : "";
    if (quickTaskDueDate.trim() && !dueDateIso) {
      setQuickTaskModalMessage("Enter due date as MM/DD/YYYY.");
      return;
    }
    const result = addTask({
      title: quickTaskTitle,
      priority: quickTaskPriority,
      dueDate: dueDateIso,
      patientId: patient.id,
      patientName: patient.fullName,
    });
    if (!result.added) {
      setQuickTaskModalMessage(result.reason);
      return;
    }
    setQuickTaskStatusMessage("To-Do added.");
    closeQuickTaskModal();
  };

  const openReportTemplateSettings = () => {
    router.push("/settings?section=reports");
  };

  const getCommonDocumentContext = (): Record<string, string> => {
    const patientFullName = `${firstName} ${lastName}`.trim();
    return {
      TODAY_DATE: getTodayUsDate(),
      OFFICE_NAME: officeSettings.officeName,
      OFFICE_ADDRESS: officeSettings.address,
      OFFICE_PHONE: officeSettings.phone,
      OFFICE_FAX: officeSettings.fax,
      OFFICE_EMAIL: officeSettings.email,
      DOCTOR_NAME: officeSettings.doctorName,
      PATIENT_FULL_NAME: patientFullName,
      PATIENT_FIRST_NAME: firstName,
      PATIENT_LAST_NAME: lastName,
      PATIENT_DOB: toUsDate(patientDob),
      DATE_OF_INJURY: toUsDate(dateOfLoss),
      PATIENT_PHONE: patientPhone,
      PATIENT_EMAIL: patientEmail,
      CASE_NUMBER: caseNumber,
      ATTORNEY_NAME: attorney,
      ATTORNEY_PHONE: matchedAttorneyContact?.phone ?? "",
      ATTORNEY_FAX: matchedAttorneyContact?.fax ?? "",
      ATTORNEY_EMAIL: matchedAttorneyContact?.email ?? "",
      ATTORNEY_ADDRESS: matchedAttorneyContact?.address ?? "",
      SPECIALIST_NAME: "",
      SPECIALIST_PHONE: "",
      SPECIALIST_FAX: "",
      SPECIALIST_EMAIL: "",
      SPECIALIST_ADDRESS: "",
      REFERRAL_SENT_DATE: "",
      REFERRAL_SCHEDULED_DATE: "",
      IMAGING_TYPE: "",
      IMAGING_CENTER: "",
      IMAGING_PHONE: "",
      IMAGING_FAX: "",
      IMAGING_EMAIL: "",
      IMAGING_ADDRESS: "",
      IMAGING_REGIONS: "",
      IMAGING_SENT_DATE: "",
      IMAGING_DONE_DATE: "",
      IMAGING_REPORT_RECEIVED_DATE: "",
      IMAGING_REPORT_REVIEWED_DATE: "",
      XRAY_FINDINGS: xrayFindingsForTemplates,
      MRI_CT_FINDINGS: mriCtFindingsForTemplates,
      SPECIALIST_RECOMMENDATIONS: specialistRecommendationsForTemplates,
    };
  };

  const handleAttorneyChange = (nextValue: string) => {
    setAttorney(nextValue);
    setAttorneyModalError("");
    if (showAddAttorneyPrompt || showAddAttorneyForm) {
      setShowAddAttorneyPrompt(false);
      setShowAddAttorneyForm(false);
      setAttorneyPromptAnchor(null);
      setAttorneyFormAnchor(null);
    }
  };

  const handleAttorneyBlur = () => {
    const trimmed = attorney.trim();
    if (!trimmed) {
      return;
    }
    if (normalizeLookupValue(trimmed) === "self") {
      return;
    }
    if (matchedAttorneyContact) {
      return;
    }
    const isDismissed = dismissedAttorneyDrafts.some(
      (entry) => normalizeLookupValue(entry) === normalizeLookupValue(trimmed),
    );
    if (isDismissed) {
      return;
    }
    setNewAttorneyDraft({
      name: trimmed,
      phone: "",
      fax: "",
      email: "",
      address: "",
    });
    setAttorneyPromptAnchor(getPopupAnchorFromElement(attorneyInputRef.current));
    setShowAddAttorneyPrompt(true);
  };

  const openAttorneyForm = (event?: MouseEvent<HTMLElement>) => {
    setAttorneyModalError("");
    setShowAddAttorneyPrompt(false);
    setAttorneyPromptAnchor(null);
    setAttorneyFormAnchor(event ? getPopupAnchorFromEvent(event) : attorneyPromptAnchor);
    setShowAddAttorneyForm(true);
  };

  const dismissAttorneyPrompt = () => {
    const trimmed = attorney.trim();
    if (trimmed) {
      setDismissedAttorneyDrafts((current) =>
        current.some((entry) => normalizeLookupValue(entry) === normalizeLookupValue(trimmed))
          ? current
          : [...current, trimmed],
      );
    }
    setShowAddAttorneyPrompt(false);
    setAttorneyPromptAnchor(null);
  };

  const saveAttorneyContact = () => {
    const result = addContact({
      name: newAttorneyDraft.name,
      category: "Attorney",
      phone: newAttorneyDraft.phone,
      fax: newAttorneyDraft.fax,
      email: newAttorneyDraft.email,
      address: newAttorneyDraft.address,
    });

    if (!result.added) {
      if (result.contact) {
        setAttorney(result.contact.name);
        setShowAddAttorneyForm(false);
        setAttorneyFormAnchor(null);
        return;
      }
      setAttorneyModalError(result.reason ?? "Could not add attorney contact.");
      return;
    }

    setAttorney(result.contact.name);
    setDismissedAttorneyDrafts((current) =>
      current.filter(
        (entry) => normalizeLookupValue(entry) !== normalizeLookupValue(result.contact.name),
      ),
    );
    setShowAddAttorneyForm(false);
    setAttorneyFormAnchor(null);
    setAttorneyModalError("");
  };

  const clearImagingDraft = (mode: ImagingMode) => {
    if (mode === "xray") {
      setXray(emptyImagingFormState("xray"));
      return;
    }
    setMri(emptyImagingFormState("mri"));
  };

  const saveImagingReferral = (mode: ImagingMode) => {
    const draft = mode === "xray" ? xray : mri;
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;
    const editingId = mode === "xray" ? editingXrayReferralId : editingMriReferralId;
    const setEditingId = mode === "xray" ? setEditingXrayReferralId : setEditingMriReferralId;
    const setReferrals = mode === "xray" ? setXrayReferrals : setMriReferrals;
    const currentReferrals = mode === "xray" ? xrayReferrals : mriReferrals;
    const label = mode === "xray" ? "X-Ray" : draft.isCt ? "CT" : "MRI";

    if (!draft.sentDate.trim()) {
      setMessage("Sent Date is required.");
      return;
    }
    if (!draft.center.trim()) {
      setMessage("Imaging Center is required.");
      return;
    }
    if (!draft.regions.length) {
      setMessage("Select at least one region.");
      return;
    }

    const nextEntry: ImagingReferral = {
      id: editingId ?? `${mode}-${Date.now()}`,
      modalityLabel: label,
      ...cloneImagingFormState(draft),
    };

    const nextReferrals = !editingId
      ? [...currentReferrals, nextEntry]
      : currentReferrals.map((entry) => (entry.id === editingId ? nextEntry : entry));

    // Update React state
    setReferrals(nextReferrals);

    // Persist immediately to localStorage
    const sentDateIso = toIsoDateFromUsDate(nextEntry.sentDate);
    const scheduledDateIso = toIsoDateFromUsDate(nextEntry.scheduledDate ?? "");
    const doneDateIso = toIsoDateFromUsDate(nextEntry.doneDate ?? "");
    const receivedDateIso = toIsoDateFromUsDate(nextEntry.reportReceivedDate ?? "");
    const reviewedDateIso = toIsoDateFromUsDate(nextEntry.reportReviewedDate ?? "");

    const referralKey = mode === "xray" ? "xrayReferrals" : "mriReferrals";
    const matrixFields =
      mode === "xray"
        ? { xraySent: sentDateIso, xrayDone: doneDateIso, xrayReceived: receivedDateIso, xrayReviewed: reviewedDateIso }
        : { mriSent: sentDateIso, mriScheduled: scheduledDateIso, mriDone: doneDateIso, mriReceived: receivedDateIso, mriReviewed: reviewedDateIso };

    updatePatientRecordById(patient.id, {
      lastUpdate: new Date().toISOString().slice(0, 10),
      [referralKey]: nextReferrals,
      matrix: matrixFields,
    } as UpdatePatientRecordPatch);

    setMessage(editingId ? `${label} sent entry updated.` : `${label} sent entry added. Use Edit to update dates & findings.`);
    setEditingId(null);
    clearImagingDraft(mode);

    // Contact gap check: if this imaging center isn't already a contact,
    // offer to add it. Only on NEW entries (not edits) so repeatedly editing
    // an existing referral doesn't pester the user every save.
    if (!editingId) {
      const centerName = nextEntry.center.trim();
      const found = findContactByName(contacts, centerName, "Imaging Center");
      if (!found) {
        setContactGap({
          name: centerName,
          categoryHint: "Imaging Center",
          message: `"${centerName}" isn't in your Contacts yet — add them now?`,
        });
      }
    }
  };

  const editImagingReferral = (mode: ImagingMode, referralId: string) => {
    const referrals = mode === "xray" ? xrayReferrals : mriReferrals;
    const setDraft = mode === "xray" ? setXray : setMri;
    const setEditingId = mode === "xray" ? setEditingXrayReferralId : setEditingMriReferralId;
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;
    const entry = referrals.find((item) => item.id === referralId);
    if (!entry) {
      return;
    }
    setDraft(cloneImagingFormState(entry));
    setEditingId(referralId);
    setMessage(`Editing ${entry.modalityLabel} entry from ${entry.sentDate}.`);
    setImagingPanelsOpen((current) => ({ ...current, [mode]: true }));
  };

  const cancelImagingReferralEdit = (mode: ImagingMode) => {
    const setEditingId = mode === "xray" ? setEditingXrayReferralId : setEditingMriReferralId;
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;
    clearImagingDraft(mode);
    setEditingId(null);
    setMessage("");
  };

  const openImagingEditor = (mode: ImagingMode, entry: ImagingReferral, event?: MouseEvent<HTMLElement>) => {
    setEditingImagingReferral({ ...entry, mode });
    setImagingEditorAnchor(event ? getPopupAnchorFromEvent(event) : null);
  };

  const saveImagingEditor = () => {
    if (!editingImagingReferral) return;
    const { mode, ...referral } = editingImagingReferral;
    const setReferrals = mode === "xray" ? setXrayReferrals : setMriReferrals;
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;

    setReferrals((current) =>
      current.map((entry) => (entry.id === referral.id ? referral : entry)),
    );

    // Persist immediately
    const currentReferrals = mode === "xray" ? xrayReferrals : mriReferrals;
    const nextReferrals = currentReferrals.map((entry) => (entry.id === referral.id ? referral : entry));
    const referralKey = mode === "xray" ? "xrayReferrals" : "mriReferrals";
    const sentDateIso = toIsoDateFromUsDate(referral.sentDate);
    const scheduledDateIso = toIsoDateFromUsDate(referral.scheduledDate ?? "");
    const doneDateIso = toIsoDateFromUsDate(referral.doneDate ?? "");
    const receivedDateIso = toIsoDateFromUsDate(referral.reportReceivedDate ?? "");
    const reviewedDateIso = toIsoDateFromUsDate(referral.reportReviewedDate ?? "");
    const matrixFields =
      mode === "xray"
        ? { xraySent: sentDateIso, xrayDone: doneDateIso, xrayReceived: receivedDateIso, xrayReviewed: reviewedDateIso }
        : { mriSent: sentDateIso, mriScheduled: scheduledDateIso, mriDone: doneDateIso, mriReceived: receivedDateIso, mriReviewed: reviewedDateIso };
    updatePatientRecordById(patient.id, {
      lastUpdate: new Date().toISOString().slice(0, 10),
      [referralKey]: nextReferrals,
      matrix: matrixFields,
    } as UpdatePatientRecordPatch);

    setMessage(`${referral.modalityLabel} entry updated.`);
    setEditingImagingReferral(null);
    setImagingEditorAnchor(null);
  };

  const removeImagingReferral = (mode: ImagingMode, referralId: string) => {
    const setReferrals = mode === "xray" ? setXrayReferrals : setMriReferrals;
    const currentReferrals = mode === "xray" ? xrayReferrals : mriReferrals;
    const setEditingId = mode === "xray" ? setEditingXrayReferralId : setEditingMriReferralId;
    const editingId = mode === "xray" ? editingXrayReferralId : editingMriReferralId;
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;

    const nextReferrals = currentReferrals.filter((entry) => entry.id !== referralId);

    // Update React state
    setReferrals(nextReferrals);

    // Persist immediately to localStorage
    const key = mode === "xray" ? "xrayReferrals" : "mriReferrals";
    updatePatientRecordById(patient.id, {
      lastUpdate: new Date().toISOString().slice(0, 10),
      [key]: nextReferrals,
    } as UpdatePatientRecordPatch);

    if (editingId === referralId) {
      setEditingId(null);
      clearImagingDraft(mode);
    }
    setMessage("Sent entry removed.");
  };

  const addSpecialist = () => {
    const specialistName = specialistDraft.specialist.trim();
    if (!specialistName || !specialistDraft.sentDate.trim()) {
      setSpecialistMessage("Specialist and Sent Date are required.");
      return;
    }
    const newItem: SpecialistReferral = {
      id: `sp-${Date.now()}`,
      specialist: specialistName,
      sentDate: specialistDraft.sentDate,
      scheduledDate: "",
      completedDate: "",
      reportReceivedDate: "",
      reportReviewedDate: "",
      recommendations: "",
    };
    setSpecialistReferrals((current) => [...current, newItem]);
    setSpecialistDraft({
      specialist: "",
      sentDate: "",
    });
    setSpecialistMessage(`${specialistName} added. Use Edit to update scheduling/report status.`);
    // Contact gap check: if this specialist isn't already in contacts, offer to add them.
    const found = findContactByName(contacts, specialistName);
    if (!found) {
      setContactGap({
        name: specialistName,
        categoryHint: "Specialist",
        message: `"${specialistName}" isn't in your Contacts yet — add them now?`,
      });
    }
  };

  const openSpecialistEditor = (entry: SpecialistReferral, event?: MouseEvent<HTMLElement>) => {
    setEditingSpecialist({ ...entry });
    setSpecialistEditorAnchor(event ? getPopupAnchorFromEvent(event) : null);
  };

  const saveSpecialistEditor = () => {
    if (!editingSpecialist) {
      return;
    }
    if (!editingSpecialist.specialist.trim() || !editingSpecialist.sentDate.trim()) {
      setSpecialistMessage("Specialist and Sent Date are required.");
      return;
    }
    setSpecialistReferrals((current) =>
      current.map((entry) => (entry.id === editingSpecialist.id ? editingSpecialist : entry)),
    );
    setSpecialistMessage(`${editingSpecialist.specialist} updated.`);
    setEditingSpecialist(null);
    setSpecialistEditorAnchor(null);
  };

  const removeSpecialist = (id: string) => {
    setSpecialistReferrals((current) => current.filter((entry) => entry.id !== id));
    setSpecialistMessage("Specialist referral removed.");
  };

  const generateSpecialistReferralPdf = (entry: SpecialistReferral) => {
    if (!specialistReferralTemplate) {
      setSpecialistMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("specialistReferral");
      }
      return;
    }

    const specialistContact =
      specialistContactDirectory.find(
        (contact) => normalizeLookupValue(contact.name) === normalizeLookupValue(entry.specialist),
      ) ?? null;

    const context: Record<string, string> = {
      ...getCommonDocumentContext(),
      SPECIALIST_NAME: entry.specialist,
      SPECIALIST_PHONE: specialistContact?.phone ?? "",
      SPECIALIST_FAX: specialistContact?.fax ?? "",
      SPECIALIST_EMAIL: specialistContact?.email ?? "",
      SPECIALIST_ADDRESS: specialistContact?.address ?? "",
      REFERRAL_SENT_DATE: toUsDate(entry.sentDate),
      REFERRAL_SCHEDULED_DATE: toUsDate(entry.scheduledDate),
      REFERRAL_COMPLETED_DATE: toUsDate(entry.completedDate ?? ""),
      REFERRAL_RECEIVED_DATE: toUsDate(entry.reportReceivedDate),
      REFERRAL_REVIEWED_DATE: toUsDate(entry.reportReviewedDate ?? ""),
    };

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context)
      : "";
    const renderedBody = renderDocumentTemplate(specialistReferralTemplate.body, context);
    const docTitle = buildDocumentTitle(caseNumber, lastName, firstName, `${specialistReferralTemplate.name} - ${entry.specialist}`);
    const printableHtml = buildPrintableDocumentHtml({
      title: docTitle,
      headerHtml: renderedHeader,
      bodyHtml: renderedBody,
      headerFontFamily: documentTemplates.header.fontFamily,
      fontFamily: specialistReferralTemplate.fontFamily,
      includeLogo: documentTemplates.header.active
        ? documentTemplates.header.showOfficeLogo
        : specialistReferralTemplate.showOfficeLogo,
      logoDataUrl: officeSettings.logoDataUrl,
    });

    const printStarted = printHtmlWithIframeFallback(printableHtml);
    if (!printStarted) {
      setSpecialistMessage("Could not open print preview. Check popup/browser print settings and try again.");
      return;
    }

    setSpecialistMessage(`Generated ${specialistReferralTemplate.name} for ${entry.specialist}. Use Save as PDF in the print dialog.`);
  };

  const generateImagingRequestPdf = (mode: ImagingMode, entry: ImagingReferral) => {
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;
    if (!imagingRequestTemplate) {
      setMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("imagingRequest");
      }
      return;
    }

    // Look up the imaging center in the contacts directory so the
    // template can pull phone / fax / email / address automatically,
    // mirroring the SPECIALIST_* tokens used on specialist referrals.
    // Case-insensitive match against the stored contact name.
    const imagingCenterContact =
      imagingCenterByName.get(entry.center.trim().toLowerCase()) ?? null;

    const context: Record<string, string> = {
      ...getCommonDocumentContext(),
      IMAGING_TYPE: entry.modalityLabel,
      IMAGING_CENTER: entry.center,
      IMAGING_PHONE: imagingCenterContact?.phone ?? "",
      IMAGING_FAX: imagingCenterContact?.fax ?? "",
      IMAGING_EMAIL: imagingCenterContact?.email ?? "",
      IMAGING_ADDRESS: imagingCenterContact?.address ?? "",
      IMAGING_REGIONS: formatImagingRegionsSummary(entry, mode),
      IMAGING_SENT_DATE: toUsDate(entry.sentDate),
      IMAGING_DONE_DATE: toUsDate(entry.doneDate),
      IMAGING_REPORT_RECEIVED_DATE: toUsDate(entry.reportReceivedDate),
      IMAGING_REPORT_REVIEWED_DATE: toUsDate(entry.reportReviewedDate),
      REFERRAL_SENT_DATE: toUsDate(entry.sentDate),
    };

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context)
      : "";
    const renderedBody = renderDocumentTemplate(imagingRequestTemplate.body, context);
    const imgDocTitle = buildDocumentTitle(caseNumber, lastName, firstName, `${imagingRequestTemplate.name} - ${entry.modalityLabel}`);
    const printableHtml = buildPrintableDocumentHtml({
      title: imgDocTitle,
      headerHtml: renderedHeader,
      bodyHtml: renderedBody,
      headerFontFamily: documentTemplates.header.fontFamily,
      fontFamily: imagingRequestTemplate.fontFamily,
      includeLogo: documentTemplates.header.active
        ? documentTemplates.header.showOfficeLogo
        : imagingRequestTemplate.showOfficeLogo,
      logoDataUrl: officeSettings.logoDataUrl,
    });

    const printStarted = printHtmlWithIframeFallback(printableHtml);
    if (!printStarted) {
      setMessage("Could not open print preview. Check popup/browser print settings and try again.");
      return;
    }

    setMessage(`Generated ${imagingRequestTemplate.name} for ${entry.modalityLabel}. Use Save as PDF in the print dialog.`);
  };

  const generateLetterPdf = () => {
    if (!selectedLetterTemplate) {
      setLetterMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("generalLetter");
      }
      return;
    }

    const context: Record<string, string> = {
      ...getCommonDocumentContext(),
    };

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context)
      : "";
    const renderedBody = renderDocumentTemplate(selectedLetterTemplate.body, context);
    const letterDocTitle = buildDocumentTitle(caseNumber, lastName, firstName, selectedLetterTemplate.name);
    const printableHtml = buildPrintableDocumentHtml({
      title: letterDocTitle,
      headerHtml: renderedHeader,
      bodyHtml: renderedBody,
      headerFontFamily: documentTemplates.header.fontFamily,
      fontFamily: selectedLetterTemplate.fontFamily,
      includeLogo: documentTemplates.header.active
        ? documentTemplates.header.showOfficeLogo
        : selectedLetterTemplate.showOfficeLogo,
      logoDataUrl: officeSettings.logoDataUrl,
    });

    const printStarted = printHtmlWithIframeFallback(printableHtml);
    if (!printStarted) {
      setLetterMessage("Could not open print preview. Check popup/browser print settings and try again.");
      return;
    }

    setLetterMessage(`Generated ${selectedLetterTemplate.name}. Use Save as PDF in the print dialog.`);
  };

  const buildNarrativePreview = (
    template: NonNullable<typeof selectedNarrativeTemplate>,
    promptValues: Record<string, string>,
  ) => {
    const { context, rawHtmlTokens } = buildNarrativeReportContext({
      office: {
        officeName: officeSettings.officeName,
        address: officeSettings.address,
        phone: officeSettings.phone,
        fax: officeSettings.fax,
        email: officeSettings.email,
        doctorName: officeSettings.doctorName,
      },
      patient: {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        dob: patientDob,
        dateOfLoss,
        initialExam,
        phone: patientPhone,
        email: patientEmail,
        caseNumber,
        attorney,
        attorneyPhone: matchedAttorneyContact?.phone ?? "",
        attorneyFax: matchedAttorneyContact?.fax ?? "",
        attorneyEmail: matchedAttorneyContact?.email ?? "",
        attorneyAddress: matchedAttorneyContact?.address ?? "",
        caseStatus,
        lienStatus: resolvedLienStatus,
        priorCare,
        patientNotes,
        xrayFindings: xrayFindingsForTemplates,
        mriCtFindings: mriCtFindingsForTemplates,
        specialistRecommendations: specialistRecommendationsForTemplates,
        mrMrsMsLastName: (() => {
          const sex = patientSex.toLowerCase();
          const marital = maritalStatus.toLowerCase();
          let prefix = "Mx.";
          if (sex === "male") prefix = "Mr.";
          else if (sex === "female") prefix = marital === "married" ? "Mrs." : "Ms.";
          return lastName ? `${prefix} ${lastName}` : prefix;
        })(),
        heShe: patientSex.toLowerCase() === "male" ? "He" : patientSex.toLowerCase() === "female" ? "She" : "They",
        hisHer: patientSex.toLowerCase() === "male" ? "His" : patientSex.toLowerCase() === "female" ? "Her" : "Their",
      },
      additional: {
        dischargeDate,
        rbSentDate,
        paidDate,
        billedAmount: currentBillTotal.toFixed(2),
        paidAmount,
        reviewStatus,
      },
      encounters: patientEncounterRecords,
      diagnoses: patientDiagnoses.map((entry) => ({
        code: entry.code,
        description: entry.description,
      })),
      xrayReferrals: xrayReferrals.map((entry) => ({
        modalityLabel: entry.modalityLabel,
        sentDate: entry.sentDate,
        center: entry.center,
        regions: entry.regions,
        lateralityByRegion: entry.lateralityByRegion,
        flexExtRegions: entry.flexExtRegions,
        doneDate: entry.doneDate,
        reportReceivedDate: entry.reportReceivedDate,
        reportReviewedDate: entry.reportReviewedDate,
        findings: entry.findings,
      })),
      mriReferrals: mriReferrals.map((entry) => ({
        modalityLabel: entry.modalityLabel,
        sentDate: entry.sentDate,
        center: entry.center,
        regions: entry.regions,
        lateralityByRegion: entry.lateralityByRegion,
        flexExtRegions: entry.flexExtRegions,
        scheduledDate: entry.scheduledDate,
        doneDate: entry.doneDate,
        reportReceivedDate: entry.reportReceivedDate,
        reportReviewedDate: entry.reportReviewedDate,
        findings: entry.findings,
      })),
      specialistReferrals: specialistReferrals.map((entry) => ({
        specialist: entry.specialist,
        sentDate: entry.sentDate,
        scheduledDate: entry.scheduledDate,
        completedDate: entry.completedDate,
        reportReceivedDate: entry.reportReceivedDate,
        reportReviewedDate: entry.reportReviewedDate,
        recommendations: entry.recommendations,
      })),
      promptValues,
    });

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context, rawHtmlTokens)
      : "";
    const renderedBody = renderNarrativeReportBody(template.body, context, rawHtmlTokens);
    return {
      title: template.name,
      fontFamily: template.fontFamily,
      headerHtml: renderedHeader,
      bodyHtml: renderedBody,
    };
  };

  const startNarrativeGeneration = () => {
    if (!selectedNarrativeTemplate) {
      setNarrativeMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openReportTemplateSettings();
      }
      return;
    }

    if (selectedNarrativeTemplate.prompts.length) {
      const defaults = selectedNarrativeTemplate.prompts.reduce<Record<string, string>>(
        (accumulator, prompt) => {
          accumulator[prompt.token] = "";
          return accumulator;
        },
        {},
      );
      setNarrativePromptValues(defaults);
      setNarrativePromptTemplateId(selectedNarrativeTemplate.id);
      setNarrativePromptError("");
      setShowNarrativePromptModal(true);
      return;
    }

    const preview = buildNarrativePreview(selectedNarrativeTemplate, {});
    setNarrativePreview(preview);
    setShowNarrativePreviewModal(true);
    setNarrativeMessage(`Generated ${selectedNarrativeTemplate.name} preview. Review and print when ready.`);
  };

  const continueNarrativeGeneration = () => {
    if (!narrativePromptTemplate) {
      setNarrativePromptError("Template not found. Please try again.");
      return;
    }

    const missingPrompt = narrativePromptTemplate.prompts.find(
      (prompt) => prompt.required && !narrativePromptValues[prompt.token]?.trim(),
    );
    if (missingPrompt) {
      setNarrativePromptError(`"${missingPrompt.label}" is required.`);
      return;
    }

    const preview = buildNarrativePreview(narrativePromptTemplate, narrativePromptValues);
    setNarrativePreview(preview);
    setShowNarrativePromptModal(false);
    setShowNarrativePreviewModal(true);
    setNarrativePromptTemplateId(null);
    setNarrativePromptError("");
    setNarrativeMessage(`Generated ${narrativePromptTemplate.name} preview. Review and print when ready.`);
  };

  const closeNarrativePromptModal = () => {
    setShowNarrativePromptModal(false);
    setNarrativePromptTemplateId(null);
    setNarrativePromptError("");
    setNarrativePromptValues({});
  };

  const printNarrativePreview = () => {
    if (!narrativePreview) {
      setNarrativeMessage("Generate a narrative preview first.");
      return;
    }

    const liveHtml = narrativeEditableRef.current?.innerHTML ?? narrativePreview.bodyHtml;

    // Build encounter pages for attached encounters (sorted oldest first)
    const attachedEncounters = patientEncounterRecords
      .filter((entry) => narrativeAttachedEncounterIds.has(entry.id))
      .sort(
        (a, b) =>
          toSortStampFromUsDate(a.encounterDate) - toSortStampFromUsDate(b.encounterDate),
      );

    const encounterPagesHtml = buildSoapPrintHtmlForNarrative({
      officeName: officeSettings.officeName,
      officeAddress: officeSettings.address,
      officePhone: officeSettings.phone,
      officeFax: officeSettings.fax,
      officeEmail: officeSettings.email,
      logoDataUrl: officeSettings.logoDataUrl,
      patientName: `${firstName} ${lastName}`.trim(),
      encounters: attachedEncounters.map((entry) => ({
        encounterDate: entry.encounterDate,
        provider: entry.provider,
        appointmentType: entry.appointmentType,
        signed: entry.signed,
        soap: entry.soap,
      })),
    });

    // Build billing statement if attached
    let billingPagesHtml = "";
    if (narrativeAttachBilling) {
      // Collect all encounter charge lines sorted oldest → newest
      // (matches the Print Bill order in the billing page).
      const allCharges = [...patientEncounterRecords]
        .sort((a, b) => toSortStampFromUsDate(a.encounterDate) - toSortStampFromUsDate(b.encounterDate))
        .flatMap((enc) =>
          enc.charges.map((ch) => ({
            encounterDate: enc.encounterDate,
            procedureCode: ch.procedureCode,
            description: ch.name,
            units: ch.units,
            lineTotal: ch.unitPrice * ch.units,
          })),
        );
      if (allCharges.length > 0) {
        billingPagesHtml = buildBillingStatementHtmlForNarrative({
          officeName: officeSettings.officeName,
          officeAddress: officeSettings.address,
          officePhone: officeSettings.phone,
          officeFax: officeSettings.fax,
          officeEmail: officeSettings.email,
          logoDataUrl: officeSettings.logoDataUrl,
          patientName: `${lastName}, ${firstName}`.trim(),
          patientDob: patientDob,
          patientDoi: dateOfLoss,
          caseNumber,
          attorneyName: attorney,
          attorneyPhone: matchedAttorneyContact?.phone ?? "",
          providerName: officeSettings.doctorName,
          diagnoses: patientDiagnoses.map((d) => ({ code: d.code, description: d.description })),
          charges: allCharges,
          total: allCharges.reduce((sum, c) => sum + c.lineTotal, 0),
        });
      }
    }

    const narrativeDocTitle = buildDocumentTitle(caseNumber, lastName, firstName, narrativePreview.title);
    const printableHtml = buildPrintableDocumentHtml({
      title: narrativeDocTitle,
      headerHtml: "",
      bodyHtml: liveHtml,
      headerFontFamily: documentTemplates.header.fontFamily,
      fontFamily: narrativePreview.fontFamily,
      includeLogo: documentTemplates.header.active
        ? documentTemplates.header.showOfficeLogo
        : true,
      logoDataUrl: officeSettings.logoDataUrl,
      encounterPagesHtml,
      billingPagesHtml,
    });

    narrativePrintingRef.current = true;
    setTimeout(() => { narrativePrintingRef.current = false; }, 2000);
    const printStarted = printHtmlWithIframeFallback(printableHtml);
    if (!printStarted) {
      narrativePrintingRef.current = false;
      setNarrativeMessage("Could not open print preview. Check popup/browser print settings and try again.");
      return;
    }

    const encounterSuffix = attachedEncounters.length > 0
      ? ` with ${attachedEncounters.length} encounter${attachedEncounters.length === 1 ? "" : "s"} attached`
      : "";
    const billingSuffix = narrativeAttachBilling && billingPagesHtml ? " + billing statement" : "";
    setNarrativeMessage(
      `Generated ${narrativePreview.title}${encounterSuffix}${billingSuffix}. Use Save as PDF in the print dialog.`,
    );
  };

  const closeNarrativePreviewModal = () => {
    setShowNarrativePreviewModal(false);
    setNarrativePreview(null);
    setNarrativeAttachedEncounterIds(new Set());
    setNarrativeAttachBilling(false);
  };

  const addReExam = () => {
    if (!reExamDraft) {
      return;
    }
    setReExams((current) => [...current, reExamDraft]);
    setReExamDraft("");
  };

  const removeReExam = (targetIndex: number) => {
    setReExams((current) => current.filter((_, index) => index !== targetIndex));
  };

  const addRelatedCase = () => {
    const targetPatient =
      allPatients.find((entry) => entry.id === selectedRelatedPatientId) ??
      allPatients.find((entry) => entry.fullName.toLowerCase() === relatedCaseDraft.trim().toLowerCase());

    if (!targetPatient) {
      setRelatedCaseMessage("Select a patient from search results.");
      return;
    }
    if (targetPatient.id === patient.id) {
      setRelatedCaseMessage("This patient cannot be related to themself.");
      return;
    }
    if (relatedCases.some((entry) => entry.patientId === targetPatient.id)) {
      setRelatedCaseMessage("This related case is already linked.");
      return;
    }

    const nextRelated = [
      ...relatedCases,
      {
        patientId: targetPatient.id,
        fullName: targetPatient.fullName,
        dateOfLoss: targetPatient.dateOfLoss,
      },
    ];
    setRelatedCases(nextRelated);
    setRelatedCaseDraft("");
    setSelectedRelatedPatientId(null);
    setRelatedCaseMessage("");
    setShowRelatedCaseSuggestions(false);

    // Persist and sync bidirectionally — all group members get linked to each other
    const allRelatedIds = nextRelated.map((entry) => entry.patientId);
    syncRelatedCasesGroup(patient.id, allRelatedIds);
  };

  const removeRelatedCase = (removePatientId: string) => {
    setRelatedCases((current) => current.filter((entry) => entry.patientId !== removePatientId));

    // Persist and remove bidirectionally
    removeFromRelatedCasesGroup(patient.id, removePatientId);
  };

  const openRelatedCaseNavigatePrompt = (entry: RelatedCaseEntry, event?: MouseEvent<HTMLElement>) => {
    setRelatedCaseNavigateTarget(entry);
    setRelatedCaseNavigateAnchor(event ? getPopupAnchorFromEvent(event) : null);
  };

  const closeRelatedCaseNavigatePrompt = () => {
    setRelatedCaseNavigateTarget(null);
    setRelatedCaseNavigateAnchor(null);
  };

  const confirmRelatedCaseNavigation = () => {
    if (!relatedCaseNavigateTarget) {
      return;
    }
    router.push(`/patients/${relatedCaseNavigateTarget.patientId}`);
    closeRelatedCaseNavigatePrompt();
  };

  const openEncounterEditor = (encounterId: string) => {
    router.push(`/encounters?patientId=${patient.id}&encounterId=${encounterId}`);
  };

  const openScheduleModal = () => {
    setShowScheduleModal(true);
  };

  const handleNewAppointmentSaved = (records: ScheduleAppointmentRecord[]) => {
    const first = records[0];
    if (first) {
      const count = records.length;
      setEncounterMessage(
        count > 1
          ? `Scheduled ${count} appointments starting ${toUsDate(first.date)}.`
          : `Appointment scheduled for ${toUsDate(first.date)}.`,
      );
    }
  };

  const handleAppointmentStatusChange = (appointmentId: string, nextStatus: AppointmentStatus) => {
    if (nextStatus === "Reschedule") {
      setRescheduleAppointmentId(appointmentId);
      return;
    }
    const target = scheduleAppointments.find((entry) => entry.id === appointmentId);
    if (target && !isAppointmentStatusSelectable(nextStatus, target.status)) {
      setEncounterMessage(
        `Cannot mark ${nextStatus} — patient must be Checked In first.`,
      );
      return;
    }
    if (target && !confirmStatusChangeIfNeeded(target.status, nextStatus)) return;
    updateAppointment(appointmentId, (current) => ({
      ...current,
      status: nextStatus,
    }));
    setEncounterMessage(`Appointment status updated to ${nextStatus}.`);
  };

  const beginQuickTimeEdit = (appointment: ScheduleAppointmentRecord) => {
    setQuickTimeEditId(appointment.id);
    setQuickTimeDraft(appointment.startTime);
  };

  const cancelQuickTimeEdit = () => {
    setQuickTimeEditId(null);
    setQuickTimeDraft("");
  };

  // ── Quick date / type editors ──
  // Same one-field-at-a-time pattern as quickTimeEdit so a typo or
  // wrong-pick doesn't force the user through the full Edit Appointment
  // modal just to flip one value.
  const beginQuickDateEdit = (appointment: ScheduleAppointmentRecord) => {
    setQuickDateEditId(appointment.id);
    setQuickDateDraft(toUsDate(appointment.date));
  };
  const cancelQuickDateEdit = () => {
    setQuickDateEditId(null);
    setQuickDateDraft("");
  };
  const commitQuickDateEdit = (appointment: ScheduleAppointmentRecord) => {
    const formatted = quickDateDraft.trim();
    const isoCandidate = toIsoDateFromUsDate(formatted);
    if (!isoCandidate || isoCandidate === appointment.date) {
      cancelQuickDateEdit();
      return;
    }
    updateAppointment(appointment.id, (current) => ({
      ...current,
      date: isoCandidate,
    }));
    setEncounterMessage(
      `Date updated to ${formatted} for ${appointment.appointmentType}.`,
    );
    cancelQuickDateEdit();
  };

  const beginQuickTypeEdit = (appointment: ScheduleAppointmentRecord) => {
    setQuickTypeEditId(appointment.id);
  };
  const cancelQuickTypeEdit = () => {
    setQuickTypeEditId(null);
  };
  const commitQuickTypeEdit = (
    appointment: ScheduleAppointmentRecord,
    nextType: string,
  ) => {
    const trimmed = nextType.trim();
    if (!trimmed || trimmed === appointment.appointmentType) {
      cancelQuickTypeEdit();
      return;
    }
    // Pick up the matching type's default duration so a fast switch from
    // (say) "Office Visit / 30m" to "New Patient / 60m" snaps the slot
    // length too. User can still fine-tune via the full edit modal.
    const matchedType = appointmentTypes.find(
      (entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
    );
    updateAppointment(appointment.id, (current) => ({
      ...current,
      appointmentType: trimmed,
      durationMin: matchedType?.durationMin ?? current.durationMin,
    }));
    setEncounterMessage(`Appointment type updated to ${trimmed}.`);
    cancelQuickTypeEdit();
  };

  const handleDeleteAppointment = (appointment: ScheduleAppointmentRecord) => {
    const dateLabel = toUsDate(appointment.date);
    const timeLabel = formatTimeLabel(appointment.startTime);
    // Look for an encounter linked to this appointment by patient + date.
    // Encounters reference appointments via (patientId, encounterDate) so the
    // user can chain delete both in a single confirmation.
    const linkedEncounter = patientEncounterRecords.find(
      (entry) => entry.patientId === appointment.patientId && entry.encounterDate === dateLabel,
    );

    if (linkedEncounter) {
      const chargeCount = linkedEncounter.charges.length;
      const proceed = window.confirm(
        `This appointment has an attached encounter${
          linkedEncounter.signed ? " (CLOSED)" : ""
        } on ${dateLabel}${chargeCount > 0 ? ` with ${chargeCount} charge${chargeCount === 1 ? "" : "s"}` : ""}.\n\n` +
          `Click OK to delete BOTH the appointment AND the encounter (and any attached charges).\n` +
          `Click Cancel to keep everything.`,
      );
      if (!proceed) {
        return;
      }
      deleteEncounter(linkedEncounter.id);
      removeAppointment(appointment.id);
      setEncounterMessage(
        `Appointment on ${dateLabel} at ${timeLabel} and its encounter${
          chargeCount > 0 ? ` (${chargeCount} charge${chargeCount === 1 ? "" : "s"})` : ""
        } deleted.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete the ${appointment.appointmentType} appointment on ${dateLabel} at ${timeLabel}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    removeAppointment(appointment.id);
    setEncounterMessage(`Appointment on ${dateLabel} at ${timeLabel} deleted.`);
  };

  const commitQuickTimeEdit = (appointment: ScheduleAppointmentRecord) => {
    const nextTime = quickTimeDraft.trim();
    if (!nextTime || nextTime === appointment.startTime) {
      cancelQuickTimeEdit();
      return;
    }
    updateAppointment(appointment.id, (current) => ({
      ...current,
      startTime: nextTime,
    }));
    setEncounterMessage(
      `Time updated to ${formatTimeLabel(nextTime)} on ${toUsDate(appointment.date)}.`,
    );
    cancelQuickTimeEdit();
  };

  const rescheduleTargetAppointment = useMemo(
    () =>
      rescheduleAppointmentId
        ? scheduleAppointments.find((entry) => entry.id === rescheduleAppointmentId) ?? null
        : null,
    [rescheduleAppointmentId, scheduleAppointments],
  );

  const editTargetAppointment = useMemo(
    () =>
      editAppointmentId
        ? scheduleAppointments.find((entry) => entry.id === editAppointmentId) ?? null
        : null,
    [editAppointmentId, scheduleAppointments],
  );

  const createEncounterFromAppointment = (appointment: ScheduleAppointmentRecord) => {
    const appointmentDate = toUsDate(appointment.date);
    // Check for existing encounter matching this appointment (by date + type first, then date only)
    const existingByType =
      patientEncounterRecords.find(
        (entry) =>
          entry.encounterDate === appointmentDate &&
          entry.appointmentType.toLowerCase() === appointment.appointmentType.toLowerCase(),
      ) ?? null;
    const existingEncounter =
      existingByType ?? patientEncounterRecords.find((entry) => entry.encounterDate === appointmentDate) ?? null;

    if (existingEncounter) {
      setEncounterMessage(`Opened existing encounter on ${existingEncounter.encounterDate}.`);
      openEncounterEditor(existingEncounter.id);
      return;
    }

    // Guard against accidentally creating an encounter for a future
    // appointment. appointment.date is ISO YYYY-MM-DD; compare against
    // today's local date string so time-zone / clock differences don't
    // block a same-day appointment.
    const todayIso = (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();
    if (appointment.date > todayIso) {
      const proceed = window.confirm(
        `This appointment is on ${appointmentDate}, which is in the future. ` +
          `Are you sure you want to create an encounter now? Click Cancel if you opened the wrong appointment.`,
      );
      if (!proceed) {
        setEncounterMessage("Encounter creation canceled — appointment is in the future.");
        return;
      }
    }

    if (appointment.status !== "Check In" && appointment.status !== "Check Out") {
      setEncounterMessage(
        "Patient must be Checked In before starting an encounter. Update the appointment status first.",
      );
      return;
    }

    const patientDisplayName = `${lastName.trim()}, ${firstName.trim()}`
      .replace(/^,\s*|,\s*$/g, "")
      .trim();
    const newEncounterId = createEncounter({
      patientId: patient.id,
      patientName: patientDisplayName || patient.fullName,
      provider: appointment.provider || officeSettings.doctorName || "Provider",
      appointmentType: appointment.appointmentType || "Personal Injury Office Visit",
      encounterDate: appointmentDate,
    });

    if (!newEncounterId) {
      setEncounterMessage("Could not create encounter. Verify appointment details and try again.");
      return;
    }

    const selectedSections = encounterSections.filter((section) => macroLibrary.saltDefaults.sections[section]);
    if (macroLibrary.saltDefaults.enabled && selectedSections.length > 0) {
      const sourceEncounter =
        patientEncounterRecords.find((entry) =>
          selectedSections.some((section) => entry.soap[section].trim().length > 0),
        ) ?? null;

      if (sourceEncounter) {
        let copiedCount = 0;
        selectedSections.forEach((section) => {
          const sourceText = sourceEncounter.soap[section].trim();
          if (!sourceText) {
            return;
          }
          // Re-key every data-macro-run-id reference in the source HTML
          // (covers both the new per-prompt span format and the legacy
          // wrapper format), then carry the underlying macro runs over.
          const idMap = new Map<string, string>();
          const rewrittenText = sourceText.replace(
            /data-macro-run-id=["']([^"']+)["']/g,
            (_match, oldId: string) => {
              let newId = idMap.get(oldId);
              if (!newId) {
                newId = createEncounterMacroRunId();
                idMap.set(oldId, newId);
              }
              return `data-macro-run-id="${newId}"`;
            },
          );
          setSoapSection(newEncounterId, section, rewrittenText);
          idMap.forEach((newId, oldId) => {
            const sourceRun = sourceEncounter.macroRuns.find((entry) => entry.id === oldId);
            if (!sourceRun) {
              return;
            }
            addMacroRun(newEncounterId, {
              id: newId,
              section,
              macroId: sourceRun.macroId,
              macroName: sourceRun.macroName,
              body: sourceRun.body,
              answers: { ...sourceRun.answers },
              generatedText: sourceRun.generatedText.replace(
                new RegExp(`data-macro-run-id=["']${oldId}["']`, "g"),
                `data-macro-run-id="${newId}"`,
              ),
            });
          });
          copiedCount += 1;
        });
        // Also carry encounter charges over so the new visit starts with the prior plan.
        let copiedChargeCount = 0;
        sourceEncounter.charges.forEach((charge) => {
          const added = addCharge(newEncounterId, {
            treatmentMacroId: charge.treatmentMacroId,
            name: charge.name,
            procedureCode: charge.procedureCode,
            unitPrice: charge.unitPrice,
            units: charge.units,
          });
          if (added) {
            copiedChargeCount += 1;
          }
        });
        if (copiedCount > 0 || copiedChargeCount > 0) {
          const chargeSuffix =
            copiedChargeCount > 0
              ? ` and ${copiedChargeCount} charge${copiedChargeCount === 1 ? "" : "s"}`
              : "";
          setEncounterMessage(
            `Encounter created for ${appointmentDate}. SALT copied ${copiedCount} section(s)${chargeSuffix} from ${sourceEncounter.encounterDate}.`,
          );
        } else {
          setEncounterMessage(`Encounter created for ${appointmentDate}.`);
        }
      } else {
        setEncounterMessage(`Encounter created for ${appointmentDate}.`);
      }
    } else {
      setEncounterMessage(`Encounter created for ${appointmentDate}.`);
    }

    openEncounterEditor(newEncounterId);
  };

  const savePatientFile = () => {
    const paidValue = Number.parseFloat(paidAmount);
    setPatientBillingCoreFields(patient.id, {
      billedAmount: currentBillTotal,
      paidAmount: Number.isFinite(paidValue) ? paidValue : 0,
      paidDate,
    });

    const nextFirstName = firstName.trim();
    const nextLastName = lastName.trim();
    const nextFullName =
      nextFirstName || nextLastName
        ? `${nextLastName || names.lastName}, ${nextFirstName || names.firstName}`
        : patient.fullName;

    const savedPatient = updatePatientRecordById(patient.id, {
      fullName: nextFullName,
      dob: toIsoDateFromUsDate(patientDob),
      sex: patientSex || undefined,
      maritalStatus: maritalStatus || undefined,
      dateOfLoss: toIsoDateFromUsDate(dateOfLoss) || patient.dateOfLoss,
      attorney: isCashPatient ? "Self" : (attorney.trim() || "Self"),
      phone: formatUsPhoneInput(patientPhone) || "-",
      email: patientEmail.trim(),
      address: patientAddress.trim(),
      caseStatus: caseStatus as PatientRecord["caseStatus"],
      isCashPatient: isCashPatient || undefined,
      lastUpdate: new Date().toISOString().slice(0, 10),
      relatedCases: relatedCases.length > 0 ? relatedCases : undefined,
      xrayReferrals,
      mriReferrals,
      specialistReferrals,
      alerts: patientAlerts.length > 0 ? patientAlerts : undefined,
      matrix: {
        initialExam: toIsoDateFromUsDate(initialExam),
        lien: resolvedLienStatus,
        priorCare: priorCare.trim(),
        xrayFindings: xrayFindings.trim(),
        mriCtFindings: mriCtFindings.trim(),
        specialistRecommendations: specialistRecommendations.trim(),
        // Derive the specialist matrix fields from the specialistReferrals
        // array so the Case Flow queue sees what the user has actually
        // logged in the Specialist panel. Without this sync, the user
        // logs a specialist referral in the card but Case Flow keeps
        // showing "Referral needs to be sent" because it only reads the
        // matrix.
        //    sent      → latest Sent date across all referrals
        //    scheduled → latest Scheduled date
        //    report    → latest Report-Received date
        specialistSent: (() => {
          const dates = specialistReferrals
            .map((entry) => toIsoDateFromUsDate(entry.sentDate))
            .filter((d) => d);
          return dates.sort().at(-1) ?? "";
        })(),
        specialistScheduled: (() => {
          const dates = specialistReferrals
            .map((entry) => toIsoDateFromUsDate(entry.scheduledDate))
            .filter((d) => d);
          return dates.sort().at(-1) ?? "";
        })(),
        specialistReport: (() => {
          const dates = specialistReferrals
            .map((entry) => toIsoDateFromUsDate(entry.reportReceivedDate))
            .filter((d) => d);
          return dates.sort().at(-1) ?? "";
        })(),
        notes: patientNotes.trim(),
        discharge: toIsoDateFromUsDate(dischargeDate),
        rbSent: toIsoDateFromUsDate(rbSentDate),
        billed: currentBillTotal.toString(),
        paidAmount: paidAmount || "0",
        paidDate: toIsoDateFromUsDate(paidDate),
      },
    });

    if (savedPatient) {
      setSaveMessage("Updated — syncing to cloud...");
      void forceSyncNow().then(() => setSaveMessage("Saved & synced to cloud.")).catch(() => setSaveMessage("Saved locally — cloud sync failed, will retry."));
    } else {
      setSaveMessage("Could not save patient record.");
    }
  };

  const saveAndClosePatientFile = async () => {
    savePatientFile();
    try {
      await forceSyncNow();
    } catch {
      // best-effort — local is saved regardless
    }
    router.push("/patients");
  };

  const handleDeletePatient = () => {
    const settings = loadOfficeSettings();
    if (!settings.deletePassword) {
      setDeleteError("No delete password is set. Go to Settings → Office to set one first.");
      return;
    }
    if (deletePasswordInput !== settings.deletePassword) {
      setDeleteError("Incorrect password.");
      return;
    }
    const deleted = deletePatientRecord(patient.id);
    if (!deleted) {
      setDeleteError("Could not delete patient. Please try again.");
      return;
    }
    setShowDeleteModal(false);
    router.push("/patients");
  };

  const addDiagnosisFromMacro = () => {
    const targetId = diagnosisMacroIdDraft || activeDiagnosisMacros[0]?.id;
    if (!targetId) {
      setDiagnosisMessage("Create diagnosis macros in Settings > Billing Macro Settings first.");
      return;
    }
    const macro = activeDiagnosisMacros.find((entry) => entry.id === targetId);
    if (!macro) {
      setDiagnosisMessage("Selected diagnosis macro is not available.");
      return;
    }
    const wasAdded = addDiagnosis(macro.code, macro.description, "Diagnosis Macro");
    setDiagnosisMessage(wasAdded ? `${macro.code} added to patient file.` : `${macro.code} already exists in this patient file.`);
  };

  const addDiagnosisBundle = () => {
    const targetId = diagnosisBundleIdDraft || activeDiagnosisBundles[0]?.id;
    if (!targetId) {
      setDiagnosisMessage("Create diagnosis bundles in Settings > Billing Macro Settings first.");
      return;
    }
    const bundle = activeDiagnosisBundles.find((entry) => entry.id === targetId);
    if (!bundle) {
      setDiagnosisMessage("Selected diagnosis bundle is not available.");
      return;
    }

    const items = bundle.diagnosisIds
      .map((diagnosisId) => diagnosisById.get(diagnosisId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        code: entry.code,
        description: entry.description,
        source: `Bundle: ${bundle.name}`,
      }));

    const addedCount = addBulkDiagnoses(items);
    setDiagnosisMessage(
      addedCount
        ? `${addedCount} diagnosis code${addedCount === 1 ? "" : "s"} added from "${bundle.name}".`
        : `All diagnosis codes from "${bundle.name}" are already in this patient file.`,
    );
  };

  const addCustomDiagnosis = () => {
    const wasAdded = addDiagnosis(customDiagnosisCodeDraft, customDiagnosisDescriptionDraft, "Manual");
    if (!wasAdded) {
      setDiagnosisMessage("Enter diagnosis code + description. Duplicate entries are skipped.");
      return;
    }
    setCustomDiagnosisCodeDraft("");
    setCustomDiagnosisDescriptionDraft("");
    setDiagnosisMessage("Custom diagnosis code added to patient file.");
  };

  const initialExamDateValue = parseUsDate(initialExam);
  const dischargeDateValue = parseUsDate(dischargeDate);
  const rbSentDateValue = parseUsDate(rbSentDate);
  const paidDateValue = parseUsDate(paidDate);

  const initialToDischarge = formatMonthDayDiff(
    initialExamDateValue && dischargeDateValue
      ? getMonthDayDiff(initialExamDateValue, dischargeDateValue)
      : null,
  );
  const dischargeToRb = formatMonthDayDiff(
    dischargeDateValue && rbSentDateValue ? getMonthDayDiff(dischargeDateValue, rbSentDateValue) : null,
  );
  const rbToPaid = formatMonthDayDiff(
    rbSentDateValue && paidDateValue ? getMonthDayDiff(rbSentDateValue, paidDateValue) : null,
  );
  const billedAmountValue = currentBillTotal;
  const paidAmountValue = Number.parseFloat(paidAmount);
  const percentagePaid =
    billedAmountValue > 0 &&
    Number.isFinite(paidAmountValue) &&
    paidAmountValue >= 0
      ? (paidAmountValue / billedAmountValue) * 100
      : null;
  const balanceDue =
    billedAmountValue >= 0
      ? billedAmountValue -
        (Number.isFinite(paidAmountValue) && paidAmountValue >= 0 ? paidAmountValue : 0)
      : null;

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-[var(--text-muted)]">
              <Link href="/patients" className="underline">
                Patients
              </Link>{" "}
              / Patient File
            </p>
            <h2 className="text-2xl font-semibold">{patient.fullName}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Case profile only. SOAP charting is kept in the Encounters module.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="inline-flex items-center rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                href={`/encounters?patientId=${patient.id}`}
              >
                Open Encounters For This Patient
              </Link>
              <button
                className="inline-flex items-center rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                onClick={(event) => openQuickTaskModal(event)}
                ref={quickTaskButtonRef}
                type="button"
              >
                + To Do
              </button>
            </div>
            {quickTaskStatusMessage && (
              <p className="text-sm font-semibold text-[var(--brand-primary)]">{quickTaskStatusMessage}</p>
            )}
          </div>
          <span
            className="status-pill"
            style={{
              backgroundColor: withAlpha(statusColor, 0.2),
              color: getContrastTextColor(statusColor),
            }}
          >
            {caseStatus}
          </span>
        </div>

        {/* Patient Alerts */}
        {patientAlerts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {patientAlerts.map((alert, index) => (
              <span
                key={`alert-${index}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8b931] bg-[#fef9e7] px-3 py-1.5 text-sm font-bold text-[#92400e] shadow-sm"
              >
                ⚠ {alert}
                <button
                  className="ml-1 rounded-full text-[#92400e]/60 transition hover:text-[#b43b34]"
                  onClick={() => setPatientAlerts((current) => current.filter((_, i) => i !== index))}
                  title="Remove alert"
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm"
            onChange={(event) => setAlertDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && alertDraft.trim()) {
                event.preventDefault();
                setPatientAlerts((current) => [...current, alertDraft.trim().toUpperCase()]);
                setAlertDraft("");
              }
            }}
            placeholder="Add Patient Alert (Ex: Hx of Cancer, Broken Rib, etc.)"
            value={alertDraft}
          />
          <button
            className="rounded-lg border border-[#e8b931] bg-[#fef9e7] px-3 py-1.5 text-sm font-bold text-[#92400e] transition hover:bg-[#fdf2c5]"
            onClick={() => {
              if (alertDraft.trim()) {
                setPatientAlerts((current) => [...current, alertDraft.trim().toUpperCase()]);
                setAlertDraft("");
              }
            }}
            type="button"
          >
            + Alert
          </button>
        </div>
      </section>

      <section className="panel-card overflow-hidden">
        <div className="grid gap-3 border-b border-[var(--line-soft)] p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Last Name</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setLastName(event.target.value)}
              value={lastName}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient First Name</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setFirstName(event.target.value)}
              value={firstName}
            />
          </label>

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                list="attorney-contacts"
                ref={attorneyInputRef}
                onBlur={handleAttorneyBlur}
                onChange={(event) => handleAttorneyChange(event.target.value)}
                value={attorney}
              />
            </label>
          )}

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney Phone</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                readOnly
                placeholder="(000) 000-0000"
                value={attorneyPhone}
              />
            </label>
          )}

          {isCashPatient && (
            <label className="grid gap-1 md:col-span-2 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Cash Patient</span>
              <button
                className="ml-auto rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-semibold text-amber-800"
                onClick={() => setIsCashPatient(false)}
                type="button"
              >
                Convert to PI
              </button>
            </label>
          )}

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient DOB</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => setPatientDob(formatUsDateInput(event.target.value))}
              placeholder="MM/DD/YYYY"
              value={patientDob}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Sex</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setPatientSex(event.target.value as "Male" | "Female" | "Other" | "")}
              value={patientSex}
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
              onChange={(event) => setMaritalStatus(event.target.value as "Single" | "Married" | "Divorced" | "Widowed" | "Other" | "")}
              value={maritalStatus}
            >
              <option value="">—</option>
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Divorced">Divorced</option>
              <option value="Widowed">Widowed</option>
            </select>
          </label>

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Date Of Injury</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => setDateOfLoss(formatUsDateInput(event.target.value))}
                placeholder="MM/DD/YYYY"
                value={dateOfLoss}
              />
            </label>
          )}

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Initial Exam</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => setInitialExam(formatUsDateInput(event.target.value))}
                placeholder="MM/DD/YYYY"
                value={initialExam}
              />
            </label>
          )}

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Case #</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-[rgba(242,247,252,0.65)] px-3 py-2 font-semibold tracking-[0.08em] text-[var(--text-strong)]"
                placeholder="MMDDYYLASTFIRST"
                readOnly
                value={caseNumber}
              />
            </label>
          )}

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Phone</span>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                inputMode="numeric"
                maxLength={12}
                onChange={(event) => setPatientPhone(formatUsPhoneInput(event.target.value))}
                value={patientPhone}
              />
              {patientPhone.replace(/\D/g, "").length > 0 && (
                <SmsSendMenu
                  align="right"
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-primary)]"
                  context={{
                    patient: {
                      firstName,
                      lastName,
                      fullName: [firstName, lastName].filter(Boolean).join(" "),
                    },
                  }}
                  label="Text"
                  phone={patientPhone}
                />
              )}
            </div>
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Email</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setPatientEmail(event.target.value)}
              value={patientEmail}
            />
          </label>

          <div className="md:col-span-2 xl:col-span-4">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Address</span>
            <div className="mt-1">
              <AddressFieldGroup
                onChange={setPatientAddress}
                value={patientAddress}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-[var(--line-soft)] p-4 md:grid-cols-3">
          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">{lienLabel}</span>
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setLienStatus(event.target.value)}
                value={resolvedLienStatus}
              >
                {lienSelectOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!isCashPatient && (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Prior Care</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setPriorCare(event.target.value)}
                placeholder="Any prior treatment details"
                value={priorCare}
              />
            </label>
          )}

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Case Status</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setCaseStatus(event.target.value)}
              value={caseStatus}
            >
              {caseStatuses.map((statusConfigEntry) => (
                <option key={statusConfigEntry.name} value={statusConfigEntry.name}>
                  {statusConfigEntry.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isCashPatient && (
          <div className="p-4">
            <CashPaymentsSection patientId={patient.id} />
          </div>
        )}

        <div className="grid items-start gap-5 p-4 xl:grid-cols-3">
          <article className="rounded-2xl border border-[#bfd2e0] bg-gradient-to-b from-[#d8e7f2] to-[#cfe0ec] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <button
              className="flex w-full items-center justify-between rounded-xl bg-[#6db5c8] px-3 py-2 text-2xl font-semibold tracking-[-0.01em] text-white"
              onClick={() => toggleImagingPanel("xray")}
              type="button"
            >
              <span>X-Ray</span>
              <span className="text-xl">{imagingPanelsOpen.xray ? "−" : "+"}</span>
            </button>

            {imagingPanelsOpen.xray && (
              <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); saveImagingReferral("xray"); }}>
                {/* Row 1: Sent Date + Imaging Center */}
                <div className="grid grid-cols-[140px_1fr] gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Sent Date</span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) =>
                        setXray((current) => ({ ...current, sentDate: formatUsDateInput(event.target.value) }))
                      }
                      placeholder="MM/DD/YYYY"
                      value={xray.sentDate}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Imaging Center</span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      list="imaging-centers"
                      onChange={(event) => setXray((current) => ({ ...current, center: event.target.value }))}
                      placeholder="Select or type center"
                      value={xray.center}
                    />
                  </label>
                </div>

                {/* Row 2: Regions */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Regions</span>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] transition hover:bg-[#ecf4fa]"
                      onClick={(event) => {
                        setRegionModalAnchor(getPopupAnchorFromEvent(event));
                        setActiveRegionModal("xray");
                      }}
                      type="button"
                    >
                      Select / Update
                    </button>
                  </div>
                  <div className="min-h-[36px] rounded-lg border border-[#b7ccdc] bg-white/90 px-2 py-1.5">
                    {xray.regions.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">No regions selected.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {xray.regions.map((region) => (
                          <span
                            key={`xray-region-${region}`}
                            className="inline-flex items-center gap-1 rounded-full border border-[#9ab8cc] bg-[#ecf4fa] px-2 py-0.5 text-xs font-semibold text-[#35566f]"
                          >
                            {formatRegionLabel(region, xray.lateralityByRegion)}
                            {xray.flexExtRegions.includes(region) && (
                              <span className="rounded-full bg-[#0d79bf] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                F/E
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    className="w-full rounded-lg bg-[var(--brand-primary)] px-3 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                    type="submit"
                  >
                    {editingXrayReferralId ? "Update X-Ray Sent" : "Add X-Ray Sent"}
                  </button>
                  {editingXrayReferralId && (
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2.5 text-sm font-semibold"
                      onClick={() => cancelImagingReferralEdit("xray")}
                      type="button"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {/* Overrides */}
                <div className="flex flex-wrap gap-5 rounded-lg border border-[var(--line-soft)] bg-white px-4 py-3">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={xrayFollowUpOverride.patientRefused}
                      onChange={(event) => setPatientRefused(patient.id, "xray", event.target.checked)}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={xrayFollowUpOverride.completedPriorCare}
                      onChange={(event) => setCompletedPriorCare(patient.id, "xray", event.target.checked)}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={xrayFollowUpOverride.notNeeded}
                      onChange={(event) => setNotNeeded(patient.id, "xray", event.target.checked)}
                      type="checkbox"
                    />
                    No X-Ray
                  </label>
                </div>
              </form>
            )}

            {xrayMessage && (
              <p className={`${imagingPanelsOpen.xray ? "mt-2" : "mt-3"} text-xs font-semibold text-[var(--brand-primary)]`}>
                {xrayMessage}
              </p>
            )}
            <div
              className={`mt-2 space-y-2 overflow-auto rounded-xl border border-[var(--line-soft)] bg-white p-2 ${
                imagingPanelsOpen.xray ? "max-h-36 text-xs" : "max-h-56 text-sm"
              }`}
            >
              {xrayReferrals.length === 0 && (
                <p className="text-[var(--text-muted)]">
                  {xrayFollowUpOverride.completedPriorCare
                    ? "Completed Prior Care"
                    : xrayFollowUpOverride.patientRefused
                      ? "Patient Refused"
                      : xrayFollowUpOverride.notNeeded
                        ? "No X-Ray"
                        : "No X-Ray sent entries yet."}
                </p>
              )}
              {xrayReferrals.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-[var(--line-soft)] p-2">
                  <p className="font-semibold">
                    {entry.modalityLabel} — {entry.center || "No Center"}
                  </p>
                  <p>Regions: {formatImagingRegionsSummary(entry, "xray")}</p>
                  <p>Sent: {entry.sentDate || "-"} | Completed: {entry.doneDate || "-"}</p>
                  {entry.findings?.trim() && (
                    <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-strong)]">Findings:</span> {entry.findings.trim()}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => generateImagingRequestPdf("xray", entry)}
                      type="button"
                    >
                      Generate PDF
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={(event) => openImagingEditor("xray", entry, event)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => { if (window.confirm("Remove this X-ray referral?")) removeImagingReferral("xray", entry.id); }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-[#bfd2e0] bg-gradient-to-b from-[#d8e7f2] to-[#cfe0ec] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <button
              className="flex w-full items-center justify-between rounded-xl bg-[#6db5c8] px-3 py-2 text-2xl font-semibold tracking-[-0.01em] text-white"
              onClick={() => toggleImagingPanel("mri")}
              type="button"
            >
              <span>{mri.isCt ? "MRI / CT" : "MRI"}</span>
              <span className="text-xl">{imagingPanelsOpen.mri ? "−" : "+"}</span>
            </button>

            {imagingPanelsOpen.mri && (
              <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); saveImagingReferral("mri"); }}>
                <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold">
                  <input
                    checked={Boolean(mri.isCt)}
                    onChange={(event) =>
                      setMri((current) => ({
                        ...current,
                        isCt: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  CT instead of MRI
                </label>

                {/* Row 1: Sent Date + Imaging Center */}
                <div className="grid grid-cols-[140px_1fr] gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Sent Date</span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) => setMri((current) => ({ ...current, sentDate: formatUsDateInput(event.target.value) }))}
                      placeholder="MM/DD/YYYY"
                      value={mri.sentDate}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Imaging Center</span>
                    <input
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      list="imaging-centers"
                      onChange={(event) => setMri((current) => ({ ...current, center: event.target.value }))}
                      placeholder="Select or type center"
                      value={mri.center}
                    />
                  </label>
                </div>

                {/* Row 2: Regions */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Regions</span>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] transition hover:bg-[#ecf4fa]"
                      onClick={(event) => {
                        setRegionModalAnchor(getPopupAnchorFromEvent(event));
                        setActiveRegionModal("mri");
                      }}
                      type="button"
                    >
                      Select / Update
                    </button>
                  </div>
                  <div className="min-h-[36px] rounded-lg border border-[#b7ccdc] bg-white/90 px-2 py-1.5">
                    {mri.regions.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">No regions selected.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {mri.regions.map((region) => (
                          <span
                            key={`mri-region-${region}`}
                            className="inline-flex items-center rounded-full border border-[#9ab8cc] bg-[#ecf4fa] px-2 py-0.5 text-xs font-semibold text-[#35566f]"
                          >
                            {formatRegionLabel(region, mri.lateralityByRegion)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    className="w-full rounded-lg bg-[var(--brand-primary)] px-3 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                    type="submit"
                  >
                    {editingMriReferralId ? "Update MRI / CT Sent" : "Add MRI / CT Sent"}
                  </button>
                  {editingMriReferralId && (
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2.5 text-sm font-semibold"
                      onClick={() => cancelImagingReferralEdit("mri")}
                      type="button"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {/* Overrides */}
                <div className="flex flex-wrap gap-5 rounded-lg border border-[var(--line-soft)] bg-white px-4 py-3">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={mriCtFollowUpOverride.patientRefused}
                      onChange={(event) => setPatientRefused(patient.id, "mriCt", event.target.checked)}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={mriCtFollowUpOverride.completedPriorCare}
                      onChange={(event) => setCompletedPriorCare(patient.id, "mriCt", event.target.checked)}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={mriCtFollowUpOverride.notNeeded}
                      onChange={(event) => setNotNeeded(patient.id, "mriCt", event.target.checked)}
                      type="checkbox"
                    />
                    No MRI
                  </label>
                </div>
              </form>
            )}

            {mriMessage && (
              <p className={`${imagingPanelsOpen.mri ? "mt-2" : "mt-3"} text-xs font-semibold text-[var(--brand-primary)]`}>
                {mriMessage}
              </p>
            )}
            <div
              className={`mt-2 space-y-2 overflow-auto rounded-xl border border-[var(--line-soft)] bg-white p-2 ${
                imagingPanelsOpen.mri ? "max-h-36 text-xs" : "max-h-56 text-sm"
              }`}
            >
              {mriReferrals.length === 0 && (
                <p className="text-[var(--text-muted)]">
                  {mriCtFollowUpOverride.completedPriorCare
                    ? "Completed Prior Care"
                    : mriCtFollowUpOverride.patientRefused
                      ? "Patient Refused"
                      : mriCtFollowUpOverride.notNeeded
                        ? "No MRI / CT"
                        : "No MRI / CT sent entries yet."}
                </p>
              )}
              {mriReferrals.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-[var(--line-soft)] p-2">
                  <p className="font-semibold">
                    {entry.modalityLabel} — {entry.center || "No Center"}
                  </p>
                  <p>Regions: {formatImagingRegionsSummary(entry, "mri")}</p>
                  <p>Sent: {entry.sentDate || "-"} | Completed: {entry.doneDate || "-"}</p>
                  {entry.findings?.trim() && (
                    <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-strong)]">Findings:</span> {entry.findings.trim()}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => generateImagingRequestPdf("mri", entry)}
                      type="button"
                    >
                      Generate PDF
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={(event) => openImagingEditor("mri", entry, event)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => { if (window.confirm("Remove this MRI referral?")) removeImagingReferral("mri", entry.id); }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-[#bfd2e0] bg-gradient-to-b from-[#d8e7f2] to-[#cfe0ec] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <button
              className="flex w-full items-center justify-between rounded-xl bg-[#6db5c8] px-3 py-2 text-2xl font-semibold tracking-[-0.01em] text-white"
              onClick={() => toggleImagingPanel("specialist")}
              type="button"
            >
              <span>Specialist</span>
              <span className="text-xl">{imagingPanelsOpen.specialist ? "−" : "+"}</span>
            </button>

            {imagingPanelsOpen.specialist && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 sm:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Specialist</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    list="specialist-contacts"
                    onChange={(event) =>
                      setSpecialistDraft((current) => ({ ...current, specialist: event.target.value }))
                    }
                    placeholder="Select or type specialist"
                    value={specialistDraft.specialist}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Sent Date</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setSpecialistDraft((current) => ({
                        ...current,
                        sentDate: formatUsDateInput(event.target.value),
                      }))
                    }
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="MM/DD/YYYY"
                    value={specialistDraft.sentDate}
                  />
                </label>
                <button
                  className="w-full self-end rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-semibold"
                  onClick={addSpecialist}
                  type="button"
                >
                  Add Specialist
                </button>
                <div className="flex flex-wrap gap-5 rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3 sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={specialistFollowUpOverride.patientRefused}
                      onChange={(event) => setPatientRefused(patient.id, "specialist", event.target.checked)}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={specialistFollowUpOverride.completedPriorCare}
                      onChange={(event) => setCompletedPriorCare(patient.id, "specialist", event.target.checked)}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={specialistFollowUpOverride.notNeeded}
                      onChange={(event) => setNotNeeded(patient.id, "specialist", event.target.checked)}
                      type="checkbox"
                    />
                    No Spcl
                  </label>
                </div>
              </div>
            )}

            {specialistMessage && (
              <p
                className={`${imagingPanelsOpen.specialist ? "mt-2" : "mt-3"} text-xs font-semibold text-[var(--brand-primary)]`}
              >
                {specialistMessage}
              </p>
            )}
            <div
              className={`mt-2 space-y-2 overflow-auto rounded-xl border border-[var(--line-soft)] bg-white p-2 ${
                imagingPanelsOpen.specialist ? "max-h-36 text-xs" : "max-h-56 text-sm"
              }`}
            >
              {specialistReferrals.length === 0 && (
                <p className="text-[var(--text-muted)]">
                  {specialistFollowUpOverride.completedPriorCare
                    ? "Completed Prior Care"
                    : specialistFollowUpOverride.patientRefused
                      ? "Patient Refused"
                      : specialistFollowUpOverride.notNeeded
                        ? "No Specialist"
                        : "No specialist referrals added yet."}
                </p>
              )}
              {specialistReferrals.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-[var(--line-soft)] p-2">
                  <p className="font-semibold">{entry.specialist}</p>
                  <p>Sent: {entry.sentDate || "-"} | Completed: {entry.completedDate || "-"}</p>
                  {entry.recommendations.trim() && (
                    <p className="mt-1 text-[var(--text-muted)]">{entry.recommendations}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => generateSpecialistReferralPdf(entry)}
                      type="button"
                    >
                      Generate PDF
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={(event) => openSpecialistEditor(entry, event)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 font-semibold"
                      onClick={() => { if (window.confirm("Remove this specialist referral?")) removeSpecialist(entry.id); }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="panel-card p-4">
        <button
          className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
          onClick={() => toggleSectionPanel("notes")}
          type="button"
        >
          <span>Notes</span>
          <span className="text-xl">{sectionPanelsOpen.notes ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.notes && (
          <label className="mt-3 grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Case Notes</span>
            <textarea
              className="min-h-[140px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setPatientNotes(event.target.value)}
              placeholder="Enter any free-form case notes..."
              value={patientNotes}
            />
          </label>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="panel-card p-4">
          <button
            className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
            onClick={() => toggleSectionPanel("reExam")}
            type="button"
          >
            <span>Case Flow &amp; To-Do</span>
            <span className="text-xl">{sectionPanelsOpen.reExam ? "−" : "+"}</span>
          </button>
          {sectionPanelsOpen.reExam && (
            <div className="mt-3 grid gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Case Flow
                </div>
                {patientFlowItems.length === 0 ? (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">No open flow items.</p>
                ) : (
                  <ul className="mt-1 grid gap-2">
                    {patientFlowItems.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{item.category}</span>
                          {item.daysFromAnchor !== null && (
                            <span className="text-xs text-[var(--text-muted)]">
                              {item.daysFromAnchor}d
                            </span>
                          )}
                        </div>
                        <div className="text-[var(--text-muted)]">{item.stage}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  To-Do
                </div>
                {patientTasks.length === 0 ? (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">No to-do items for this patient.</p>
                ) : (
                  <ul className="mt-1 grid gap-2">
                    {patientTasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-start gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                      >
                        <input
                          checked={task.done}
                          className="mt-1"
                          onChange={() => toggleTaskDone(task.id)}
                          type="checkbox"
                        />
                        <div className="flex-1">
                          <div className={task.done ? "line-through text-[var(--text-muted)]" : "font-semibold"}>
                            {task.title}
                          </div>
                          {(task.dueDate || task.priority) && (
                            <div className="text-xs text-[var(--text-muted)]">
                              {task.priority}
                              {task.dueDate ? ` • Due ${task.dueDate}` : ""}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </article>

        <article className="panel-card p-4">
          <button
            className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
            onClick={() => toggleSectionPanel("relatedCases")}
            type="button"
          >
            <span>Related Cases</span>
            <span className="text-xl">{sectionPanelsOpen.relatedCases ? "−" : "+"}</span>
          </button>
          {sectionPanelsOpen.relatedCases && (
            <>
              <div className="mt-3 flex gap-2">
                <div className="relative w-full">
                  <input
                    className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onBlur={() => {
                      setTimeout(() => setShowRelatedCaseSuggestions(false), 120);
                    }}
                    onChange={(event) => {
                      setRelatedCaseDraft(event.target.value);
                      setSelectedRelatedPatientId(null);
                      setRelatedCaseMessage("");
                      setShowRelatedCaseSuggestions(true);
                    }}
                    onFocus={() => setShowRelatedCaseSuggestions(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addRelatedCase();
                      }
                    }}
                    placeholder="Search patient..."
                    value={relatedCaseDraft}
                  />
                  {showRelatedCaseSuggestions && (
                    <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-[var(--line-soft)] bg-white shadow-[0_10px_28px_rgba(20,35,52,0.12)]">
                      {relatedCaseSuggestions.map((entry) => (
                        <button
                          key={`related-suggestion-${entry.id}`}
                          className="block w-full border-b border-[var(--line-soft)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--bg-soft)]"
                          onClick={() => {
                            setSelectedRelatedPatientId(entry.id);
                            setRelatedCaseDraft(entry.fullName);
                            setShowRelatedCaseSuggestions(false);
                          }}
                          type="button"
                        >
                          <span className="font-semibold">{entry.fullName}</span>{" "}
                          <span className="text-[var(--text-muted)]">DOI {toUsDate(entry.dateOfLoss)}</span>
                        </button>
                      ))}
                      {relatedCaseSuggestions.length === 0 && (
                        <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No matching patients.</p>
                      )}
                    </div>
                  )}
                </div>
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={addRelatedCase}
                  type="button"
                >
                  Add
                </button>
              </div>
              {relatedCaseMessage && (
                <p className="mt-2 text-xs font-semibold text-[#b43b34]">{relatedCaseMessage}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {relatedCases.map((entry) => (
                  <div
                    key={entry.patientId}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-sm"
                  >
                    <button
                      className="inline-flex items-center gap-2 rounded-full px-1 text-left hover:text-[var(--brand-primary)]"
                      onClick={(event) => openRelatedCaseNavigatePrompt(entry, event)}
                      type="button"
                    >
                      <span className="font-semibold">{entry.fullName}</span>
                      <span className="text-[var(--text-muted)]">DOI {toUsDate(entry.dateOfLoss)}</span>
                    </button>
                    <button
                      className="rounded-full border border-[var(--line-soft)] px-2 text-xs font-semibold"
                      onClick={() => { if (window.confirm("Remove this related case?")) removeRelatedCase(entry.patientId); }}
                      type="button"
                    >
                      x
                    </button>
                  </div>
                ))}
                {relatedCases.length === 0 && <p className="text-sm text-[var(--text-muted)]">No related cases linked.</p>}
              </div>
            </>
          )}
        </article>

        <article className="panel-card p-4">
          <button
            className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
            onClick={() => toggleSectionPanel("quickStats")}
            type="button"
          >
            <span>Quick Stats</span>
            <span className="text-xl">{sectionPanelsOpen.quickStats ? "−" : "+"}</span>
          </button>
          {sectionPanelsOpen.quickStats && (
            <>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Configure visible items in Settings → Quick Stats.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {quickStatRows.map((row) => (
                  <div
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    key={`quick-stat-${row.key}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {row.label}
                    </p>
                    <p className="mt-1 text-xl font-semibold text-[var(--text-main)]">{row.value}</p>
                    {row.helper && <p className="text-xs text-[var(--text-muted)]">{row.helper}</p>}
                  </div>
                ))}
                {quickStatRows.length === 0 && (
                  <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
                    All quick stats are hidden. Enable them in Settings → Quick Stats.
                  </p>
                )}
              </div>
            </>
          )}
        </article>
      </section>

      <section className="panel-card p-4">
        <button
          className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
          onClick={() => toggleSectionPanel("appointments")}
          type="button"
        >
          <span>Appointments / Encounters</span>
          <span className="text-xl">{sectionPanelsOpen.appointments ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.appointments && (
          <>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-[var(--text-muted)]">
                View all scheduled appointments for this patient and launch encounters quickly.
              </p>
              <button
                className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                onClick={openScheduleModal}
                type="button"
              >
                + Schedule Appointment
              </button>
            </div>

            {encounterMessage && <p className="mt-2 text-sm font-semibold text-[var(--brand-primary)]">{encounterMessage}</p>}

            <div className="mt-3 grid items-start gap-4 xl:grid-cols-[1.8fr_1fr]">
              <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <h4 className="text-base font-semibold">Scheduled Appointments</h4>
                <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-[var(--bg-soft)] text-left">
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Time</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Encounter</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointmentRows.map((row) => {
                        const linkedEncounter = row.linkedEncounter;
                        const appointment = row.appointment;
                        return (
                          <tr key={row.rowId} className="border-t border-[var(--line-soft)]">
                            <td className="px-2 py-2 tabular-nums">
                              {appointment ? (
                                quickDateEditId === appointment.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      autoFocus
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                      inputMode="numeric"
                                      maxLength={10}
                                      onChange={(event) =>
                                        setQuickDateDraft(formatUsDateInput(event.target.value))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          commitQuickDateEdit(appointment);
                                        } else if (event.key === "Escape") {
                                          cancelQuickDateEdit();
                                        }
                                      }}
                                      placeholder="MM/DD/YYYY"
                                      value={quickDateDraft}
                                    />
                                    <button
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs font-semibold text-[var(--brand-primary)]"
                                      onClick={() => commitQuickDateEdit(appointment)}
                                      title="Save new date"
                                      type="button"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]"
                                      onClick={cancelQuickDateEdit}
                                      title="Cancel"
                                      type="button"
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    className="rounded-md border border-transparent px-1.5 py-0.5 text-xs font-semibold hover:border-[var(--line-soft)] hover:bg-[var(--bg-soft)]"
                                    onClick={() => beginQuickDateEdit(appointment)}
                                    title="Click to change date — open the full edit modal from the row's ⋯ menu for everything else."
                                    type="button"
                                  >
                                    {row.dateLabel}
                                  </button>
                                )
                              ) : (
                                <span>{row.dateLabel}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {appointment ? (
                                quickTimeEditId === appointment.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      autoFocus
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                      inputMode="numeric"
                                      maxLength={5}
                                      onChange={(event) => {
                                        const digits = event.target.value
                                          .replace(/\D/g, "")
                                          .slice(0, 4);
                                        const formatted =
                                          digits.length <= 2
                                            ? digits
                                            : `${digits.slice(0, 2)}:${digits.slice(2)}`;
                                        setQuickTimeDraft(formatted);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          commitQuickTimeEdit(appointment);
                                        } else if (event.key === "Escape") {
                                          cancelQuickTimeEdit();
                                        }
                                      }}
                                      placeholder="HH:MM"
                                      value={quickTimeDraft}
                                    />
                                    <button
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs font-semibold text-[var(--brand-primary)]"
                                      onClick={() => commitQuickTimeEdit(appointment)}
                                      title="Save new time"
                                      type="button"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]"
                                      onClick={cancelQuickTimeEdit}
                                      title="Cancel"
                                      type="button"
                                    >
                                      ✕
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    className="rounded-md border border-transparent px-1.5 py-0.5 text-xs font-semibold hover:border-[var(--line-soft)] hover:bg-[var(--bg-soft)]"
                                    onClick={() => beginQuickTimeEdit(appointment)}
                                    title="Click to change time"
                                    type="button"
                                  >
                                    {formatTimeLabel(appointment.startTime)}
                                  </button>
                                )
                              ) : (
                                <span className="text-xs text-[var(--text-muted)]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {appointment ? (
                                quickTypeEditId === appointment.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <select
                                      autoFocus
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                      onBlur={cancelQuickTypeEdit}
                                      onChange={(event) =>
                                        commitQuickTypeEdit(appointment, event.target.value)
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Escape") cancelQuickTypeEdit();
                                      }}
                                      value={appointment.appointmentType}
                                    >
                                      {/* Show the current type even if it's no longer in
                                          the configured list — otherwise selecting it would
                                          appear to "switch" to whatever option is at the top. */}
                                      {!filterAppointmentTypesForPatient(
                                        appointmentTypes,
                                        Boolean(patient.isCashPatient),
                                      ).some(
                                        (t) =>
                                          t.name.toLowerCase() ===
                                          appointment.appointmentType.toLowerCase(),
                                      ) && (
                                        <option value={appointment.appointmentType}>
                                          {appointment.appointmentType}
                                        </option>
                                      )}
                                      {filterAppointmentTypesForPatient(
                                        appointmentTypes,
                                        Boolean(patient.isCashPatient),
                                      ).map((type) => (
                                        <option key={`quick-type-${type.id}`} value={type.name}>
                                          {type.name}
                                        </option>
                                      ))}
                                    </select>
                                  </span>
                                ) : (
                                  <button
                                    className="rounded-md border border-transparent px-1.5 py-0.5 text-xs font-semibold hover:border-[var(--line-soft)] hover:bg-[var(--bg-soft)]"
                                    onClick={() => beginQuickTypeEdit(appointment)}
                                    title="Click to change appointment type"
                                    type="button"
                                  >
                                    {row.typeLabel}
                                  </button>
                                )
                              ) : (
                                <span>{row.typeLabel}</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {appointment ? (
                                <select
                                  className={`rounded-full border border-[var(--line-soft)] px-2 py-1 text-xs font-semibold ${getStatusBadgeClass(appointment.status)}`}
                                  onChange={(event) =>
                                    handleAppointmentStatusChange(
                                      appointment.id,
                                      event.target.value as AppointmentStatus,
                                    )
                                  }
                                  title="Click to change status"
                                  value={appointment.status}
                                >
                                  {appointmentStatusOptions.map((status) => {
                                    const disabled = !isAppointmentStatusSelectable(status, appointment.status);
                                    return (
                                      <option
                                        key={`pcf-status-${appointment.id}-${status}`}
                                        disabled={disabled}
                                        value={status}
                                      >
                                        {formatAppointmentStatusLabel(status)}
                                      </option>
                                    );
                                  })}
                                </select>
                              ) : (
                                <span className="text-xs text-[var(--text-muted)]">{row.statusLabel}</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {linkedEncounter ? (
                                <button
                                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                  onClick={() => openEncounterEditor(linkedEncounter.id)}
                                  type="button"
                                >
                                  Open Encounter
                                </button>
                              ) : appointment ? (
                                (appointment.status === "Check In") ? (
                                    <button
                                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                                      onClick={() => createEncounterFromAppointment(appointment)}
                                      title="Start encounter"
                                      type="button"
                                    >
                                      + Encounter
                                    </button>
                                ) : (
                                  <span className="text-xs text-[var(--text-muted)]">-</span>
                                )
                              ) : (
                                <span className="text-xs text-[var(--text-muted)]">-</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {appointment ? (
                                <button
                                  className="rounded-lg p-1.5 text-[#b43b34] hover:bg-red-50 transition-colors"
                                  onClick={() => handleDeleteAppointment(appointment)}
                                  title="Delete appointment"
                                  type="button"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" /></svg>
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {appointmentRows.length === 0 && (
                        <tr>
                          <td className="px-2 py-3 text-[var(--text-muted)]" colSpan={6}>
                            No appointments scheduled for this patient yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-semibold">Open Encounters</h4>
                  <Link
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                    href={`/encounters?patientId=${patient.id}`}
                  >
                    Open Workspace
                  </Link>
                </div>
                <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                  {openPatientEncounterRecords.map((encounter) => (
                    <div
                      key={`open-encounter-${encounter.id}`}
                      className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2"
                    >
                      <p className="text-sm font-semibold">{encounter.encounterDate}</p>
                      <p className="text-xs text-[var(--text-muted)]">{encounter.appointmentType}</p>
                      <button
                        className="mt-2 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                        onClick={() => openEncounterEditor(encounter.id)}
                        type="button"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                  {openPatientEncounterRecords.length === 0 && (
                    <p className="text-sm text-[var(--text-muted)]">No open encounters for this patient.</p>
                  )}
                </div>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="panel-card p-4">
        <button
          className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
          onClick={() => toggleSectionPanel("diagnosis")}
          type="button"
        >
          <span>Diagnosis Codes</span>
          <span className="text-xl">{sectionPanelsOpen.diagnosis ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.diagnosis && (
          <>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Add one code, add a preset bundle, or enter custom diagnosis codes for this patient file.
            </p>

            <div className="mt-3 grid gap-4 xl:grid-cols-3">
              <div className="space-y-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold">Add Diagnosis Macro</p>
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => {
                      setDiagnosisListSearch(event.target.value);
                      setDiagnosisMacroIdDraft("");
                    }}
                    placeholder="Search codes..."
                    value={diagnosisListSearch}
                  />
                  {diagnosisListSearch.trim() && (() => {
                    const q = diagnosisListSearch.trim().toLowerCase();
                    const qWords = q.replace(/[,.:;]/g, " ").split(/\s+/).filter(Boolean);
                    const groupsWithMatches = diagnosisMacrosByFolder
                      .map((group) => ({
                        ...group,
                        macros: group.macros.filter((entry) => {
                          const haystack = `${entry.code.toLowerCase()} ${entry.description.toLowerCase()}`;
                          return qWords.every((word) => haystack.includes(word));
                        }),
                      }))
                      .filter((group) => group.macros.length > 0);
                    const totalResults = groupsWithMatches.reduce((sum, g) => sum + g.macros.length, 0);
                    return totalResults > 0 ? (
                      <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white shadow-lg">
                        {groupsWithMatches.map((group) => (
                          <div key={`dx-search-group-${group.id}`}>
                            <div className="sticky top-0 bg-[var(--bg-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              {group.name}
                            </div>
                            {group.macros.map((entry) => (
                              <button
                                key={`dx-search-${entry.id}`}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-soft)] ${diagnosisMacroIdDraft === entry.id ? "bg-[var(--bg-soft)] font-semibold" : ""}`}
                                onClick={() => {
                                  setDiagnosisMacroIdDraft(entry.id);
                                  setDiagnosisListSearch("");
                                }}
                                type="button"
                              >
                                <span className="font-semibold">{entry.code}</span>{" "}
                                <span className="text-[var(--text-muted)]">- {entry.description}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)] shadow-lg">
                        No matching codes
                      </div>
                    );
                  })()}
                </div>
                <select
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setDiagnosisMacroIdDraft(event.target.value)}
                  value={diagnosisMacroIdDraft}
                >
                  <option value="">Select diagnosis code</option>
                  {diagnosisMacrosByFolder.map((group) => (
                    <optgroup key={`dx-folder-${group.id}`} label={group.name}>
                      {group.macros.map((entry) => (
                        <option key={`dx-macro-${entry.id}`} value={entry.id}>
                          {entry.code} - {entry.description}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-semibold"
                  onClick={addDiagnosisFromMacro}
                  type="button"
                >
                  Add Diagnosis Code
                </button>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold">Add Diagnosis Bundle</p>
                <select
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setDiagnosisBundleIdDraft(event.target.value)}
                  value={diagnosisBundleIdDraft}
                >
                  <option value="">Select bundle</option>
                  {activeDiagnosisBundles.map((entry) => (
                    <option key={`dx-bundle-${entry.id}`} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <button
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-semibold"
                  onClick={addDiagnosisBundle}
                  type="button"
                >
                  Add Bundle
                </button>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <p className="text-sm font-semibold">Add Custom Diagnosis</p>
                <input
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setCustomDiagnosisCodeDraft(event.target.value)}
                  placeholder="ICD-10 Code"
                  value={customDiagnosisCodeDraft}
                />
                <input
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setCustomDiagnosisDescriptionDraft(event.target.value)}
                  placeholder="Description"
                  value={customDiagnosisDescriptionDraft}
                />
                <button
                  className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 font-semibold"
                  onClick={addCustomDiagnosis}
                  type="button"
                >
                  Add Custom Code
                </button>
              </div>
            </div>

            {diagnosisMessage && <p className="mt-3 text-sm font-semibold text-[var(--brand-primary)]">{diagnosisMessage}</p>}

            <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line-soft)] bg-white">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[var(--bg-soft)] text-left">
                    <th className="w-8 px-1 py-2" />
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {patientDiagnoses.map((entry, idx) => {
                    const isDragging = dxDragIndex === idx;
                    const isDragOver = dxDragOverIndex === idx && dxDragIndex !== idx;
                    return (
                      <tr
                        key={entry.id}
                        ref={(el) => { dxTouchRowRefs.current[idx] = el; }}
                        className={`border-t border-[var(--line-soft)] transition-colors ${isDragging ? "opacity-40" : ""} ${isDragOver ? "bg-blue-50" : ""}`}
                        draggable
                        onDragStart={() => setDxDragIndex(idx)}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDxDragOverIndex(idx);
                        }}
                        onDragLeave={() => {
                          if (dxDragOverIndex === idx) setDxDragOverIndex(null);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (dxDragIndex !== null && dxDragIndex !== idx) {
                            reorderDiagnoses(dxDragIndex, idx);
                          }
                          setDxDragIndex(null);
                          setDxDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDxDragIndex(null);
                          setDxDragOverIndex(null);
                        }}
                        onTouchStart={(e) => {
                          const grip = (e.target as HTMLElement).closest('[data-dx-grip]');
                          if (!grip) return;
                          dxTouchStartY.current = e.touches[0].clientY;
                          setDxDragIndex(idx);
                        }}
                        onTouchMove={(e) => {
                          if (dxDragIndex === null) return;
                          e.preventDefault();
                          const y = e.touches[0].clientY;
                          const overIdx = dxTouchRowRefs.current.findIndex((row) => {
                            if (!row) return false;
                            const rect = row.getBoundingClientRect();
                            return y >= rect.top && y <= rect.bottom;
                          });
                          if (overIdx >= 0 && overIdx !== dxDragIndex) {
                            setDxDragOverIndex(overIdx);
                          }
                        }}
                        onTouchEnd={() => {
                          if (dxDragIndex !== null && dxDragOverIndex !== null && dxDragIndex !== dxDragOverIndex) {
                            reorderDiagnoses(dxDragIndex, dxDragOverIndex);
                          }
                          setDxDragIndex(null);
                          setDxDragOverIndex(null);
                          dxTouchStartY.current = null;
                        }}
                      >
                        <td className="px-1 py-2 text-center cursor-grab active:cursor-grabbing text-[var(--text-muted)] touch-none" data-dx-grip>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 inline-block pointer-events-none">
                            <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                          </svg>
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)] text-xs font-semibold">{idx + 1}</td>
                        <td className="px-3 py-2 font-semibold">{entry.code}</td>
                        <td className="px-3 py-2">{entry.description}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{entry.source}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                            onClick={() => { if (window.confirm(`Remove diagnosis "${entry.code}"?`)) removeDiagnosis(entry.id); }}
                            type="button"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {patientDiagnoses.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-[var(--text-muted)]" colSpan={6}>
                        No diagnosis codes on this patient file yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel-card p-4">
        <button
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-center text-lg font-semibold text-white ${isCompletePlan ? "bg-[#72bdcf]" : "bg-gray-400"}`}
          onClick={() => isCompletePlan && toggleSectionPanel("letters")}
          type="button"
        >
          <span>Letters{!isCompletePlan ? " — Complete Plan" : ""}</span>
          {isCompletePlan ? (
            <span className="text-xl">{sectionPanelsOpen.letters ? "−" : "+"}</span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>
          )}
        </button>
        {isCompletePlan && sectionPanelsOpen.letters && (
          <>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Generate school notes, work notes, gym notes, and other custom letters from saved templates.
            </p>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Letter Template</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => {
                    setLetterTemplateIdDraft(event.target.value);
                    setLetterMessage("");
                  }}
                  value={selectedLetterTemplate?.id ?? ""}
                >
                  {availableLetterTemplates.length === 0 ? (
                    <option value="">No letter templates available</option>
                  ) : (
                    availableLetterTemplates.map((template) => (
                      <option key={`patient-letter-template-${template.id}`} value={template.id}>
                        {template.name}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={generateLetterPdf}
                type="button"
              >
                Generate PDF
              </button>

              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => openTemplateSettings("generalLetter")}
                type="button"
              >
                Manage Templates
              </button>
            </div>

            {letterMessage && (
              <p className="mt-2 text-sm font-semibold text-[var(--brand-primary)]">{letterMessage}</p>
            )}
          </>
        )}
      </section>

      <section className="panel-card p-4">
        <button
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-center text-lg font-semibold text-white ${isCompletePlan ? "bg-[#72bdcf]" : "bg-gray-400"}`}
          onClick={() => isCompletePlan && toggleSectionPanel("narrative")}
          type="button"
        >
          <span>Full Narrative Report{!isCompletePlan ? " — Complete Plan" : ""}</span>
          {isCompletePlan ? (
            <span className="text-xl">{sectionPanelsOpen.narrative ? "−" : "+"}</span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>
          )}
        </button>
        {isCompletePlan && sectionPanelsOpen.narrative && (
          <>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Build a long-form narrative from patient demographics, encounters, diagnoses, imaging, specialist referrals, and custom prompt inputs.
            </p>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Narrative Template</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => {
                    setNarrativeTemplateIdDraft(event.target.value);
                    setNarrativeMessage("");
                  }}
                  value={selectedNarrativeTemplate?.id ?? ""}
                >
                  {availableNarrativeTemplates.length === 0 ? (
                    <option value="">No narrative templates available</option>
                  ) : (
                    availableNarrativeTemplates.map((template) => (
                      <option key={`patient-narrative-template-${template.id}`} value={template.id}>
                        {template.name}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={startNarrativeGeneration}
                type="button"
              >
                Generate Narrative
              </button>

              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={openReportTemplateSettings}
                type="button"
              >
                Manage Report Templates
              </button>
            </div>

            {narrativeMessage && (
              <p className="mt-2 text-sm font-semibold text-[var(--brand-primary)]">{narrativeMessage}</p>
            )}
          </>
        )}
      </section>

      {/* ── Patient Files ──────────────────────────────────────────────── */}
      <section className="panel-card p-4">
        <button
          className="flex w-full items-center justify-between rounded-2xl bg-[#6db5c8] px-3 py-2 text-center text-3xl font-semibold tracking-[-0.01em] text-white"
          onClick={() => toggleSectionPanel("patientFiles")}
          type="button"
        >
          <span>
            Patient Files
            {patientFiles.length > 0 && (
              <span className="ml-2 rounded-full bg-white/25 px-2.5 py-0.5 text-base">
                {patientFiles.length}
              </span>
            )}
          </span>
          <span className="text-xl">{sectionPanelsOpen.patientFiles ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.patientFiles && (
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setFileDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setFileDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setFileDragOver(false); handlePatientFileUpload(e.dataTransfer.files); }}
            className={`rounded-xl transition-colors ${fileDragOver ? "bg-blue-50 ring-2 ring-[var(--brand-primary)] ring-inset" : ""}`}
          >
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  disabled={fileUploading}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.multiple = true;
                    input.accept = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";
                    input.onchange = () => handlePatientFileUpload(input.files);
                    input.click();
                  }}
                  type="button"
                >
                  {fileUploading ? "Uploading..." : "Upload"}
                </button>
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  disabled={fileUploading}
                  onClick={() => setScannerOpen(true)}
                  type="button"
                >
                  Scan
                </button>
              </div>
              <Link
                className="text-sm font-semibold text-[var(--brand-primary)] hover:underline"
                href={`/my-files?folder=${encodeURIComponent(patientFolderId)}`}
              >
                View in My Files &rarr;
              </Link>
            </div>

            {emailToast && (
              <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                {emailToast}
              </div>
            )}

            {patientFiles.length === 0 ? (
              <p className={`mt-4 rounded-xl border-2 border-dashed py-6 text-center text-sm transition-colors ${fileDragOver ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-[var(--text-muted)]"}`}>
                {fileDragOver ? "Drop files here to upload" : "No files yet — upload, scan, or drag & drop files here."}
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Size</th>
                      <th className="pb-2 pr-3">Uploaded</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientFiles.map((file) => (
                      <tr
                        className="border-b border-[var(--line-soft)] last:border-0"
                        key={file.id}
                      >
                        <td className="max-w-[260px] py-2.5 pr-3 font-medium">
                          {renamingFileId === file.id ? (
                            <input
                              autoFocus
                              className="w-full rounded border border-[var(--brand-primary)] px-1.5 py-0.5 text-sm focus:outline-none"
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onBlur={commitRenameFile}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRenameFile();
                                if (e.key === "Escape") setRenamingFileId(null);
                              }}
                            />
                          ) : (
                            <span className="truncate block">{file.name}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--text-muted)]">
                          {formatFileSize(file.sizeBytes)}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--text-muted)]">
                          {new Date(file.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            {/* Preview */}
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => handlePatientFilePreview(file)}
                              title="Preview"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                              </svg>
                            </button>
                            {/* Rename */}
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => startRenameFile(file)}
                              title="Rename"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {/* Download */}
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => downloadFile(file.storagePath, file.name)}
                              title="Download"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {/* Email */}
                            <button
                              className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
                              disabled={emailingFileId === file.id}
                              onClick={() => handleEmailPatientFile(file)}
                              title="Email (download + open email)"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <rect height="16" rx="2" width="20" x="2" y="4" />
                                <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {/* Share (mobile only) */}
                            {canShare && (
                              <button
                                className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-40"
                                disabled={sharingFileId === file.id}
                                onClick={() => handleSharePatientFile(file)}
                                title="Share"
                                type="button"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <circle cx="18" cy="5" r="3" />
                                  <circle cx="6" cy="12" r="3" />
                                  <circle cx="18" cy="19" r="3" />
                                  <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" strokeLinecap="round" />
                                </svg>
                              </button>
                            )}
                            {/* Delete */}
                            <button
                              className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 transition-colors"
                              onClick={() => handlePatientFileDelete(file)}
                              title="Delete"
                              type="button"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel-card p-4">
        <button
          className="flex w-full items-center justify-between rounded-2xl bg-[#6db5c8] px-3 py-2 text-center text-3xl font-semibold tracking-[-0.01em] text-white"
          onClick={() => toggleSectionPanel("additionalDetails")}
          type="button"
        >
          <span>Additional Details</span>
          <span className="text-xl">{sectionPanelsOpen.additionalDetails ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.additionalDetails && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Discharge</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setDischargeDate(formatUsDateInput(event.target.value))}
                  placeholder="MM/DD/YYYY"
                  value={dischargeDate}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">R&B Sent</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setRbSentDate(formatUsDateInput(event.target.value))}
                  placeholder="MM/DD/YYYY"
                  value={rbSentDate}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">
                  $ Billed
                  {encounterChargesTotal > 0 && (
                    <span className="ml-1 text-xs font-normal text-emerald-600">(auto)</span>
                  )}
                </span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 tabular-nums"
                  inputMode="decimal"
                  onChange={(event) => setBilledAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0.00"
                  value={billedAmount}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Paid Date</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setPaidDate(formatUsDateInput(event.target.value))}
                  placeholder="MM/DD/YYYY"
                  value={paidDate}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">$ Paid Amount</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setPaidAmount(event.target.value)}
                  placeholder="0.00"
                  type="number"
                  value={paidAmount}
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.8fr_1fr]">
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-4 py-3">
                <dl className="space-y-2 text-sm sm:text-base">
                  <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-baseline gap-x-4">
                    <dt className="font-medium text-[var(--text-muted)]">Initial To Discharge:</dt>
                    <dd className="font-medium tabular-nums text-[var(--text-main)]">{initialToDischarge}</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-baseline gap-x-4">
                    <dt className="font-medium text-[var(--text-muted)]">Discharge To R&amp;B:</dt>
                    <dd className="font-medium tabular-nums text-[var(--text-main)]">{dischargeToRb}</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-baseline gap-x-4">
                    <dt className="font-medium text-[var(--text-muted)]">R&amp;B To Paid:</dt>
                    <dd className="font-medium tabular-nums text-[var(--text-main)]">{rbToPaid}</dd>
                  </div>
                  <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-baseline gap-x-4">
                    <dt className="font-medium text-[var(--text-muted)]">Percentage Paid:</dt>
                    <dd className="font-medium tabular-nums text-[var(--text-main)]">
                      {formatPercentage(percentagePaid)}
                    </dd>
                  </div>
                </dl>
              </div>

              <label className="grid gap-1">
                <span className="text-xl font-semibold">Review?</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-lg font-semibold"
                  onChange={(event) => setReviewStatus(event.target.value)}
                  value={reviewStatus}
                >
                  {reviewOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

          </>
        )}
      </section>

      <div className="panel-card flex flex-wrap items-center justify-between gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 transition-all hover:bg-red-50 active:scale-[0.97] active:shadow-inner"
            onClick={() => { setShowDeleteModal(true); setDeletePasswordInput(""); setDeleteError(""); }}
            type="button"
          >
            Delete Patient
          </button>
          {saveMessage && <p className="text-sm font-semibold text-[var(--brand-primary)]">{saveMessage}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-6 py-2 font-semibold"
            onClick={savePatientFile}
            type="button"
          >
            Update
          </button>
          <button
            className="rounded-xl bg-[#de3a31] px-6 py-2 font-semibold text-white"
            onClick={saveAndClosePatientFile}
            type="button"
          >
            Save &amp; Close
          </button>
        </div>
      </div>

      {showNarrativePromptModal && narrativePromptTemplate && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-8">
            <div className="panel-card mx-auto w-full max-w-3xl overflow-auto p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl font-semibold">Narrative Inputs</h3>
                  <p className="text-sm text-[var(--text-muted)]">{narrativePromptTemplate.name}</p>
                </div>
                <button
                  className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                  onClick={closeNarrativePromptModal}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                {narrativePromptTemplate.prompts.map((prompt) => {
                  const selectedValue = narrativePromptValues[prompt.token] ?? "";
                  const hasOptions = prompt.options.length > 0;
                  return (
                    <article
                      className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3"
                      key={prompt.id}
                    >
                      <p className="text-sm font-semibold">
                        {prompt.label}
                        {prompt.required ? " *" : ""}
                      </p>

                      {hasOptions ? (
                        <div className="mt-2 space-y-2">
                          {prompt.options.map((option) => {
                            const checked = selectedValue === option;
                            return (
                              <button
                                className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                                  checked
                                    ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] text-[var(--brand-primary)]"
                                    : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                                }`}
                                key={`${prompt.id}-${option}`}
                                onClick={() =>
                                  setNarrativePromptValues((current) => ({
                                    ...current,
                                    [prompt.token]: option,
                                  }))
                                }
                                type="button"
                              >
                                {option}
                              </button>
                            );
                          })}
                          <input
                            className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                            onChange={(event) =>
                              setNarrativePromptValues((current) => ({
                                ...current,
                                [prompt.token]: event.target.value,
                              }))
                            }
                            placeholder="Or type custom value"
                            value={selectedValue}
                          />
                        </div>
                      ) : (
                        <input
                          className="mt-2 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                          onChange={(event) =>
                            setNarrativePromptValues((current) => ({
                              ...current,
                              [prompt.token]: event.target.value,
                            }))
                          }
                          placeholder="Enter value"
                          value={selectedValue}
                        />
                      )}
                    </article>
                  );
                })}
              </div>

              {narrativePromptError && (
                <p className="mt-3 text-sm font-semibold text-[#b43b34]">{narrativePromptError}</p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={closeNarrativePromptModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  onClick={continueNarrativeGeneration}
                  type="button"
                >
                  Continue
                </button>
              </div>
            </div>
        </div>
      )}

      {showNarrativePreviewModal && narrativePreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-8">
            <div className="panel-card mx-auto w-full max-w-5xl overflow-auto p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl font-semibold">Narrative Preview</h3>
                  <p className="text-sm text-[var(--text-muted)]">{narrativePreview.title} — click anywhere to edit before printing</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                    onClick={printNarrativePreview}
                    type="button"
                  >
                    Print / Save PDF
                  </button>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                    onClick={closeNarrativePreviewModal}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Attach encounters selector */}
              {patientEncounterRecords.length > 0 && (
                <div className="mb-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Attach Encounters
                      {narrativeAttachedEncounterIds.size > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">
                          ({narrativeAttachedEncounterIds.size} selected — will print before narrative, oldest first)
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                        onClick={() =>
                          setNarrativeAttachedEncounterIds(
                            new Set(patientEncounterRecords.map((e) => e.id)),
                          )
                        }
                        type="button"
                      >
                        All
                      </button>
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                        onClick={() => setNarrativeAttachedEncounterIds(new Set())}
                        type="button"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {[...patientEncounterRecords]
                      .sort(
                        (a, b) =>
                          toSortStampFromUsDate(a.encounterDate) -
                          toSortStampFromUsDate(b.encounterDate),
                      )
                      .map((enc) => (
                        <label
                          key={enc.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white/60 select-none"
                        >
                          <input
                            type="checkbox"
                            className="accent-[var(--brand-primary)]"
                            checked={narrativeAttachedEncounterIds.has(enc.id)}
                            onChange={(e) => {
                              setNarrativeAttachedEncounterIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(enc.id);
                                } else {
                                  next.delete(enc.id);
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="font-medium">{enc.encounterDate}</span>
                          {enc.appointmentType && (
                            <span className="text-xs text-[var(--text-muted)]">• {enc.appointmentType}</span>
                          )}
                          <span className={`text-xs ${enc.signed ? "text-emerald-600" : "text-amber-600"}`}>
                            {enc.signed ? "Signed" : "Open"}
                          </span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {/* Attach billing statement checkbox */}
              <div className="mb-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <label className="flex cursor-pointer items-center gap-2 select-none text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="accent-[var(--brand-primary)]"
                    checked={narrativeAttachBilling}
                    onChange={(e) => setNarrativeAttachBilling(e.target.checked)}
                  />
                  Attach Billing Statement
                  {narrativeAttachBilling && (
                    <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                      (will print after narrative)
                    </span>
                  )}
                </label>
              </div>

              <article className="rounded-xl border border-[var(--line-soft)] bg-white p-6">
                <div
                  ref={narrativeEditableRef}
                  className="narrative-editable-preview space-y-4 whitespace-pre-wrap break-words leading-7 focus:outline-none"
                  contentEditable
                  suppressContentEditableWarning
                  style={{ fontFamily: narrativePreview.fontFamily, minHeight: "500px" }}
                  onBlur={(event) => {
                    if (narrativePrintingRef.current) return;
                    const html = (event.currentTarget as HTMLDivElement).innerHTML;
                    setNarrativePreview((current) =>
                      current ? { ...current, headerHtml: "", bodyHtml: html } : current,
                    );
                  }}
                  dangerouslySetInnerHTML={{
                    __html: [
                      narrativePreview.headerHtml.trim() ? narrativePreview.headerHtml : "",
                      narrativePreview.bodyHtml,
                    ]
                      .filter(Boolean)
                      .join("<br/>"),
                  }}
                />
              </article>
            </div>
        </div>
      )}

      {activeRegionModal && (
        <div className="fixed inset-0 z-40 bg-black/40 p-4">
          <div className="relative h-full w-full">
            <div
              className="panel-card overflow-auto p-4"
              style={getAnchoredModalStyle(regionModalAnchor, 960, 80)}
            >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                {activeRegionModal === "xray" ? "X-Ray Regions" : `${mriStudyLabel} Regions`}
              </h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => {
                  setActiveRegionModal(null);
                  setRegionModalAnchor(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {availableImagingRegions.map((regionEntry) => {
                const region = regionEntry.label;
                const checked = activeImaging.regions.includes(region);
                const flexExt = activeImaging.flexExtRegions.includes(region);
                const laterality = activeImaging.lateralityByRegion[region];
                const supportsLaterality = supportsRegionLaterality(region);
                return (
                  <div
                    key={`${activeRegionModal}-${region}`}
                    className="rounded-xl border border-[var(--line-soft)] bg-white p-2"
                  >
                    <button
                      aria-pressed={checked}
                      className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                        checked
                          ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] text-[var(--brand-primary)]"
                          : "border-[var(--line-soft)] bg-white text-[var(--text-main)] hover:border-[var(--brand-primary)]"
                      }`}
                      onClick={() => {
                        setActiveImaging((current) => {
                          const alreadySelected = current.regions.includes(region);
                          const nextChecked = !alreadySelected;
                          const regions = nextChecked
                            ? [...current.regions, region]
                            : current.regions.filter((entry) => entry !== region);
                          const flexExtRegions = nextChecked
                            ? current.flexExtRegions
                            : current.flexExtRegions.filter((entry) => entry !== region);
                          const lateralityByRegion = { ...current.lateralityByRegion };
                          if (nextChecked && supportsRegionLaterality(region) && !lateralityByRegion[region]) {
                            lateralityByRegion[region] = "BL";
                          }
                          if (!nextChecked) {
                            delete lateralityByRegion[region];
                          }
                          return {
                            ...current,
                            regions,
                            lateralityByRegion,
                            flexExtRegions,
                          };
                        });
                      }}
                      type="button"
                    >
                      <span>{region}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${
                          checked
                            ? "bg-[var(--brand-primary)] text-white"
                            : "bg-[var(--bg-soft)] text-[var(--text-muted)]"
                        }`}
                      >
                        {checked ? "Selected" : "Tap"}
                      </span>
                    </button>

                    {activeRegionModal === "xray" && supportsXrayFlexExt(region) && (
                      <button
                        aria-pressed={flexExt}
                        className={`mt-2 flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                          !checked
                            ? "cursor-not-allowed border-[var(--line-soft)] bg-[var(--bg-soft)] text-[var(--text-muted)] opacity-70"
                            : flexExt
                              ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] text-[var(--brand-primary)]"
                              : "border-[var(--line-soft)] bg-white text-[var(--text-main)] hover:border-[var(--brand-primary)]"
                        }`}
                        disabled={!checked}
                        onClick={() => {
                          setActiveImaging((current) => {
                            if (!current.regions.includes(region)) {
                              return current;
                            }
                            const hasFlexExt = current.flexExtRegions.includes(region);
                            return {
                              ...current,
                              flexExtRegions: hasFlexExt
                                ? current.flexExtRegions.filter((entry) => entry !== region)
                                : [...current.flexExtRegions, region],
                            };
                          });
                        }}
                        type="button"
                      >
                        <span>Flex/Ext</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${
                            checked && flexExt
                              ? "bg-[var(--brand-primary)] text-white"
                              : "bg-[var(--bg-soft)] text-[var(--text-muted)]"
                          }`}
                        >
                          {flexExt ? "On" : "Off"}
                        </span>
                      </button>
                    )}

                    {checked && supportsLaterality && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-1">
                        {lateralityOptions.map((option) => (
                          <button
                            key={`${region}-lat-${option}`}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              laterality === option
                                ? "bg-[var(--brand-primary)] text-white"
                                : "bg-white text-[var(--text-main)]"
                            }`}
                            onClick={() =>
                              setActiveImaging((current) => {
                                if (!current.regions.includes(region)) {
                                  return current;
                                }
                                return {
                                  ...current,
                                  lateralityByRegion: {
                                    ...current.lateralityByRegion,
                                    [region]: option,
                                  },
                                };
                              })
                            }
                            type="button"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>
      )}

      {showQuickTaskModal && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <form className="panel-card p-4" style={getAnchoredModalStyle(quickTaskAnchor, 680, 60)} onSubmit={(e) => { e.preventDefault(); saveQuickTask(); }}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xl font-semibold">Quick Add To Do</h3>
                <button
                  className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                  onClick={closeQuickTaskModal}
                  type="button"
                >
                  Close
                </button>
              </div>

              <p className="mb-3 text-sm text-[var(--text-muted)]">
                Add a task while working in this patient file. It will appear in <span className="font-semibold">To Do</span>.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Task</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => setQuickTaskTitle(event.target.value)}
                    placeholder="Task title"
                    value={quickTaskTitle}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Priority</span>
                  <select
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) => setQuickTaskPriority(event.target.value as TaskPriority)}
                    value={quickTaskPriority}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Due Date (optional)</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) => setQuickTaskDueDate(formatUsDateInput(event.target.value))}
                    placeholder="MM/DD/YYYY"
                    value={quickTaskDueDate}
                  />
                </label>
              </div>

              {quickTaskModalMessage && (
                <p className="mt-3 text-sm font-semibold text-[#b43b34]">{quickTaskModalMessage}</p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={closeQuickTaskModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  type="submit"
                >
                  Add To Do
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddAttorneyPrompt && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <div className="panel-card p-4" style={getAnchoredModalStyle(attorneyPromptAnchor, 560, 50)}>
            <h3 className="text-xl font-semibold">Add New Attorney?</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {attorney.trim()} is not in Contacts. Do you want to add this attorney now?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={dismissAttorneyPrompt}
                type="button"
              >
                No
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={(event) => openAttorneyForm(event)}
                type="button"
              >
                Yes
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {showAddAttorneyForm && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <form className="panel-card overflow-auto p-4" style={getAnchoredModalStyle(attorneyFormAnchor, 960, 85)} onSubmit={(e) => { e.preventDefault(); saveAttorneyContact(); }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xl font-semibold">Add New Attorney</h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => {
                  setShowAddAttorneyForm(false);
                  setAttorneyModalError("");
                  setAttorneyFormAnchor(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney Name</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setNewAttorneyDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  value={newAttorneyDraft.name}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Phone Number</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) =>
                    setNewAttorneyDraft((current) => ({
                      ...current,
                      phone: formatUsPhoneInput(event.target.value),
                    }))
                  }
                  value={newAttorneyDraft.phone}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Fax Number</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) =>
                    setNewAttorneyDraft((current) => ({
                      ...current,
                      fax: formatUsPhoneInput(event.target.value),
                    }))
                  }
                  value={newAttorneyDraft.fax}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Email Address</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setNewAttorneyDraft((current) => ({ ...current, email: event.target.value }))
                  }
                  value={newAttorneyDraft.email}
                />
              </label>
              <div className="md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Address</span>
                <div className="mt-1">
                  <AddressFieldGroup
                    onChange={(nextAddress) =>
                      setNewAttorneyDraft((current) => ({ ...current, address: nextAddress }))
                    }
                    value={newAttorneyDraft.address}
                  />
                </div>
              </div>
            </div>

            {attorneyModalError && (
              <p className="mt-3 text-sm font-semibold text-[#b43b34]">{attorneyModalError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => {
                  setShowAddAttorneyForm(false);
                  setAttorneyModalError("");
                  setAttorneyFormAnchor(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                type="submit"
              >
                Save Attorney
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {editingSpecialist && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <form className="panel-card p-4" style={getAnchoredModalStyle(specialistEditorAnchor, 760, 75)} onSubmit={(e) => { e.preventDefault(); saveSpecialistEditor(); }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Edit Specialist Referral</h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => {
                  setEditingSpecialist(null);
                  setSpecialistEditorAnchor(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Specialist</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  list="specialist-contacts"
                  onChange={(event) =>
                    setEditingSpecialist((current) =>
                      current ? { ...current, specialist: event.target.value } : current,
                    )
                  }
                  value={editingSpecialist.specialist}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Sent Date</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingSpecialist((current) =>
                        current
                          ? { ...current, sentDate: formatUsDateInput(event.target.value) }
                          : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingSpecialist.sentDate}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Scheduled Date</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingSpecialist((current) =>
                        current
                          ? { ...current, scheduledDate: formatUsDateInput(event.target.value) }
                          : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingSpecialist.scheduledDate}
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Completed</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingSpecialist((current) =>
                        current
                          ? { ...current, completedDate: formatUsDateInput(event.target.value) }
                          : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingSpecialist.completedDate ?? ""}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Received</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingSpecialist((current) =>
                        current
                          ? { ...current, reportReceivedDate: formatUsDateInput(event.target.value) }
                          : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingSpecialist.reportReceivedDate}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Reviewed</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingSpecialist((current) =>
                        current
                          ? { ...current, reportReviewedDate: formatUsDateInput(event.target.value) }
                          : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingSpecialist.reportReviewedDate ?? ""}
                  />
                </label>
              </div>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Recommendations</span>
                <textarea
                  className="min-h-[140px] w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setEditingSpecialist((current) =>
                      current ? { ...current, recommendations: event.target.value } : current,
                    )
                  }
                  placeholder="Enter specialist recommendations..."
                  value={editingSpecialist.recommendations}
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => {
                  setEditingSpecialist(null);
                  setSpecialistEditorAnchor(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                type="submit"
              >
                Save Specialist
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {editingImagingReferral && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <form className="panel-card p-4" style={getAnchoredModalStyle(imagingEditorAnchor, 760, 75)} onSubmit={(e) => { e.preventDefault(); saveImagingEditor(); }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                Edit {editingImagingReferral.modalityLabel} Referral
              </h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => {
                  setEditingImagingReferral(null);
                  setImagingEditorAnchor(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Sent Date</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, sentDate: formatUsDateInput(event.target.value) } : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingImagingReferral.sentDate}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Imaging Center</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    list="imaging-centers"
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, center: event.target.value } : current,
                      )
                    }
                    value={editingImagingReferral.center}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Scheduled Date</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, scheduledDate: formatUsDateInput(event.target.value) } : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingImagingReferral.scheduledDate ?? ""}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Completed</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, doneDate: formatUsDateInput(event.target.value) } : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingImagingReferral.doneDate}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Report Received</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, reportReceivedDate: formatUsDateInput(event.target.value) } : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingImagingReferral.reportReceivedDate}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Report Reviewed</span>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={10}
                    onChange={(event) =>
                      setEditingImagingReferral((current) =>
                        current ? { ...current, reportReviewedDate: formatUsDateInput(event.target.value) } : current,
                      )
                    }
                    placeholder="MM/DD/YYYY"
                    value={editingImagingReferral.reportReviewedDate}
                  />
                </label>
              </div>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Findings</span>
                <textarea
                  className="min-h-[160px] w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setEditingImagingReferral((current) =>
                      current ? { ...current, findings: event.target.value } : current,
                    )
                  }
                  placeholder={`Enter ${editingImagingReferral.modalityLabel} findings...`}
                  value={editingImagingReferral.findings}
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => {
                  setEditingImagingReferral(null);
                  setImagingEditorAnchor(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                type="submit"
              >
                Save {editingImagingReferral.modalityLabel}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}

      {relatedCaseNavigateTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4">
          <div className="relative h-full w-full">
            <div className="panel-card p-4" style={getAnchoredModalStyle(relatedCaseNavigateAnchor, 560, 50)}>
              <h3 className="text-xl font-semibold">Navigate to patient file?</h3>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Open <span className="font-semibold text-[var(--text-main)]">{relatedCaseNavigateTarget.fullName}</span> now?
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                  onClick={closeRelatedCaseNavigatePrompt}
                  type="button"
                >
                  No
                </button>
                <button
                  className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                  onClick={confirmRelatedCaseNavigation}
                  type="button"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <datalist id="imaging-centers">
        {imagingCenters.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="attorney-contacts">
        {attorneyContacts.map((contact) => (
          <option key={contact.id} value={contact.name} />
        ))}
      </datalist>
      <datalist id="specialist-contacts">
        {specialistContacts.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <NewAppointmentModal
        lockedPatientId={patient.id}
        onClose={() => setShowScheduleModal(false)}
        onSaved={handleNewAppointmentSaved}
        open={showScheduleModal}
      />

      <RescheduleAppointmentModal
        appointment={rescheduleTargetAppointment}
        onClose={() => setRescheduleAppointmentId(null)}
        onRescheduled={(_oldAppointment, newAppointment) => {
          setEncounterMessage(
            `Rescheduled to ${toUsDate(newAppointment.date)}.`,
          );
        }}
        open={Boolean(rescheduleTargetAppointment)}
      />

      <EditAppointmentModal
        appointment={editTargetAppointment}
        onClose={() => setEditAppointmentId(null)}
        onSaved={(updated) => {
          setEncounterMessage(
            `Appointment updated for ${toUsDate(updated.date)} at ${formatTimeLabel(updated.startTime)}.`,
          );
        }}
        open={Boolean(editTargetAppointment)}
      />

      <DocumentScannerModal
        onCapture={(file) => {
          const dt = new DataTransfer();
          dt.items.add(file);
          handlePatientFileUpload(dt.files);
        }}
        onClose={() => setScannerOpen(false)}
        open={scannerOpen}
      />

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8">
          <div className="panel-card mx-auto w-full max-w-md p-5">
            <h3 className="text-xl font-semibold text-red-600">Delete Patient</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              You are about to permanently delete{" "}
              <span className="font-semibold text-[var(--text-main)]">{patient.fullName}</span>.
              This action cannot be undone.
            </p>
            <label className="mt-4 grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Enter Delete Password</span>
              <input
                autoFocus
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(e) => { setDeletePasswordInput(e.target.value); setDeleteError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleDeletePatient(); } }}
                placeholder="Password"
                type="password"
                value={deletePasswordInput}
              />
            </label>
            {deleteError && (
              <p className="mt-2 text-sm font-semibold text-red-600">{deleteError}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => { setShowDeleteModal(false); setDeletePasswordInput(""); setDeleteError(""); }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={handleDeletePatient}
                type="button"
              >
                Delete Patient
              </button>
            </div>
          </div>
        </div>
      )}

      <ContactGapPrompt gap={contactGap} onClose={() => setContactGap(null)} />
    </div>
  );
}

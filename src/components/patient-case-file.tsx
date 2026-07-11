"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ContactGapPrompt, findContactByName, type ContactGap } from "@/components/contact-gap-prompt";
import { ScrollLock } from "@/components/scroll-lock";
import { downloadVCard } from "@/lib/vcard";
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
import { useReportTemplates } from "@/hooks/use-report-templates";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useKeyDates } from "@/hooks/use-key-dates";
import { findClosedKeyDateForDate } from "@/lib/key-dates";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { filterAppointmentTypesForPatient } from "@/lib/schedule-appointment-types";
import { useTasks } from "@/hooks/use-tasks";
import { getContrastTextColor, withAlpha } from "@/lib/color-utils";
import { getFormalTitle } from "@/lib/honorifics";
import { loadPatientPagePrefs } from "@/lib/patient-page-prefs";
import {
  getDocumentTemplatePromptIds,
  humanizeTemplatePromptId,
  renderDocumentTemplate,
  type DocumentTemplateScope,
} from "@/lib/document-templates";
import {
  applyLabelValueHangingIndent,
  stripHtmlIndentation,
} from "@/lib/document-html-layout";
import { createEncounterMacroRunId, encounterSections } from "@/lib/encounter-notes";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { buildNarrativeReportContext, renderNarrativeReportBody } from "@/lib/report-generator";
import {
  appointmentStatusOptions,
  formatAppointmentStatusLabel,
  formatTimeLabel,
  getStatusBadgeClass,
  isAppointmentStatusSelectable,
  parseTimeFlexible,
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
import { PatientPackagesSection } from "@/components/patient-packages-section";
import { useCashPayments } from "@/hooks/use-cash-payments";
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
  healRelatedCaseLinks,
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
  /** Per-referral outcome flag. Set when the patient was sent for
   *  imaging but never went — refused at home, no-showed, etc. The
   *  Case Flow stops chasing a Done date for this entry, and the
   *  patient's imaging list shows a "Patient Refused" badge. Default
   *  undefined / false = open referral, follow up normally. */
  patientRefused?: boolean;
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
  /** Per-referral outcome flag — patient was referred but never
   *  attended the consult. Stops Case Flow from chasing a completion
   *  date and shows a "Patient Refused" badge in the patient file. */
  patientRefused?: boolean;
  /** When true, generating this specialist's referral PDF feeds the
   *  current X-ray + MRI/CT findings into the template context. When
   *  false (default), XRAY_FINDINGS / MRI_CT_FINDINGS resolve to
   *  empty so the template author can {{#if}} those sections out
   *  cleanly. Per-referral toggle so a primary-care follow-up
   *  letter doesn't have to include the spine imaging, while an
   *  orthopedic referral can. */
  includeImagingFindings?: boolean;
  /** Which imaging findings to feed into this referral's PDF:
   *  "both" (XR/MR), "mri" (MR only), "xray" (XR only), or "none"
   *  (default). Supersedes the legacy includeImagingFindings boolean,
   *  which maps to "both" when true / "none" when false. Lets a referral
   *  include only the imaging the patient actually has. */
  imagingFindingsMode?: "none" | "both" | "mri" | "xray";
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

// reviewOptions used to be a hardcoded module-level constant. Now
// pulled from useCaseStatuses so the user can manage their own list
// in Settings → Case Statuses (parallel to lienOptions).

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

/**
 * Convert a region + laterality into a friendly header line for the
 * findings textarea template: "Left Knee" / "Right Shoulder" /
 * "Bilateral Hip" / "Cervical" (no laterality on non-lateralizable
 * regions). Distinct from formatRegionLabel which formats the
 * compact "Knee (L)" style used in chips and summary text.
 */
function formatRegionHeaderForFindings(
  region: string,
  lateralityByRegion: Record<string, ImagingLaterality>,
): string {
  if (!supportsRegionLaterality(region)) return region;
  const laterality = lateralityByRegion[region];
  if (!laterality) return region;
  if (laterality === "L") return `Left ${region}`;
  if (laterality === "R") return `Right ${region}`;
  if (laterality === "BL") return `Bilateral ${region}`;
  return region;
}

/**
 * Build a blank findings template, one labeled section per region.
 * Two blank lines between sections so the user has room to paste
 * the radiologist's prose under each header.
 */
function buildFindingsTemplate(
  regions: string[],
  lateralityByRegion: Record<string, ImagingLaterality>,
): string {
  if (regions.length === 0) return "";
  return regions
    .map((region) => `${formatRegionHeaderForFindings(region, lateralityByRegion)}:\n\n`)
    .join("\n");
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
  options: { resizable?: boolean } = {},
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

  // For resizable modals (Imaging Findings / Specialist Recommendations
  // editors) we use minWidth instead of width so the user-applied inline
  // width from the bottom-right resize handle isn't clobbered on every
  // React re-render. Same for height: minHeight instead of maxHeight.
  if (options.resizable) {
    return {
      position: "absolute",
      left,
      top,
      minWidth: width,
      minHeight: Math.min(maxHeight, 480),
      maxHeight: "calc(100vh - 32px)",
      maxWidth: viewportWidth - margin * 2,
    };
  }

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

// stripHtmlIndentation and applyLabelValueHangingIndent now live in
// src/lib/document-html-layout.ts so the settings preview and the
// generated PDF both apply the same label/value layout.

function buildPrintableDocumentHtml(config: PrintableDocumentConfig) {
  const { title, headerHtml, fontFamily, includeLogo, logoDataUrl } = config;
  const bodyHtml = applyLabelValueHangingIndent(stripHtmlIndentation(config.bodyHtml));
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
      /* Reset most structural elements inside .content, BUT NOT our
         own .kv / .kv-cont divs (they depend on padding/margin rules
         defined further down). */
      .content section, .content article, .content aside,
      .content details, .content summary, .content figure, .content figcaption,
      .content dl, .content dt, .content dd, .content blockquote, .content pre,
      .content fieldset, .content legend, .content nav, .content footer, .content header,
      .content div:not(.kv):not(.kv-cont) {
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
        /* overflow-wrap only breaks words that literally can't fit on
           a line. word-break: normal keeps whole words together. And
           hyphens: none stops &shy; soft-hyphens that get pasted in
           from PDFs from breaking words mid-character. */
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: none;
        -webkit-hyphens: none;
        font-family: ${safeFontFamily};
        font-size: 14px;
        line-height: 1.6;
      }
      /* Label + value rows. applyLabelValueHangingIndent converts:
           <p>Label:   value</p>
         into:
           <div class="kv"><span class="kv-label">Label:</span><span class="kv-value">value</span></div>
         and subsequent orphan paragraphs into <div class="kv-cont">.

         Layout approach: FIXED label column (170px) with hanging
         indent, so every row's value starts at the same x-position
         and wrapped value lines sit under themselves. No grid —
         grids stack rows independently and can't align multi-line
         continuations with the first row's label column. */
      .content .kv,
      .content .kv-cont {
        margin: 0 0 4px 0;
        padding: 0 0 0 170px;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: none;
        -webkit-hyphens: none;
      }
      .content .kv {
        /* Pull line 1 back by the label-column width so the label
           appears at x=0. Wrapped value lines stay at 170px. */
        text-indent: -170px;
      }
      .content .kv-cont {
        /* Continuation lines are fully in the value column (no pull-back). */
        text-indent: 0;
      }
      .content .kv-label {
        display: inline-block;
        width: 170px;
        vertical-align: top;
        font-weight: inherit;
        text-indent: 0;
      }
      .content .kv-value {
        /* Inline — wraps inside the available width after the label. */
        text-indent: 0;
      }
      .header {
        flex: 1;
        text-align: left;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        word-break: normal;
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
  const { caseStatuses, lienLabel, lienOptions, reviewOptions } = useCaseStatuses();
  const {
    billingMacros,
    addDiagnosis: addLibraryDiagnosis,
  } = useBillingMacros();
  const { contacts, addContact } = useContactDirectory();
  const { documentTemplates } = useDocumentTemplates();
  const { reportTemplates } = useReportTemplates();
  const { getRecord: getPatientBillingRecord, setCoreFields: setPatientBillingCoreFields } = usePatientBilling();
  const { scheduleAppointments, updateAppointment, removeAppointment } = useScheduleAppointments();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { keyDates } = useKeyDates();
  const { tasks, addTask, toggleTaskDone } = useTasks();
  // patientFlowItems moved below usePatientFollowUpOverrides so overrides are available
  const patientTasks = useMemo(
    () => tasks.filter((task) => task.patientId === patient.id),
    [tasks, patient.id],
  );
  const { encountersByNewest, createEncounter, setSoapSection, addMacroRun, addCharge, deleteEncounter } = useEncounterNotes();
  // Pulled in so encounter deletes cascade to the linked cash payment
  // entries — otherwise the entry orphans (encounterId pointing to a
  // deleted encounter) and silently inflates Cash Payments totals.
  const { updatePatientPayments: cascadeCashPaymentsOnEncounterDelete } = useCashPayments();
  const { macroLibrary } = useMacroTemplates();
  const { entries: patientDiagnoses, addDiagnosis, addBulkDiagnoses, removeDiagnosis, reorderDiagnoses } = usePatientDiagnoses(patient.id);
  const {
    recordsByPatientId: followUpOverridesByPatientId,
    getRecord: getPatientFollowUpOverride,
    setPatientRefusedAsync,
    setCompletedPriorCareAsync,
    setNotNeededAsync,
  } = usePatientFollowUpOverrides();
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
  const [showImagingRegionEditor, setShowImagingRegionEditor] = useState(false);

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
      patientRefused: raw.patientRefused === true,
      includeImagingFindings: raw.includeImagingFindings === true,
      imagingFindingsMode:
        raw.imagingFindingsMode === "both" ||
        raw.imagingFindingsMode === "mri" ||
        raw.imagingFindingsMode === "xray"
          ? raw.imagingFindingsMode
          : raw.includeImagingFindings === true
            ? "both"
            : "none",
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
  // Initial open state is sourced from Settings → Patient Page →
  // Default Open Sections. The user picks once (e.g. "Notes always
  // open") and every patient file honors it. Local toggles after
  // mount still work normally — the preference only seeds the
  // starting state, not subsequent expand/collapse.
  const [sectionPanelsOpen, setSectionPanelsOpen] = useState<Record<SectionPanelKey, boolean>>(() => {
    const prefs = loadPatientPagePrefs().defaultOpen;
    return {
      notes: Boolean(prefs.notes),
      reExam: Boolean(prefs.reExam),
      relatedCases: Boolean(prefs.relatedCases),
      appointments: Boolean(prefs.appointments),
      diagnosis: Boolean(prefs.diagnosis),
      letters: Boolean(prefs.letters),
      narrative: Boolean(prefs.narrative),
      patientFiles: Boolean(prefs.patientFiles),
      additionalDetails: Boolean(prefs.additionalDetails),
    };
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

  // Heal one-way related-case links on patient page mount. Legacy
  // data from before bidirectional sync landed could have John linked
  // to Jane without Jane linked back; healRelatedCaseLinks walks every
  // patient and adds the missing reverse link wherever one is found.
  // Idempotent, so the second mount through this effect on the same
  // session is a near-instant no-op. After heal, refresh this
  // patient's local relatedCases state from the now-correct global
  // store so the new reverse links show up in the UI immediately.
  useEffect(() => {
    const healed = healRelatedCaseLinks();
    if (healed === 0) return;
    const refreshed = allPatients.find((p) => p.id === patient.id);
    if (!refreshed?.relatedCases) return;
    setRelatedCases(
      refreshed.relatedCases.map((entry) => ({
        patientId: entry.patientId,
        fullName: entry.fullName,
        dateOfLoss: entry.dateOfLoss,
      })),
    );
    // patient.id is intentionally the only dep — re-running heal on
    // every render would be wasted work even with the idempotency
    // guard. eslint-disable-next-line is for the setRelatedCases ref.
  }, [patient.id]);

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
  // Show the money fields as currency ($5,000.00) when not being edited,
  // and raw digits while focused so typing stays simple. State stays raw
  // (parseable) either way.
  const [billedFocused, setBilledFocused] = useState(false);
  const [paidFocused, setPaidFocused] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(patient.matrix?.review || "Not Requested");
  const [diagnosisMacroIdDraft, setDiagnosisMacroIdDraft] = useState("");
  // "+ Dx Code" quick-add: creates a new ICD-10 code in the library
  // (folder-placed, like Settings) and drops it on this patient.
  const [showAddDxModal, setShowAddDxModal] = useState(false);
  const [dxCode, setDxCode] = useState("");
  const [dxDescription, setDxDescription] = useState("");
  const [dxFolderId, setDxFolderId] = useState("");
  const [dxError, setDxError] = useState("");
  const [diagnosisBundleIdDraft, setDiagnosisBundleIdDraft] = useState("");
  const [diagnosisMessage, setDiagnosisMessage] = useState("");
  // Modal state for "+ Add Custom Code" — adds the dx to the master
  // library AND attaches it to the current patient + any selected
  // bundles in one shot.
  const [letterTemplateIdDraft, setLetterTemplateIdDraft] = useState("");
  const [letterMessage, setLetterMessage] = useState("");
  // Runtime prompts for document templates. When a letter / referral
  // / imaging template contains [[prompt_id]] tokens, the user gets a
  // modal asking for each value before the PDF is generated. Use case:
  // a subpoena invoice needs "Work Order Number"; a school excuse note
  // needs "Days Off". Same mental model as the SOAP-macro [[prompts]]
  // but a generic one-shot text input — no per-template schema.
  const [docPromptState, setDocPromptState] = useState<{
    title: string;
    promptIds: string[];
    answers: Record<string, string>;
    onSubmit: (answers: Record<string, string>) => void;
  } | null>(null);
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
  // Discrete save lifecycle so the UI can render the right pill
  // colour. "idle" = nothing recent. "saving" = sync in flight.
  // "saved" = success (auto-fades to idle after a few seconds).
  // "error" = failure that the user MUST notice (sticky).
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
  // Sort state for the Patient Files table. Default is date-desc
  // (newest first) which matches the historical behavior. Click a
  // column header to switch — clicking the active column flips
  // the direction, clicking a different column resets to that
  // column's natural default (name = asc, date = desc).
  const [patientFilesSort, setPatientFilesSort] = useState<{
    column: "name" | "date";
    asc: boolean;
  }>({ column: "date", asc: false });

  const patientFiles = useMemo(() => {
    const collectFiles = (folderId: string): FileRecord[] => {
      const files = getFilesInFolder(fileManagerState, folderId);
      const subFolders = getFoldersInParent(fileManagerState, folderId);
      for (const sub of subFolders) {
        files.push(...collectFiles(sub.id));
      }
      return files;
    };
    const all = collectFiles(patientFolderId);
    const direction = patientFilesSort.asc ? 1 : -1;
    return all.sort((a, b) => {
      let primary = 0;
      if (patientFilesSort.column === "name") {
        primary = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else {
        primary = a.createdAt.localeCompare(b.createdAt);
      }
      if (primary !== 0) return direction * primary;
      // Tiebreaker — name asc — so within the same date or same
      // name the order is stable and predictable.
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [fileManagerState, patientFolderId, patientFilesSort]);

  /** Click handler for sortable table headers — flips direction
   *  on the active column, switches column otherwise. */
  const togglePatientFilesSort = useCallback((column: "name" | "date") => {
    setPatientFilesSort((current) => {
      if (current.column === column) {
        return { column, asc: !current.asc };
      }
      // Natural default per column: names alphabetical, dates
      // newest-first.
      return { column, asc: column === "name" };
    });
  }, []);

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
  // FINDINGS tokens are intended to be just the radiologist's prose
  // for the letter body — no dates, no modality prefix. Letters that
  // need the dated context already have XRAY_SUMMARY / MRI_CT_SUMMARY
  // (see report-generator.ts), which include the completed date plus
  // modality + regions.
  //
  // Per-referral disposition: a referral can be in three states:
  //   - Has findings text → use the text directly (no header so the
  //     simple single-referral case reads cleanly).
  //   - Marked Patient Refused → show "[Region(s)]: Patient refused"
  //     so the letter explicitly conveys WHY there's no report,
  //     instead of the previous silent fallback to "-".
  //   - Neither → skip (no info to convey).
  //
  // For multi-referral cases blocks are separated by blank lines so
  // each entry stays readable. Falls back to the legacy global
  // findings field, then "-" if truly empty.
  const buildFindingsString = useCallback(
    (referrals: ImagingReferral[], mode: ImagingMode) => {
      const blocks: string[] = [];
      for (const referral of referrals) {
        const text = referral.findings?.trim();
        if (text) {
          blocks.push(text);
          continue;
        }
        if (referral.patientRefused) {
          const regions =
            referral.regions.length > 0
              ? referral.regions
                  .map((region) => formatRegionLabel(region, referral.lateralityByRegion))
                  .join(", ")
              : referral.modalityLabel;
          blocks.push(`${regions}: Patient refused`);
        }
      }
      return blocks.join("\n\n");
    },
    [],
  );
  const xrayFindingsForTemplates = useMemo(() => {
    const built = buildFindingsString(xrayReferrals, "xray");
    if (built) return built;
    const legacy = xrayFindings.trim();
    if (legacy) return legacy;
    return "-";
  }, [xrayReferrals, xrayFindings, buildFindingsString]);
  const mriCtFindingsForTemplates = useMemo(() => {
    const built = buildFindingsString(mriReferrals, "mri");
    if (built) return built;
    const legacy = mriCtFindings.trim();
    if (legacy) return legacy;
    return "-";
  }, [mriReferrals, mriCtFindings, buildFindingsString]);
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

  // Orphan-value preserver for the Review? dropdown. If the current
  // patient.matrix.review string doesn't match any reviewOption (could
  // happen after a rename if the user had an old value, or for an
  // imported legacy patient), prepend it so the select still shows
  // the right thing instead of silently defaulting to the first option.
  const reviewSelectOptions = useMemo(() => {
    const fallback = reviewOptions[0] ?? "Not Requested";
    const current = reviewStatus.trim() || fallback;
    const normalized = current.toLowerCase();
    const hasCurrent = reviewOptions.some(
      (option) => option.trim().toLowerCase() === normalized,
    );
    return hasCurrent ? reviewOptions : [current, ...reviewOptions];
  }, [reviewOptions, reviewStatus]);

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

  // Auto-fill the Discharge date when the case moves to a closed
  // status (Discharged / Settled / Reduced / etc.) and the user
  // hasn't already entered one. The most-recent encounter date is the
  // sensible default — that's the actual last visit on file.
  //
  // Once we auto-fill (or detect a manual value at close-time), we
  // flip a ref and never auto-fill again on this mount, so a manual
  // clear / edit from the user always wins. Reloading the patient
  // file resets the ref and we re-evaluate.
  const dischargeAutoFilledRef = useRef(false);
  useEffect(() => {
    if (dischargeAutoFilledRef.current) return;
    if (!caseStatus.trim()) return;
    const closedConfig = caseStatuses.find(
      (s) =>
        s.name.toLowerCase() === caseStatus.toLowerCase() && s.isCaseClosed,
    );
    if (!closedConfig) return;
    // If the user already typed a discharge date, respect it — but
    // mark as handled so a later state churn doesn't try to clobber.
    if (dischargeDate.trim()) {
      dischargeAutoFilledRef.current = true;
      return;
    }
    const mostRecentEncounterDate = patientEncounterRecords[0]?.encounterDate;
    if (!mostRecentEncounterDate) return;
    setDischargeDate(mostRecentEncounterDate);
    dischargeAutoFilledRef.current = true;
  }, [caseStatus, caseStatuses, dischargeDate, patientEncounterRecords]);
  // openPatientEncounterRecords memo used to live here for the
  // "Open Encounters" sidebar inside Appointments / Encounters. The
  // sidebar was removed per user request — open encounters surface in
  // the table's Encounter column anyway via linkedEncounter, so the
  // dedicated panel was redundant.

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
      // Index encounters two ways so the join can prefer the durable
      // appointmentId match (set on creation) and only fall back to
      // date+type for legacy encounters that pre-date that field.
      const encounterByAppointmentId = new Map<string, (typeof patientEncounterRecords)[number]>();
      const encounterByDateType = new Map<string, (typeof patientEncounterRecords)[number]>();
      patientEncounterRecords.forEach((encounter) => {
        if (encounter.appointmentId && !encounterByAppointmentId.has(encounter.appointmentId)) {
          encounterByAppointmentId.set(encounter.appointmentId, encounter);
        }
        const key = `${encounter.encounterDate}|${normalizeLookupValue(encounter.appointmentType)}`;
        if (!encounterByDateType.has(key)) {
          encounterByDateType.set(key, encounter);
        }
      });

      patientAppointmentRecords.forEach((appointment) => {
        const appointmentDate = toUsDate(appointment.date);
        // Priority order: appointmentId → date+type → date-only.
        // The id match means the link survives type / date edits and
        // any cloud-sync race where the appointment momentarily
        // disappears and reappears (the encounter doesn't orphan as
        // long as the appointment id is the same when it comes back).
        const idMatch = encounterByAppointmentId.get(appointment.id) ?? null;
        const exactTypeMatch =
          idMatch ??
          encounterByDateType.get(
            `${appointmentDate}|${normalizeLookupValue(appointment.appointmentType)}`,
          ) ??
          null;
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
  const scheduledCount = useMemo(
    () => patientAppointmentRecords.filter((entry) => entry.status === "Scheduled").length,
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
  // Quick Stats box used to live here — removed from the patient page
  // per user request. The corresponding Settings → Quick Stats panel
  // is left in place for other consumers (dashboard, etc.) but the
  // patient-page rollup no longer renders.

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
    // {{MR_MRS_MS_*}} tokens. getFormalTitle is the single source of
    // truth — see src/lib/honorifics.ts for the rule table.
    const formalTitle = getFormalTitle(patientSex, maritalStatus);
    const titleLast = lastName.trim() ? `${formalTitle} ${lastName.trim()}` : formalTitle;
    const titleFull = patientFullName ? `${formalTitle} ${patientFullName}` : formalTitle;
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
      MR_MRS_MS_LAST_NAME: titleLast,
      MR_MRS_MS_FULL_NAME: titleFull,
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
    // Keep the region chip grid collapsed on first open — most edits
    // are date / findings tweaks and the chip row takes a lot of space.
    setShowImagingRegionEditor(false);
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

    // Persist immediately to localStorage.
    //
    // Also recompute the matrix.{mode}Sent/Done/Received/Reviewed
    // fields from the REMAINING referrals. Without this, the matrix
    // kept the deleted entry's dates and Case Flow (which reads
    // matrix.xraySent / mriSent directly) kept reporting "Sent,
    // waiting for done date" on a patient whose X-Ray / MRI list was
    // visibly empty. If any referrals remain we mirror the most
    // recently-sent one (matches the "overwrite on add/edit"
    // behaviour); if none remain we clear the matrix fields.
    const key = mode === "xray" ? "xrayReferrals" : "mriReferrals";
    const primary = [...nextReferrals].sort((a, b) => {
      const aIso = toIsoDateFromUsDate(a.sentDate) || "";
      const bIso = toIsoDateFromUsDate(b.sentDate) || "";
      return bIso.localeCompare(aIso);
    })[0];
    const sentDateIso = primary ? toIsoDateFromUsDate(primary.sentDate) : "";
    const scheduledDateIso = primary ? toIsoDateFromUsDate(primary.scheduledDate ?? "") : "";
    const doneDateIso = primary ? toIsoDateFromUsDate(primary.doneDate ?? "") : "";
    const receivedDateIso = primary ? toIsoDateFromUsDate(primary.reportReceivedDate ?? "") : "";
    const reviewedDateIso = primary ? toIsoDateFromUsDate(primary.reportReviewedDate ?? "") : "";
    const matrixFields =
      mode === "xray"
        ? {
            xraySent: sentDateIso,
            xrayDone: doneDateIso,
            xrayReceived: receivedDateIso,
            xrayReviewed: reviewedDateIso,
          }
        : {
            mriSent: sentDateIso,
            mriScheduled: scheduledDateIso,
            mriDone: doneDateIso,
            mriReceived: receivedDateIso,
            mriReviewed: reviewedDateIso,
          };

    updatePatientRecordById(patient.id, {
      lastUpdate: new Date().toISOString().slice(0, 10),
      [key]: nextReferrals,
      matrix: matrixFields,
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
    const nextSpecialists = [...specialistReferrals, newItem];
    setSpecialistReferrals(nextSpecialists);
    setSpecialistDraft({
      specialist: "",
      sentDate: "",
    });
    setSpecialistMessage(`${specialistName} added. Use Edit to update scheduling/report status.`);
    autoSavePatientFile({ specialistReferrals: nextSpecialists });
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
    const editedSpecialist = editingSpecialist;
    const nextSpecialists = specialistReferrals.map((entry) =>
      entry.id === editedSpecialist.id ? editedSpecialist : entry,
    );
    setSpecialistReferrals(nextSpecialists);
    setSpecialistMessage(`${editedSpecialist.specialist} updated.`);
    setEditingSpecialist(null);
    setSpecialistEditorAnchor(null);
    autoSavePatientFile({ specialistReferrals: nextSpecialists });
  };

  const removeSpecialist = (id: string) => {
    const nextSpecialists = specialistReferrals.filter((entry) => entry.id !== id);
    setSpecialistReferrals(nextSpecialists);
    setSpecialistMessage("Specialist referral removed.");
    autoSavePatientFile({ specialistReferrals: nextSpecialists });
  };

  const generateSpecialistReferralPdf = (
    entry: SpecialistReferral,
    promptAnswers?: Record<string, string>,
  ) => {
    if (!specialistReferralTemplate) {
      setSpecialistMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("specialistReferral");
      }
      return;
    }

    if (!promptAnswers) {
      const headerBody = documentTemplates.header.active ? documentTemplates.header.body : "";
      const seen = new Set<string>();
      const promptIds: string[] = [];
      for (const id of getDocumentTemplatePromptIds(specialistReferralTemplate.body)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      for (const id of getDocumentTemplatePromptIds(headerBody)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      if (promptIds.length > 0) {
        setDocPromptState({
          title: `Generate ${specialistReferralTemplate.name}`,
          promptIds,
          answers: Object.fromEntries(promptIds.map((id) => [id, ""])),
          onSubmit: (answers) => generateSpecialistReferralPdf(entry, answers),
        });
        return;
      }
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

    // Per-referral imaging toggle. Two context fields drive the
    // template's imaging section visibility:
    //
    //   - INCLUDE_IMAGING_FINDINGS: "yes" when the checkbox is on,
    //     "" when off. This is the SINGLE flag the template author
    //     should wrap their ENTIRE imaging block in — outer header,
    //     inner labels, tokens, everything — with
    //     {{#if INCLUDE_IMAGING_FINDINGS}}...{{/if}}. One toggle =
    //     one wrapper = the whole section appears or disappears.
    //   - XRAY_FINDINGS / MRI_CT_FINDINGS: forced to "" when the
    //     checkbox is off so even if the template author hasn't
    //     wrapped them yet, the values are at least empty (rather
    //     than the patient's actual findings leaking through).
    //
    // Either approach works on its own — wrapping with
    // {{#if INCLUDE_IMAGING_FINDINGS}} gives the cleanest result
    // (the headers disappear too), but the inner-token approach
    // is the safe default if a template was written before this
    // flag existed.
    const imagingMode =
      entry.imagingFindingsMode ??
      (entry.includeImagingFindings ? "both" : "none");
    const includeXray = imagingMode === "both" || imagingMode === "xray";
    const includeMri = imagingMode === "both" || imagingMode === "mri";
    context.INCLUDE_IMAGING_FINDINGS = imagingMode === "none" ? "" : "yes";
    // Blank the excluded modality so it doesn't emit an empty
    // "X-Ray Findings: -" section in older templates.
    if (!includeXray) context.XRAY_FINDINGS = "";
    if (!includeMri) context.MRI_CT_FINDINGS = "";
    // One-token section: "Imaging Findings:" header + ONLY the selected
    // modalities, or "" when none. Lets a template replace the whole
    // hand-wrapped {{#if}} imaging block with a single {{IMAGING_FINDINGS}}
    // token — no stray "Xray:" label when only MRI is selected.
    const imagingParts: string[] = [];
    if (includeXray) imagingParts.push(`Xray:\n${xrayFindingsForTemplates}`);
    if (includeMri) imagingParts.push(`MRI:\n${mriCtFindingsForTemplates}`);
    context.IMAGING_FINDINGS = imagingParts.length
      ? `Imaging Findings:\n${imagingParts.join("\n\n")}`
      : "";

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context, undefined, promptAnswers)
      : "";
    const renderedBody = renderDocumentTemplate(specialistReferralTemplate.body, context, undefined, promptAnswers);
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

  const generateImagingRequestPdf = (
    mode: ImagingMode,
    entry: ImagingReferral,
    promptAnswers?: Record<string, string>,
  ) => {
    const setMessage = mode === "xray" ? setXrayMessage : setMriMessage;
    if (!imagingRequestTemplate) {
      setMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("imagingRequest");
      }
      return;
    }

    if (!promptAnswers) {
      const headerBody = documentTemplates.header.active ? documentTemplates.header.body : "";
      const seen = new Set<string>();
      const promptIds: string[] = [];
      for (const id of getDocumentTemplatePromptIds(imagingRequestTemplate.body)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      for (const id of getDocumentTemplatePromptIds(headerBody)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      if (promptIds.length > 0) {
        setDocPromptState({
          title: `Generate ${imagingRequestTemplate.name}`,
          promptIds,
          answers: Object.fromEntries(promptIds.map((id) => [id, ""])),
          onSubmit: (answers) => generateImagingRequestPdf(mode, entry, answers),
        });
        return;
      }
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
      ? renderDocumentTemplate(documentTemplates.header.body, context, undefined, promptAnswers)
      : "";
    const renderedBody = renderDocumentTemplate(imagingRequestTemplate.body, context, undefined, promptAnswers);
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

  const generateLetterPdf = (promptAnswers?: Record<string, string>) => {
    if (!selectedLetterTemplate) {
      setLetterMessage("NO PDF. Create Template?");
      const shouldCreate = window.confirm("NO PDF. Create Template?");
      if (shouldCreate) {
        openTemplateSettings("generalLetter");
      }
      return;
    }

    // Collect [[prompt_id]] tokens from the body (and the header if
    // it's active). If any exist and we don't have answers yet, defer
    // generation behind the prompt modal — it re-invokes this
    // function with the answers once the user fills them in.
    if (!promptAnswers) {
      const headerBody = documentTemplates.header.active ? documentTemplates.header.body : "";
      const seen = new Set<string>();
      const promptIds: string[] = [];
      for (const id of getDocumentTemplatePromptIds(selectedLetterTemplate.body)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      for (const id of getDocumentTemplatePromptIds(headerBody)) {
        if (!seen.has(id)) { seen.add(id); promptIds.push(id); }
      }
      if (promptIds.length > 0) {
        setDocPromptState({
          title: `Generate ${selectedLetterTemplate.name}`,
          promptIds,
          answers: Object.fromEntries(promptIds.map((id) => [id, ""])),
          onSubmit: (answers) => generateLetterPdf(answers),
        });
        return;
      }
    }

    const context: Record<string, string> = {
      ...getCommonDocumentContext(),
    };

    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context, undefined, promptAnswers)
      : "";
    const renderedBody = renderDocumentTemplate(selectedLetterTemplate.body, context, undefined, promptAnswers);
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
          const prefix = getFormalTitle(patientSex, maritalStatus);
          return lastName ? `${prefix} ${lastName}` : prefix;
        })(),
        mrMrsMsFullName: (() => {
          const prefix = getFormalTitle(patientSex, maritalStatus);
          const fullName = `${firstName} ${lastName}`.trim();
          return fullName ? `${prefix} ${fullName}` : prefix;
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
      // Patient-refused overrides per category — when set AND the
      // category has no entries on file, the narrative prints the
      // office's stock refusal sentence instead of a bare "-".
      followUpOverrides: {
        xrayPatientRefused: xrayFollowUpOverride.patientRefused,
        mriPatientRefused: mriCtFollowUpOverride.patientRefused,
        specialistPatientRefused: specialistFollowUpOverride.patientRefused,
      },
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
    // Warn (but allow override) when checking a patient in on a day the
    // office is marked Closed on the Key Dates calendar. Check-in
    // previously ignored closed days entirely.
    if (target && nextStatus === "Check In") {
      const closedKeyDate = findClosedKeyDateForDate(keyDates, target.date);
      if (
        closedKeyDate &&
        !window.confirm(
          `${toUsDate(target.date)} is marked CLOSED (${closedKeyDate.reason}). Check in anyway?`,
        )
      ) {
        return;
      }
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
    // quickDateDraft now holds the ISO value used by <input type="date">
    // so the native browser calendar popover works. The draft gets
    // converted back to US display only when we surface a status
    // message to the user.
    setQuickDateDraft(appointment.date);
  };
  const cancelQuickDateEdit = () => {
    setQuickDateEditId(null);
    setQuickDateDraft("");
  };
  const commitQuickDateEdit = (appointment: ScheduleAppointmentRecord) => {
    const isoCandidate = quickDateDraft.trim();
    if (!isoCandidate || !/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate) || isoCandidate === appointment.date) {
      cancelQuickDateEdit();
      return;
    }
    updateAppointment(appointment.id, (current) => ({
      ...current,
      date: isoCandidate,
    }));
    setEncounterMessage(
      `Date updated to ${toUsDate(isoCandidate)} for ${appointment.appointmentType}.`,
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

  /**
   * Case-status change handler. When the user marks the patient as
   * "Dropped" — the case is over, the patient is not coming back —
   * any future appointments still on the schedule are stale. We
   * prompt to delete them in the same click instead of forcing the
   * user to find and clean up each row manually on the schedule.
   *
   * Only future Scheduled rows are candidates. Past appointments
   * are clinical history (don't touch). Check In / Check Out /
   * Canceled / Reschedule are also left alone — they reflect
   * what actually happened and shouldn't disappear from the record.
   */
  const handleCaseStatusChange = (nextStatus: string) => {
    // Always commit the status change first — that's the user's
    // primary intent. The appointment cleanup is a secondary
    // convenience prompt.
    setCaseStatus(nextStatus);

    if (nextStatus !== "Dropped") return;

    const todayIso = (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();

    const futureScheduled = patientAppointmentRecords.filter(
      (entry) => entry.status === "Scheduled" && entry.date >= todayIso,
    );

    if (futureScheduled.length === 0) {
      return;
    }

    const proceed = window.confirm(
      `Patient marked as Dropped. Delete ${futureScheduled.length} future Scheduled appointment${
        futureScheduled.length === 1 ? "" : "s"
      } as well?\n\n` +
        `(Past, Checked In/Out, Canceled, and Rescheduled appointments are kept as case history.)`,
    );
    if (!proceed) return;

    futureScheduled.forEach((appt) => {
      removeAppointment(appt.id);
    });
    setEncounterMessage(
      `Patient marked Dropped — removed ${futureScheduled.length} future appointment${
        futureScheduled.length === 1 ? "" : "s"
      }.`,
    );
  };

  const handlePrintAppointments = () => {
    const scheduled = patientAppointmentRecords
      .filter((entry) => entry.status === "Scheduled")
      .slice()
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    if (scheduled.length === 0) {
      setEncounterMessage("No scheduled appointments to print for this patient.");
      return;
    }
    const weekday = (iso: string) => {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return "";
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime())
        ? ""
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    };
    const rowsHtml = scheduled
      .map(
        (a) =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(toUsDate(a.date))}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(weekday(a.date))}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatTimeLabel(a.startTime))}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(a.appointmentType)}</td></tr>`,
      )
      .join("");
    const bodyHtml =
      `<h2 style="text-align:center;margin-bottom:2px;">Scheduled Appointments</h2>` +
      `<p style="text-align:center;margin-bottom:12px;"><strong>${escapeHtml(patient.fullName)}</strong>${caseNumber ? ` &nbsp;&middot;&nbsp; Case #: ${escapeHtml(caseNumber)}` : ""}</p>` +
      `<table style="width:100%;border-collapse:collapse;">` +
      `<thead><tr>` +
      `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #13293d;">Date</th>` +
      `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #13293d;">Day</th>` +
      `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #13293d;">Time</th>` +
      `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #13293d;">Type</th>` +
      `</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    const context = getCommonDocumentContext();
    const renderedHeader = documentTemplates.header.active
      ? renderDocumentTemplate(documentTemplates.header.body, context, undefined, {})
      : "";
    const printableHtml = buildPrintableDocumentHtml({
      title: `Appointments - ${patient.fullName}`,
      headerHtml: renderedHeader,
      bodyHtml,
      headerFontFamily: documentTemplates.header.fontFamily,
      fontFamily: documentTemplates.header.fontFamily || "Georgia, 'Times New Roman', serif",
      includeLogo: documentTemplates.header.active ? documentTemplates.header.showOfficeLogo : false,
      logoDataUrl: officeSettings.logoDataUrl,
    });
    const started = printHtmlWithIframeFallback(printableHtml);
    if (!started) {
      setEncounterMessage("Could not open print preview. Check popup/print settings and try again.");
      return;
    }
    setEncounterMessage(
      `Printing ${scheduled.length} scheduled appointment${scheduled.length === 1 ? "" : "s"}. Use Save as PDF in the print dialog if you'd like a file.`,
    );
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
      // DUPLICATE-APPOINTMENT GUARD.
      //
      // Count how many OTHER appointments on this patient match the
      // same encounter by date + type. If there are duplicates (e.g.
      // from a runaway Restore Appt loop), deleting any single one
      // must NOT cascade-delete the encounter — the other duplicates
      // still reference it, and the user almost certainly wants to
      // prune the extra rows while keeping the chart note intact.
      const normalizedApptType = normalizeLookupValue(appointment.appointmentType);
      const normalizedEncType = normalizeLookupValue(linkedEncounter.appointmentType);
      const siblingAppointments = patientAppointmentRecords.filter(
        (entry) =>
          entry.id !== appointment.id &&
          toUsDate(entry.date) === dateLabel &&
          normalizeLookupValue(entry.appointmentType) === normalizedEncType,
      );
      if (siblingAppointments.length > 0 && normalizedApptType === normalizedEncType) {
        const proceed = window.confirm(
          `There are ${siblingAppointments.length + 1} appointments on ${dateLabel} for "${appointment.appointmentType}" that all link to the same encounter.\n\n` +
            `Click OK to delete ONLY this one appointment — the encounter and its charges stay intact and the other ${siblingAppointments.length} appointment${siblingAppointments.length === 1 ? "" : "s"} keep linking to it.\n\n` +
            `Click Cancel to keep everything.`,
        );
        if (!proceed) return;
        removeAppointment(appointment.id);
        setEncounterMessage(
          `Duplicate appointment on ${dateLabel} at ${timeLabel} deleted. Encounter preserved.`,
        );
        return;
      }

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
      // Cascade: drop any cash payment entries linked to this
      // encounter so we don't leak orphans into the Cash Payments
      // totals (orphans don't render anywhere visible but were
      // inflating the Discount / Paid sums).
      cascadeCashPaymentsOnEncounterDelete(patient.id, (current) =>
        current.filter((e) => e.encounterId !== linkedEncounter.id),
      );
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
    // Run the user's draft through the flexible parser so input like
    // "4:45pm", "445p", or "16:45" all land as the same canonical
    // 24h "HH:MM" we store. Invalid drafts just dismiss the editor
    // without overwriting the existing time.
    const parsed = parseTimeFlexible(quickTimeDraft);
    if (!parsed || parsed === appointment.startTime) {
      cancelQuickTimeEdit();
      return;
    }
    updateAppointment(appointment.id, (current) => ({
      ...current,
      startTime: parsed,
    }));
    setEncounterMessage(
      `Time updated to ${formatTimeLabel(parsed)} on ${toUsDate(appointment.date)}.`,
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

  // ── Restore Appointment for an orphaned encounter ──
  //
  // When the patient-page table shows a row as "Open (Encounter Only)" or
  // "Closed (Encounter Only)", the encounter exists but its parent
  // appointment is gone — usually because the appointment was deleted or
  // a sync race dropped it. The encounter is still in the table because
  // we don't want to silently lose chart data, but the user previously
  // had no way to recover the link short of recreating the visit by hand.
  //
  // This handler rebuilds a minimal appointment record from the
  // encounter's stored fields (date, type, provider, patient) and writes
  // the new appointment's id back onto the encounter so the durable
  // join lights up immediately. Status defaults to "Check Out" because
  // an encounter wouldn't exist if the patient hadn't been seen.
  // restoreAppointmentForEncounter was removed — it had a debounce
  // race that minted duplicate appointments on fast re-clicks, and
  // combined with the date+type-based encounter join that made
  // cleanup of those duplicates dangerous. The safer recovery path
  // is the normal schedule "+ Appointment" → "Check In" → "+ Encounter"
  // flow, which can't introduce duplicates the same way.

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

    // Guard against accidentally creating an encounter for an
    // appointment whose date isn't today. Catches both directions:
    //  - Future: the user misclicks on tomorrow's slot and starts
    //    typing before the patient has even walked in.
    //  - Past: the user checked a patient in days ago but never
    //    made an encounter, then clicks + Encounter long after
    //    the fact and the new encounter gets stamped with the
    //    original visit date.
    // Same-day appointments pass through silently — no nag.
    const todayIso = (() => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();
    if (appointment.date !== todayIso) {
      const direction = appointment.date > todayIso ? "in the future" : "in the past";
      const proceed = window.confirm(
        `This appointment is on ${appointmentDate}, which is ${direction}. ` +
          `Are you sure you want to create an encounter now? Click Cancel if you opened the wrong appointment.`,
      );
      if (!proceed) {
        setEncounterMessage(`Encounter creation canceled — appointment is ${direction}.`);
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
      // Durable link — if the appointment date / type later drifts,
      // the patient-page table still finds this encounter by id
      // instead of orphaning it as "Encounter Only".
      appointmentId: appointment.id,
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

  // Build the full patch for updatePatientRecordById. Accepts overrides so
  // an autosave triggered right after a setState call can pass the
  // freshly-computed value (the closure-captured state would otherwise be
  // one tick stale).
  const buildPatientPatch = (overrides: {
    specialistReferrals?: SpecialistReferral[];
    xrayReferrals?: ImagingReferral[];
    mriReferrals?: ImagingReferral[];
    relatedCases?: RelatedCaseEntry[];
  } = {}): UpdatePatientRecordPatch => {
    const effectiveSpecialists = overrides.specialistReferrals ?? specialistReferrals;
    const effectiveXrays = overrides.xrayReferrals ?? xrayReferrals;
    const effectiveMris = overrides.mriReferrals ?? mriReferrals;
    const effectiveRelated = overrides.relatedCases ?? relatedCases;

    const nextFirstName = firstName.trim();
    const nextLastName = lastName.trim();
    const nextFullName =
      nextFirstName || nextLastName
        ? `${nextLastName || names.lastName}, ${nextFirstName || names.firstName}`
        : patient.fullName;

    return {
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
      relatedCases: effectiveRelated.length > 0 ? effectiveRelated : undefined,
      xrayReferrals: effectiveXrays,
      mriReferrals: effectiveMris,
      specialistReferrals: effectiveSpecialists,
      alerts: patientAlerts.length > 0 ? patientAlerts : undefined,
      matrix: {
        initialExam: toIsoDateFromUsDate(initialExam),
        lien: resolvedLienStatus,
        priorCare: priorCare.trim(),
        xrayFindings: xrayFindings.trim(),
        mriCtFindings: mriCtFindings.trim(),
        specialistRecommendations: specialistRecommendations.trim(),
        specialistSent: (() => {
          const dates = effectiveSpecialists
            .map((entry) => toIsoDateFromUsDate(entry.sentDate))
            .filter((d) => d);
          return dates.sort().at(-1) ?? "";
        })(),
        specialistScheduled: (() => {
          const dates = effectiveSpecialists
            .map((entry) => toIsoDateFromUsDate(entry.scheduledDate))
            .filter((d) => d);
          return dates.sort().at(-1) ?? "";
        })(),
        specialistReport: (() => {
          const dates = effectiveSpecialists
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
    };
  };

  // Shared save core. `silent` autosaves get a tiny "Auto-saved" pill that
  // fades quickly; explicit Save & Close gets the louder "Saving — pushing
  // to cloud..." flow.
  const performPatientSave = async (
    overrides: Parameters<typeof buildPatientPatch>[0] = {},
    opts: { silent: boolean } = { silent: false },
  ): Promise<boolean> => {
    const paidValue = Number.parseFloat(paidAmount);
    setPatientBillingCoreFields(patient.id, {
      billedAmount: currentBillTotal,
      paidAmount: Number.isFinite(paidValue) ? paidValue : 0,
      paidDate,
    });

    const savedPatient = updatePatientRecordById(patient.id, buildPatientPatch(overrides));
    if (!savedPatient) {
      setSaveStatus("error");
      setSaveMessage("Could not save patient record. Try again or refresh.");
      return false;
    }

    setSaveStatus("saving");
    setSaveMessage(opts.silent ? "Auto-saving..." : "Saving — pushing to cloud...");
    try {
      await forceSyncNow();
      setSaveStatus("saved");
      setSaveMessage(opts.silent ? "Auto-saved" : "Saved & synced to cloud");
      window.setTimeout(() => {
        setSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, opts.silent ? 2500 : 6000);
      return true;
    } catch {
      setSaveStatus("error");
      setSaveMessage("Saved locally — cloud sync FAILED. Don't close this tab. Retry or check connection.");
      return false;
    }
  };

  // Fire-and-forget autosave for "big things" (add specialist, etc.). Caller
  // passes an override for any state value that was just changed in the
  // same handler tick — closures would otherwise read the prior value.
  const autoSavePatientFile = (overrides: Parameters<typeof buildPatientPatch>[0] = {}) => {
    void performPatientSave(overrides, { silent: true });
  };

  // Loud, awaitable wrapper for the Patient Refused / Completed Prior
  // Care / No Imaging override toggles. The previous fire-and-forget
  // pattern silently dropped failed cloud writes — the toggle visibly
  // flipped, the user moved on, and the next bootstrap overwrote
  // localStorage from the stale cloud value (wiping every toggle in the
  // session). This routes the write through the existing save pill so
  // the user gets a hard signal that the cloud actually accepted it.
  const categoryLabel = (category: "xray" | "mriCt" | "specialist") =>
    category === "xray" ? "X-Ray" : category === "mriCt" ? "MRI/CT" : "Specialist";
  const flagLabel = (flag: "patientRefused" | "completedPriorCare" | "notNeeded") =>
    flag === "patientRefused" ? "Patient Refused"
      : flag === "completedPriorCare" ? "Completed Prior Care"
        : "Not Needed";
  const runOverrideToggle = async (
    category: "xray" | "mriCt" | "specialist",
    flag: "patientRefused" | "completedPriorCare" | "notNeeded",
    enabled: boolean,
  ) => {
    const label = `${categoryLabel(category)} → ${flagLabel(flag)}`;
    setSaveStatus("saving");
    setSaveMessage(`Saving ${label}${enabled ? " ON" : " OFF"} — confirming cloud write...`);
    const setter =
      flag === "patientRefused" ? setPatientRefusedAsync
        : flag === "completedPriorCare" ? setCompletedPriorCareAsync
          : setNotNeededAsync;
    try {
      await setter(patient.id, category, enabled);
      setSaveStatus("saved");
      setSaveMessage(`Saved ${label}${enabled ? " ON" : " OFF"}`);
      window.setTimeout(() => {
        setSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, 2500);
    } catch (error) {
      console.error("[Override Toggle] cloud write failed:", error);
      setSaveStatus("error");
      setSaveMessage(
        `⚠ "${label}" did NOT save to cloud. Don't refresh or close — try toggling again, or check your connection.`,
      );
    }
  };

  const saveAndClosePatientFile = async () => {
    const ok = await performPatientSave({}, { silent: false });
    if (!ok) {
      // Stay on the page so the user sees the error and can retry.
      return;
    }
    setSaveMessage("Saved & synced. Returning to patient list...");
    // Hold the green confirmation a beat so the user sees it before
    // navigation tears the component down.
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    router.push(`/patients?saved=${encodeURIComponent(patient.fullName)}`);
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

  const openAddDxModal = () => {
    setDxCode("");
    setDxDescription("");
    setDxFolderId(billingMacros.diagnosisFolders[0]?.id ?? "");
    setDxError("");
    setShowAddDxModal(true);
  };

  const handleSaveDx = () => {
    const code = dxCode.trim();
    const description = dxDescription.trim();
    if (!code || !description) {
      setDxError("Code and description are required.");
      return;
    }
    // Add to the master library (same as Settings), folder-placed so it's
    // reusable from the dropdown for every patient.
    const { id, added } = addLibraryDiagnosis({
      code,
      description,
      folderId: dxFolderId || undefined,
    });
    if (!id) {
      setDxError("Could not add this code. Check the code and description.");
      return;
    }
    // Also drop it on the current patient's file.
    addDiagnosis(code, description, "Manual");
    setDiagnosisMessage(
      `${code}: ${added ? "added to library" : "already in library"} and added to this patient.`,
    );
    setShowAddDxModal(false);
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
            // Cash-Patient badge only — the old "Convert to PI" button
            // sat here too, but it fired immediately with no confirm
            // dialog, which made an accidental click a real data
            // hazard. Removed per user request; cash↔PI conversions
            // should happen deliberately, not as a single misclick.
            <div className="md:col-span-2 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Cash Patient</span>
            </div>
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
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
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
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-primary)]"
                onClick={() =>
                  downloadVCard({
                    firstName,
                    lastName,
                    phone: patientPhone,
                    email: patientEmail,
                    dob: patientDob,
                    address: patientAddress,
                    note: caseNumber ? `Case #: ${caseNumber}` : undefined,
                  })
                }
                title="Download a .vcf — macOS opens it in Contacts to add this patient with their name, phone, birthday and address pre-filled"
                type="button"
              >
                Add to Contacts
              </button>
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
              onChange={(event) => handleCaseStatusChange(event.target.value)}
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

        {/* Treatment Packages — cash-patient only. Lets the user
            assign templates (defined in Settings → Billing Macros)
            to this patient, track visits used vs total with a
            progress bar, and mark refunds. Snapshot pattern means
            template edits don't retroactively change this
            patient's contract. */}
        {isCashPatient && (
          <div className="p-4 pt-0">
            <PatientPackagesSection patientId={patient.id} />
          </div>
        )}
      </section>

      {/* Notes panel — sits between the patient info card above and
          the imaging triple below. Default open state is in
          Settings → Patient Page Sections; Notes ships on by default
          so a free-form note left by the front desk never gets
          missed during a visit. */}
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

      {/* X-Ray / MRI / Specialist now live in their own top-level
          floating section instead of being nested inside the patient
          info card. They share a 3-column grid on xl screens and
          stack on smaller widths. Each panel keeps its own toggle
          state via imagingPanelsOpen.* */}
      <section className="grid items-start gap-5 xl:grid-cols-3">
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
                      onChange={(event) => { void runOverrideToggle("xray", "patientRefused", event.target.checked); }}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={xrayFollowUpOverride.completedPriorCare}
                      onChange={(event) => { void runOverrideToggle("xray", "completedPriorCare", event.target.checked); }}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={xrayFollowUpOverride.notNeeded}
                      onChange={(event) => { void runOverrideToggle("xray", "notNeeded", event.target.checked); }}
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
                <div
                  key={entry.id}
                  className={`rounded-lg border p-2 ${
                    entry.patientRefused
                      ? "border-amber-300 bg-amber-50/60"
                      : "border-[var(--line-soft)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      {entry.modalityLabel} — {entry.center || "No Center"}
                    </p>
                    {entry.patientRefused && (
                      <span className="rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        Patient Refused
                      </span>
                    )}
                  </div>
                  <p>Regions: {formatImagingRegionsSummary(entry, "xray")}</p>
                  <p>
                    Sent: {entry.sentDate || "-"}
                    {" | Completed: "}{entry.doneDate || "-"}
                    {" | Reviewed: "}{entry.reportReviewedDate || "-"}
                  </p>
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
                      onChange={(event) => { void runOverrideToggle("mriCt", "patientRefused", event.target.checked); }}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={mriCtFollowUpOverride.completedPriorCare}
                      onChange={(event) => { void runOverrideToggle("mriCt", "completedPriorCare", event.target.checked); }}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={mriCtFollowUpOverride.notNeeded}
                      onChange={(event) => { void runOverrideToggle("mriCt", "notNeeded", event.target.checked); }}
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
                <div
                  key={entry.id}
                  className={`rounded-lg border p-2 ${
                    entry.patientRefused
                      ? "border-amber-300 bg-amber-50/60"
                      : "border-[var(--line-soft)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      {entry.modalityLabel} — {entry.center || "No Center"}
                    </p>
                    {entry.patientRefused && (
                      <span className="rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        Patient Refused
                      </span>
                    )}
                  </div>
                  <p>Regions: {formatImagingRegionsSummary(entry, "mri")}</p>
                  <p>
                    Sent: {entry.sentDate || "-"}
                    {" | Scheduled: "}{entry.scheduledDate || "-"}
                    {" | Completed: "}{entry.doneDate || "-"}
                    {" | Reviewed: "}{entry.reportReviewedDate || "-"}
                  </p>
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
                      onChange={(event) => { void runOverrideToggle("specialist", "patientRefused", event.target.checked); }}
                      type="checkbox"
                    />
                    Patient Refused
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={specialistFollowUpOverride.completedPriorCare}
                      onChange={(event) => { void runOverrideToggle("specialist", "completedPriorCare", event.target.checked); }}
                      type="checkbox"
                    />
                    Completed Prior Care
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
                    <input
                      checked={specialistFollowUpOverride.notNeeded}
                      onChange={(event) => { void runOverrideToggle("specialist", "notNeeded", event.target.checked); }}
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
                <div
                  key={entry.id}
                  className={`rounded-lg border p-2 ${
                    entry.patientRefused
                      ? "border-amber-300 bg-amber-50/60"
                      : "border-[var(--line-soft)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{entry.specialist}</p>
                    {entry.patientRefused && (
                      <span className="rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        Patient Refused
                      </span>
                    )}
                  </div>
                  <p>Sent: {entry.sentDate || "-"} | Scheduled: {entry.scheduledDate || "-"} | Completed: {entry.completedDate || "-"}</p>
                  {entry.recommendations.trim() && (
                    <p className="mt-1 text-[var(--text-muted)]">{entry.recommendations}</p>
                  )}
                  {/* Which imaging findings to inject into the generated
                      referral PDF: XR/MR (both), MR (MRI only), XR (X-ray
                      only). Pick one, or click the active one again to
                      include none (the default) — so a patient without an
                      X-ray never emits an empty X-ray section. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">Include imaging in PDF:</span>
                    {([
                      { value: "both", label: "XR/MR" },
                      { value: "mri", label: "MR" },
                      { value: "xray", label: "XR" },
                    ] as const).map((opt) => {
                      const currentMode =
                        entry.imagingFindingsMode ??
                        (entry.includeImagingFindings ? "both" : "none");
                      const active = currentMode === opt.value;
                      return (
                        <button
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            active
                              ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                              : "border-[var(--line-soft)] bg-white text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
                          }`}
                          key={opt.value}
                          onClick={() => {
                            const nextMode: SpecialistReferral["imagingFindingsMode"] =
                              active ? "none" : opt.value;
                            const nextSpecialists = specialistReferrals.map((existing) =>
                              existing.id === entry.id
                                ? {
                                    ...existing,
                                    imagingFindingsMode: nextMode,
                                    includeImagingFindings: nextMode !== "none",
                                  }
                                : existing,
                            );
                            setSpecialistReferrals(nextSpecialists);
                            autoSavePatientFile({ specialistReferrals: nextSpecialists });
                          }}
                          title={
                            opt.value === "both"
                              ? "Include both X-ray and MRI findings"
                              : opt.value === "mri"
                                ? "Include MRI findings only"
                                : "Include X-ray findings only"
                          }
                          type="button"
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
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
      </section>

      {/* Compact 3-column card grid (placement via `order-*`) — row 1:
          Case Flow / To-Do · Related Cases · Letters; row 2: Appointments
          (spans 2 cols) · Patient Files; row 3: Diagnosis · Reports ·
          Additional Details. */}
      <section className="grid gap-4 xl:grid-cols-6 items-start">
        <section className="panel-card p-4 order-4 xl:col-span-3">
        <button
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#72bdcf] px-3 py-2 text-lg font-semibold text-white"
          onClick={() => toggleSectionPanel("appointments")}
          type="button"
        >
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
            <span>Appointments / Encounters</span>
            {/* Per-status counts so the user can see at a glance how
                many are scheduled vs already in / out / canceled
                without expanding the panel. */}
            <span className="text-sm font-medium text-white/85">
              {scheduledCount} Scheduled · {checkedInCount} Checked In · {checkedOutCount} Checked Out · {canceledCount} Canceled
            </span>
          </span>
          <span className="text-xl">{sectionPanelsOpen.appointments ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.appointments && (
          <>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-[var(--text-muted)]">
                View all scheduled appointments for this patient and launch encounters quickly.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  onClick={openScheduleModal}
                  title="Schedule a new appointment"
                  type="button"
                >
                  📅 Appt.
                </button>
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5 text-sm font-medium hover:bg-[var(--bg-soft)]"
                  onClick={handlePrintAppointments}
                  title="Print this patient's scheduled appointments"
                  type="button"
                >
                  🖨️ Appt.
                </button>
              </div>
            </div>

            {encounterMessage && <p className="mt-2 text-sm font-semibold text-[var(--brand-primary)]">{encounterMessage}</p>}

            {/* Single column now that the Open Encounters sidebar is
                gone — the table takes the full panel width, which is
                especially useful inside the new 2-col patient-page
                layout where this section is already half-width. */}
            <div className="mt-3">
              <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <h4 className="text-base font-semibold">Scheduled Appointments</h4>
                <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-[var(--bg-soft)] text-left">
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Day</th>
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
                        // "Day" column: short weekday abbreviation
                        // computed from the appointment's ISO date.
                        // Falls back to em-dash when no appointment is
                        // attached (e.g., encounter-only rows).
                        const dayLabel = (() => {
                          if (!appointment) return "";
                          const match = appointment.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                          if (!match) return "";
                          const d = new Date(
                            Number(match[1]),
                            Number(match[2]) - 1,
                            Number(match[3]),
                          );
                          if (Number.isNaN(d.getTime())) return "";
                          return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
                        })();
                        return (
                          <tr key={row.rowId} className="border-t border-[var(--line-soft)]">
                            <td className="px-2 py-2 tabular-nums">
                              {appointment ? (
                                quickDateEditId === appointment.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      autoFocus
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                      onChange={(event) => setQuickDateDraft(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          commitQuickDateEdit(appointment);
                                        } else if (event.key === "Escape") {
                                          cancelQuickDateEdit();
                                        }
                                      }}
                                      type="date"
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
                            <td className="px-2 py-2 text-xs text-[var(--text-muted)]">
                              {dayLabel || <span>—</span>}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {appointment ? (
                                quickTimeEditId === appointment.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      autoFocus
                                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                      // No numeric inputMode + no digit
                                      // filter on the value: the user types
                                      // "4:45pm" / "445p" / "16:45" and the
                                      // parser handles it on commit. The
                                      // old digit-only filter forced the
                                      // user to translate 4:45 PM into
                                      // 16:45 in their head every time.
                                      maxLength={8}
                                      onChange={(event) => setQuickTimeDraft(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          commitQuickTimeEdit(appointment);
                                        } else if (event.key === "Escape") {
                                          cancelQuickTimeEdit();
                                        }
                                      }}
                                      placeholder="4:45pm or 16:45"
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
                              ) : linkedEncounter ? (
                                // Encounter-only rows (no parent
                                // appointment) — encounter exists but
                                // the appointment it was created from
                                // is gone. The "Restore Appt" button
                                // that used to live here is REMOVED:
                                // it had a debounce race that created
                                // duplicate appointments on fast
                                // re-clicks, and the cascade math in
                                // handleDeleteAppointment treated all
                                // the duplicates as siblings of one
                                // encounter, which meant cleaning up
                                // duplicates could destroy the chart.
                                // If the user needs to re-link an
                                // orphan encounter to a fresh
                                // appointment, the safer path is the
                                // normal "+ Appointment" flow on the
                                // schedule + "+ Encounter" on the
                                // check-in row.
                                <button
                                  className="rounded-lg p-1.5 text-[#b43b34] hover:bg-red-50 transition-colors"
                                  onClick={() => {
                                    const chargeCount = linkedEncounter.charges.length;
                                    const status = linkedEncounter.signed ? " (CLOSED)" : "";
                                    const proceed = window.confirm(
                                      `Delete this encounter${status} on ${linkedEncounter.encounterDate}${
                                        chargeCount > 0
                                          ? ` and its ${chargeCount} charge${chargeCount === 1 ? "" : "s"}`
                                          : ""
                                      }?\n\nThis cannot be undone.`,
                                    );
                                    if (!proceed) return;
                                    deleteEncounter(linkedEncounter.id);
                                    cascadeCashPaymentsOnEncounterDelete(
                                      patient.id,
                                      (current) =>
                                        current.filter(
                                          (e) => e.encounterId !== linkedEncounter.id,
                                        ),
                                    );
                                    setEncounterMessage(
                                      `Encounter on ${linkedEncounter.encounterDate} deleted.`,
                                    );
                                  }}
                                  title="Delete encounter"
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

            </div>
          </>
        )}
      </section>
        <article className="panel-card p-4 order-1 xl:col-span-2">
          <button
            className="flex w-full items-center justify-between rounded-xl bg-[#72bdcf] px-3 py-2 text-center text-lg font-semibold text-white"
            onClick={() => toggleSectionPanel("reExam")}
            type="button"
          >
            <span>Case Flow / To-Do</span>
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
        <article className="panel-card p-4 order-2 xl:col-span-2">
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
        <section className="panel-card p-4 order-3 xl:col-span-2">
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
                onClick={() => generateLetterPdf()}
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
      <section className="panel-card p-4 order-6 xl:col-span-2">
        <button
          // Bar turns red when no diagnoses are on file — visible
          // warning that the patient is missing dx codes (which break
          // billing claims and narrative reports if left empty). Once
          // even one is added, the bar reverts to the regular teal so
          // the warning quiets down.
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-center text-lg font-semibold text-white ${
            patientDiagnoses.length === 0 ? "bg-[#c93b1d]" : "bg-[#72bdcf]"
          }`}
          onClick={() => toggleSectionPanel("diagnosis")}
          type="button"
        >
          <span className="flex items-center gap-2">
            <span>Diagnosis Codes</span>
            {patientDiagnoses.length === 0 && (
              <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide">
                None added
              </span>
            )}
          </span>
          <span className="text-xl">{sectionPanelsOpen.diagnosis ? "−" : "+"}</span>
        </button>
        {sectionPanelsOpen.diagnosis && (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--text-muted)]">
                Add one code or a preset bundle for this patient file.
              </p>
              <button
                className="shrink-0 rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
                onClick={openAddDxModal}
                type="button"
              >
                + Dx Code
              </button>
            </div>

            <div className="mt-3 grid gap-4 xl:grid-cols-2">
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
      <section className="panel-card p-4 order-7 xl:col-span-2">
        <button
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-center text-lg font-semibold text-white ${isCompletePlan ? "bg-[#72bdcf]" : "bg-gray-400"}`}
          onClick={() => isCompletePlan && toggleSectionPanel("narrative")}
          type="button"
        >
          <span>Reports{!isCompletePlan ? " — Complete Plan" : ""}</span>
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
      <section className="panel-card p-4 order-5 xl:col-span-3">
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
                      <th className="pb-2 pr-3">
                        <button
                          className="inline-flex items-center gap-1 hover:text-[var(--text-main)]"
                          onClick={() => togglePatientFilesSort("name")}
                          type="button"
                        >
                          Name
                          {patientFilesSort.column === "name" && (
                            <span aria-hidden className="text-[10px]">
                              {patientFilesSort.asc ? "▲" : "▼"}
                            </span>
                          )}
                        </button>
                      </th>
                      <th className="pb-2 pr-3">Size</th>
                      <th className="pb-2 pr-3">
                        <button
                          className="inline-flex items-center gap-1 hover:text-[var(--text-main)]"
                          onClick={() => togglePatientFilesSort("date")}
                          type="button"
                        >
                          Uploaded
                          {patientFilesSort.column === "date" && (
                            <span aria-hidden className="text-[10px]">
                              {patientFilesSort.asc ? "▲" : "▼"}
                            </span>
                          )}
                        </button>
                      </th>
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
      <section className="panel-card p-4 order-8 xl:col-span-2">
        {(() => {
          // Color the Additional Details bar by completeness so the
          // user gets at-a-glance visibility into which billing step
          // is still pending. Same pattern as the Diagnosis Codes bar
          // (which goes red when no dx codes are on file).
          //
          //   Red    → still missing one of: Discharge / R&B Sent /
          //            $ Billed (the pre-bill / billing milestones)
          //   Yellow → billing milestones complete, but Paid Date or
          //            $ Paid Amount are still empty (collections
          //            milestones)
          //   Teal   → everything filled, nothing to chase
          //
          // currentBillTotal already accounts for the auto-sync from
          // encounter charges, so the "$ Billed" check follows that.
          const billingTotalNumeric = currentBillTotal;
          const paidNumeric = Number.parseFloat(paidAmount) || 0;
          const dischargeFilled = dischargeDate.trim().length > 0;
          const rbSentFilled = rbSentDate.trim().length > 0;
          const billedFilled = billingTotalNumeric > 0;
          const paidDateFilled = paidDate.trim().length > 0;
          const paidAmountFilled = paidNumeric > 0;
          const billingMissing = !dischargeFilled || !rbSentFilled || !billedFilled;
          const paidMissing = !paidDateFilled || !paidAmountFilled;
          const headerColor = billingMissing
            ? "bg-[#c93b1d]" // red — billing not yet complete
            : paidMissing
              ? "bg-[#d4a017]" // amber/yellow — billed but unpaid
              : "bg-[#6db5c8]"; // teal — fully closed out
          const statusBadge = billingMissing
            ? "Needs billing"
            : paidMissing
              ? "Awaiting payment"
              : null;
          return (
            <button
              className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-center text-3xl font-semibold tracking-[-0.01em] text-white ${headerColor}`}
              onClick={() => toggleSectionPanel("additionalDetails")}
              type="button"
            >
              <span className="flex items-center gap-2">
                <span>Additional Details</span>
                {statusBadge && (
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide">
                    {statusBadge}
                  </span>
                )}
              </span>
              <span className="text-xl">{sectionPanelsOpen.additionalDetails ? "−" : "+"}</span>
            </button>
          );
        })()}
        {sectionPanelsOpen.additionalDetails && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                  onBlur={() => setBilledFocused(false)}
                  onChange={(event) => setBilledAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  onFocus={() => setBilledFocused(true)}
                  placeholder="0.00"
                  value={billedFocused ? billedAmount : billedAmount.trim() ? formatUsdCurrency(Number.parseFloat(billedAmount) || 0) : ""}
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
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 tabular-nums"
                  inputMode="decimal"
                  onBlur={() => setPaidFocused(false)}
                  onChange={(event) => setPaidAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  onFocus={() => setPaidFocused(true)}
                  placeholder="0.00"
                  value={paidFocused ? paidAmount : paidAmount.trim() ? formatUsdCurrency(Number.parseFloat(paidAmount) || 0) : ""}
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.8fr_1fr] xl:grid-cols-1">
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
                  {reviewSelectOptions.map((option) => (
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
          {/* Save status — bright, can't-miss-it pill. Replaces the
              tiny blue "Updated…" line that was way too easy to miss
              and led to "did the save actually work?" anxiety. */}
          {saveStatus !== "idle" && saveMessage && (
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold shadow-sm ${
                saveStatus === "saving"
                  ? "border border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)] text-[var(--brand-primary)]"
                  : saveStatus === "saved"
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-2 border-red-400 bg-red-50 text-red-800"
              }`}
              role={saveStatus === "error" ? "alert" : undefined}
            >
              {saveStatus === "saving" && "⟳"}
              {saveStatus === "saved" && "✓"}
              {saveStatus === "error" && "⚠"}
              <span>{saveMessage}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-[#de3a31] px-6 py-2 font-semibold text-white disabled:opacity-50"
            disabled={saveStatus === "saving"}
            onClick={saveAndClosePatientFile}
            type="button"
          >
            {saveStatus === "saving" ? "Saving…" : "Save & Close"}
          </button>
        </div>
      </div>

      {/* Document-template prompt modal. Pops up when a letter /
          referral / imaging request template body contains
          [[prompt_id]] tokens that need user input before the PDF
          can be generated. Same look + feel as the narrative-report
          prompt modal below. */}
      {docPromptState && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8">
          <form
            className="panel-card max-h-[85vh] w-full max-w-md overflow-auto p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const submitted = docPromptState.onSubmit;
              const answers = docPromptState.answers;
              setDocPromptState(null);
              submitted(answers);
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">{docPromptState.title}</h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => setDocPromptState(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              Fill in the values used by this template, then click Generate.
            </p>
            <div className="grid gap-3">
              {docPromptState.promptIds.map((id) => (
                <label className="grid gap-1" key={id}>
                  <span className="text-sm font-semibold text-[var(--text-muted)]">
                    {humanizeTemplatePromptId(id)}
                  </span>
                  <input
                    autoFocus={id === docPromptState.promptIds[0]}
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                    onChange={(event) =>
                      setDocPromptState((state) =>
                        state
                          ? {
                              ...state,
                              answers: { ...state.answers, [id]: event.target.value },
                            }
                          : null,
                      )
                    }
                    placeholder="Type a value…"
                    value={docPromptState.answers[id] ?? ""}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                onClick={() => setDocPromptState(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
                type="submit"
              >
                Generate
              </button>
            </div>
          </form>
        </div>
      )}

      {showNarrativePromptModal && narrativePromptTemplate && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-8">
            <ScrollLock />
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
            <ScrollLock />
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
          <ScrollLock />
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
          <ScrollLock />
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
          <ScrollLock />
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
          <ScrollLock />
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
          <ScrollLock />
          <div className="relative h-full w-full">
            <form className="panel-card overflow-auto resize p-4" style={getAnchoredModalStyle(specialistEditorAnchor, 1000, 75, { resizable: true })} onSubmit={(e) => { e.preventDefault(); saveSpecialistEditor(); }}>
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
              </div>

              <label className="grid gap-1 min-w-0">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Recommendations</span>
                <textarea
                  // resize: both lets the user drag wider AND taller. min-w-full
                  // (not w-full) keeps it full-width by default but allows the
                  // browser-applied inline width from the drag handle to grow it
                  // past the parent without being snapped back to 100%.
                  className="min-h-[140px] min-w-full resize rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setEditingSpecialist((current) =>
                      current ? { ...current, recommendations: event.target.value } : current,
                    )
                  }
                  placeholder="Enter specialist recommendations..."
                  style={{ maxHeight: "60vh" }}
                  value={editingSpecialist.recommendations}
                />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold">
                <input
                  checked={editingSpecialist.patientRefused === true}
                  className="accent-[var(--brand-primary)]"
                  onChange={(event) =>
                    setEditingSpecialist((current) =>
                      current
                        ? { ...current, patientRefused: event.target.checked }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                <span>Patient Refused</span>
                <span className="text-xs font-normal text-[var(--text-muted)]">
                  Closes this referral without a Completed date.
                </span>
              </label>
            </div>

            {/* Sticky footer — see comment in the imaging editor below for
                rationale. Same pattern: pin Save/Cancel to the form's
                scroll viewport so dragging the textarea taller never
                hides them. */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex justify-end gap-2 border-t border-[var(--line-soft)] bg-white px-4 py-3">
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
          <ScrollLock />
          <div className="relative h-full w-full">
            <form className="panel-card overflow-auto resize p-4" style={getAnchoredModalStyle(imagingEditorAnchor, 1000, 75, { resizable: true })} onSubmit={(e) => { e.preventDefault(); saveImagingEditor(); }}>
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

              {/* Patient Refused — flips this specific referral closed
                  without a Done date. Case Flow stops chasing and the
                  referral row in the patient file shows a refused
                  badge so it's obvious why this one never completed. */}
              <label className="flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold">
                <input
                  checked={editingImagingReferral.patientRefused === true}
                  className="accent-[var(--brand-primary)]"
                  onChange={(event) =>
                    setEditingImagingReferral((current) =>
                      current
                        ? { ...current, patientRefused: event.target.checked }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                <span>Patient Refused</span>
                <span className="text-xs font-normal text-[var(--text-muted)]">
                  Closes this referral without a Done date.
                </span>
              </label>

              <div className="grid gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">
                    Regions:{" "}
                    <span className="font-normal text-[var(--text-main)]">
                      {editingImagingReferral.regions.length > 0
                        ? editingImagingReferral.regions
                            .map((region) =>
                              formatRegionLabel(region, editingImagingReferral.lateralityByRegion),
                            )
                            .join(", ")
                        : "None"}
                    </span>
                  </span>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold text-[var(--brand-primary)]"
                    onClick={() => setShowImagingRegionEditor((v) => !v)}
                    type="button"
                  >
                    {showImagingRegionEditor ? "Done" : "± Region"}
                  </button>
                </div>
                {showImagingRegionEditor && (
                  <>
                    <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
                      {imagingRegions
                        .filter((entry) => entry.modalities.includes(editingImagingReferral.mode))
                        .map((entry) => {
                          const region = entry.label;
                          const selected = editingImagingReferral.regions.includes(region);
                          const hasLaterality = supportsRegionLaterality(region);
                          const currentLaterality = editingImagingReferral.lateralityByRegion[region];
                          return (
                            <div
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--line-soft)] bg-white p-0.5"
                              key={`edit-region-${region}`}
                            >
                              <button
                                aria-pressed={selected}
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                  selected
                                    ? "bg-[var(--brand-primary)] text-white"
                                    : "text-[var(--text-main)] hover:bg-[var(--bg-soft)]"
                                }`}
                                onClick={() =>
                                  setEditingImagingReferral((current) => {
                                    if (!current) return current;
                                    const isSelected = current.regions.includes(region);
                                    const nextRegions = isSelected
                                      ? current.regions.filter((r) => r !== region)
                                      : [...current.regions, region];
                                    const nextFlexExt = isSelected
                                      ? current.flexExtRegions.filter((r) => r !== region)
                                      : current.flexExtRegions;
                                    const nextLaterality = { ...current.lateralityByRegion };
                                    if (isSelected) {
                                      delete nextLaterality[region];
                                    } else if (supportsRegionLaterality(region) && !nextLaterality[region]) {
                                      // Default to bilateral when a lateralizable
                                      // region is newly added; user can pick L/R.
                                      nextLaterality[region] = "BL";
                                    }
                                    return {
                                      ...current,
                                      regions: nextRegions,
                                      flexExtRegions: nextFlexExt,
                                      lateralityByRegion: nextLaterality,
                                    };
                                  })
                                }
                                type="button"
                              >
                                {region}
                              </button>
                              {selected && hasLaterality && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--bg-soft)] p-0.5">
                                  {lateralityOptions.map((option) => (
                                    <button
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                                        currentLaterality === option
                                          ? "bg-[var(--brand-primary)] text-white"
                                          : "text-[var(--text-muted)] hover:bg-white"
                                      }`}
                                      key={`edit-lat-${region}-${option}`}
                                      onClick={() =>
                                        setEditingImagingReferral((current) =>
                                          current
                                            ? {
                                                ...current,
                                                lateralityByRegion: {
                                                  ...current.lateralityByRegion,
                                                  [region]: option,
                                                },
                                              }
                                            : current,
                                        )
                                      }
                                      type="button"
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">
                      Click a region to add / remove. For lateralizable regions (shoulder, etc), L / R / BL buttons
                      appear next to the pill so you can mark the side.
                    </span>
                  </>
                )}
              </div>

              <label className="grid gap-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Findings</span>
                  {/* Quick scaffold from the selected regions — drops a
                      labeled "Region:\n\n" block per region into the
                      textarea so the user can paste the radiologist's
                      prose under each header instead of typing the
                      headers by hand. Confirms before overwriting any
                      content the user already entered. */}
                  <button
                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-primary)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)]"
                    disabled={editingImagingReferral.regions.length === 0}
                    onClick={() => {
                      const template = buildFindingsTemplate(
                        editingImagingReferral.regions,
                        editingImagingReferral.lateralityByRegion,
                      );
                      if (!template) return;
                      const existing = editingImagingReferral.findings ?? "";
                      if (existing.trim().length > 0) {
                        const proceed = window.confirm(
                          "Replace the existing findings text with the region template? " +
                            "Anything you've typed will be lost.",
                        );
                        if (!proceed) return;
                      }
                      setEditingImagingReferral((current) =>
                        current ? { ...current, findings: template } : current,
                      );
                    }}
                    title={
                      editingImagingReferral.regions.length === 0
                        ? "Pick at least one region first"
                        : "Fill the findings area with one labeled section per region"
                    }
                    type="button"
                  >
                    ⤵ Insert Region Template
                  </button>
                </div>
                <textarea
                  // resize: both — drag the corner handle to grow wider
                  // AND taller. min-w-full keeps it full-width by default
                  // but doesn't fight the inline `width` style the browser
                  // sets when the user drags the handle outward (which is
                  // what `w-full`/`width: 100%` did — it snapped the
                  // textarea back to parent width every render, so the
                  // horizontal drag appeared to do nothing).
                  className="min-h-[160px] min-w-full resize rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setEditingImagingReferral((current) =>
                      current ? { ...current, findings: event.target.value } : current,
                    )
                  }
                  placeholder={`Enter ${editingImagingReferral.modalityLabel} findings...`}
                  // Cap the drag-resize at 60vh so a long radiology report
                  // has plenty of room. Save/Cancel below are sticky to
                  // the form's scroll viewport, so even if the textarea
                  // hits this cap the user can always reach them without
                  // scrolling — the previous 40vh cap combined with a
                  // non-sticky footer was what made the user feel like
                  // they had to Close to escape.
                  style={{ maxHeight: "60vh" }}
                  value={editingImagingReferral.findings}
                />
              </label>
            </div>

            {/* Sticky footer — buttons stay pinned to the bottom of the
                form's scroll viewport so dragging the textarea taller
                never hides them. Negative margins extend the bg/border
                to the form's padding edges; bg-white covers content
                that scrolls underneath. */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex justify-end gap-2 border-t border-[var(--line-soft)] bg-white px-4 py-3">
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
          <ScrollLock />
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

      {showAddDxModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8">
          <ScrollLock />
          <form
            className="panel-card mx-auto w-full max-w-md p-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveDx();
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Add Diagnosis Code</h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={() => setShowAddDxModal(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              Adds a new ICD-10 code to your library (same as Settings) and to this patient.
            </p>
            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Code</span>
                <input
                  autoFocus
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setDxCode(e.target.value)}
                  placeholder="e.g. M54.5"
                  value={dxCode}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Description</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setDxDescription(e.target.value)}
                  placeholder="e.g. Low back pain"
                  value={dxDescription}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Folder</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(e) => setDxFolderId(e.target.value)}
                  value={dxFolderId}
                >
                  {billingMacros.diagnosisFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {dxError && <p className="mt-3 text-sm font-semibold text-red-600">{dxError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold"
                onClick={() => setShowAddDxModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white"
                type="submit"
              >
                Add Code
              </button>
            </div>
          </form>
        </div>
      )}

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
          <ScrollLock />
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RichTextTemplateEditor, type RichTextTemplateEditorHandle } from "@/components/rich-text-template-editor";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { useEncounterNotes } from "@/hooks/use-encounter-notes";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useScheduleAppointments } from "@/hooks/use-schedule-appointments";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import {
  createEncounterMacroRunId,
  encounterSections,
  normalizeEncounterDateInput,
  type EncounterMacroRunRecord,
  type EncounterSection,
} from "@/lib/encounter-notes";
import {
  formatMacroAnswerValue,
  groupMacrosByFolder,
  renderMacroPromptSpan,
  renderMacroTemplateWithPromptSpans,
  type MacroAnswerMap,
  type MacroTemplate,
} from "@/lib/macro-templates";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { patients } from "@/lib/mock-data";
import {
  appointmentStatusOptions,
  formatAppointmentStatusLabel,
  formatTimeLabel,
  getStatusBadgeClass,
  isAppointmentStatusSelectable,
  confirmStatusChangeIfNeeded,
  type AppointmentStatus,
} from "@/lib/schedule-appointments";

type EncounterWorkspaceProps = {
  initialPatientId?: string;
  initialEncounterId?: string;
};

/**
 * Walk an HTML string and replace every `data-macro-run-id="X"` attribute
 * with a freshly generated id, returning the rewritten HTML and a map from
 * old ids to new ids. Used by SALT to copy macro snippets from one encounter
 * to another while keeping each macro run uniquely tied to its destination.
 */
function rewriteMacroRunIds(html: string): { html: string; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const next = html.replace(
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
  return { html: next, idMap };
}

function getNames(fullName: string) {
  const [lastName = "", firstName = ""] = fullName.split(",").map((value) => value.trim());
  return { firstName, lastName };
}

function normalizeLookupText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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

  return "";
}

function parseUsDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getFullYear() !== year
  ) {
    return null;
  }
  return date;
}

function getAgeFromDob(dob: string) {
  const parsed = parseUsDate(toUsDate(dob));
  if (!parsed) {
    return "";
  }
  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const monthDiff = now.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < parsed.getDate())) {
    age -= 1;
  }
  return age > 0 ? `${age}` : "";
}

function getPronouns(sex?: string) {
  const normalized = (sex ?? "").toLowerCase();
  if (normalized === "female") {
    return { heShe: "she", himHer: "her", hisHer: "her" };
  }
  if (normalized === "male") {
    return { heShe: "he", himHer: "him", hisHer: "his" };
  }
  return { heShe: "they", himHer: "them", hisHer: "their" };
}

function getHonorifics(sex?: string, maritalStatus?: string, lastName?: string) {
  const normalizedSex = (sex ?? "").toLowerCase();
  const normalizedMarital = (maritalStatus ?? "").toLowerCase();
  let formal = "Mx.";
  let neutral = "Mx.";
  if (normalizedSex === "male") {
    formal = "Mr.";
    neutral = "Mr.";
  } else if (normalizedSex === "female") {
    formal = normalizedMarital === "married" ? "Mrs." : "Ms.";
    neutral = "Ms.";
  }
  const safeLastName = (lastName ?? "").trim();
  return {
    mrMrsMs: formal,
    mrMs: neutral,
    mrMrsMsLastName: safeLastName ? `${formal} ${safeLastName}` : formal,
    mrMsLastName: safeLastName ? `${neutral} ${safeLastName}` : neutral,
  };
}

function toSortStamp(encounterDate: string) {
  const parsedDate = parseUsDate(encounterDate);
  if (!parsedDate) {
    return 0;
  }
  const stamp = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

const sectionLabels: Record<EncounterSection, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSoapText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "-";
  // The SOAP sections are stored as HTML from the rich-text editor.
  // Render the HTML directly for print but strip any interactive elements
  // (inline-prompt spans, editable macro pills). Keep basic formatting
  // like <b>, <u>, <br>, <p>, <div>, <span>.
  return trimmed;
}

function buildSoapPrintHtml(config: {
  officeName: string;
  officeAddress: string;
  officePhone: string;
  officeFax: string;
  officeEmail: string;
  logoDataUrl: string;
  patientName: string;
  documentTitle?: string;
  encounters: Array<{
    id: string;
    encounterDate: string;
    provider: string;
    appointmentType: string;
    signed: boolean;
    soap: Record<EncounterSection, string>;
  }>;
}) {
  const logoMarkup = config.logoDataUrl.trim()
    ? `<img alt="Office Logo" src="${escapeHtml(config.logoDataUrl)}" class="logo" />`
    : "";

  const encounterMarkup = config.encounters
    .map((encounter, idx) => {
      const sections = [
        { label: "Subjective", content: formatSoapText(encounter.soap.subjective) },
        { label: "Objective", content: formatSoapText(encounter.soap.objective) },
        { label: "Assessment", content: formatSoapText(encounter.soap.assessment) },
        { label: "Plan", content: formatSoapText(encounter.soap.plan) },
      ];

      return `<section class="encounter">
  <div class="encounter-header">
    <div class="encounter-date">${escapeHtml(encounter.encounterDate)}</div>
    <div class="encounter-type">${escapeHtml(encounter.appointmentType)}</div>
  </div>
  <div class="encounter-meta">
    <span>Provider: <strong>${escapeHtml(encounter.provider)}</strong></span>
  </div>
  ${sections
    .map(
      (s) => `
  <div class="soap-section">
    <div class="soap-label">${s.label}</div>
    <div class="soap-content">${s.content}</div>
  </div>`,
    )
    .join("")}
</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(config.documentTitle || `SOAP Notes - ${config.patientName}`)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background: #fff;
        color: #1a1a1a;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.4;
      }

      /* ── Letterhead ── */
      .letterhead {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding-bottom: 8px;
        border-bottom: 2px solid #0d79bf;
        margin-bottom: 10px;
      }
      .logo {
        height: 70px;
        width: auto;
        max-width: 200px;
        object-fit: contain;
        flex-shrink: 0;
        display: block;
        margin: 0;
        padding: 0;
      }
      .office-info {
        flex: 1;
        text-align: right;
        margin: 0;
        padding: 0;
      }
      .office-name {
        font-size: 15px;
        font-weight: 700;
        color: #0d79bf;
        margin: 0;
        padding: 0;
        line-height: 1.2;
      }
      .office-detail {
        font-size: 11px;
        color: #444;
        line-height: 1.5;
        margin: 0;
      }

      /* ── Patient banner ── */
      .patient-banner {
        background: #f0f6fb;
        border: 1px solid #d0dfe9;
        border-radius: 4px;
        padding: 6px 10px;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .patient-banner .label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #5a7a8f;
      }
      .patient-banner .name {
        font-size: 14px;
        font-weight: 700;
        color: #13293d;
      }
      .patient-banner .doc-title {
        font-size: 11px;
        font-weight: 600;
        color: #0d79bf;
      }

      /* ── Encounter card ── */
      .encounter {
        border: 1px solid #d0dfe9;
        border-radius: 4px;
        margin-bottom: 8px;
      }
      .encounter-header {
        background: #0d79bf;
        color: #fff;
        padding: 4px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .encounter-date {
        font-size: 12px;
        font-weight: 700;
      }
      .encounter-type {
        font-size: 11px;
        opacity: 0.9;
      }
      .encounter-meta {
        background: #f7fafc;
        padding: 3px 10px;
        border-bottom: 1px solid #e2eaf0;
        font-size: 10px;
        color: #5a7a8f;
        display: flex;
        gap: 16px;
      }

      /* ── SOAP sections ── */
      .soap-section {
        padding: 4px 10px;
        border-bottom: 1px solid #eef2f6;
      }
      .soap-section:last-child {
        border-bottom: none;
      }
      .soap-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #0d79bf;
        margin-bottom: 2px;
      }
      .soap-content {
        font-size: 12px;
        line-height: 1.45;
        color: #1a1a1a;
        word-break: break-word;
      }
      .soap-content p { margin: 0 0 3px 0; }
      .soap-content b, .soap-content strong { font-weight: 700; }
      .soap-content span { font-size: inherit; color: inherit; }

      /* ── Footer ── */
      .print-footer {
        margin-top: 14px;
        padding-top: 6px;
        border-top: 1px solid #d0dfe9;
        font-size: 9px;
        color: #8899a6;
        text-align: center;
      }

      @page {
        size: Letter;
        margin: 0.5in;
      }
      @media print {
        * { break-inside: auto !important; break-before: auto !important; break-after: auto !important; }
        .encounter { page-break-inside: auto !important; page-break-before: auto !important; }
      }
    </style>
  </head>
  <body>
    <main class="wrapper">
      <header class="letterhead">
        ${logoMarkup}
        <div class="office-info">
          <p class="office-name">${escapeHtml(config.officeName)}</p>
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

      ${encounterMarkup || "<p>No encounters found for this patient.</p>"}

      <div class="print-footer">
        ${escapeHtml(config.officeName)} &bull; Confidential Medical Record
      </div>
    </main>
  </body>
</html>`;
}

function printHtmlWithIframeFallback(printableHtml: string) {
  const popup = window.open("", "_blank");
  if (popup) {
    popup.document.open();
    popup.document.write(printableHtml);
    popup.document.close();
    if (popup.document.readyState === "complete") {
      setTimeout(() => {
        popup.focus();
        popup.print();
      }, 80);
    } else {
      popup.onload = () => {
        setTimeout(() => {
          popup.focus();
          popup.print();
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

function AppointmentsOverview({
  appointments,
  encounters,
  patients: patientList,
  onCreateEncounter,
  onOpenEncounter,
}: {
  appointments: Array<{ id: string; patientId: string; patientName: string; appointmentType: string; date: string; startTime: string; status: string }>;
  encounters: Array<{ id: string; patientId: string; encounterDate: string; signed: boolean; patientName: string; appointmentType: string }>;
  patients: Array<{ id: string; fullName: string }>;
  officeSettings: { doctorName: string };
  appointmentTypes: Array<{ name: string }>;
  onCreateEncounter: (appointmentId: string, patientId: string, patientName: string, appointmentType: string, date: string) => void;
  onOpenEncounter: (encounterId: string, patientName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Use local date, not UTC — toISOString() returns UTC which shifts
  // the date forward in US timezones during evening hours.
  const today = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const todayAppointments = useMemo(() => {
    return appointments
      .filter((a) => a.date === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [appointments, today]);

  const getLinkedEncounter = (appointment: { patientId: string; date: string }) => {
    const dateUs = (() => {
      const [y, m, d] = appointment.date.split("-");
      return `${m}/${d}/${y}`;
    })();
    return encounters.find(
      (e) => e.patientId === appointment.patientId && e.encounterDate === dateUs,
    );
  };

  return (
    <section className="panel-card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <h3 className="text-lg font-semibold">Today&apos;s Appointments</h3>
          <p className="text-sm text-[var(--text-muted)]">
            {todayAppointments.length} appointment{todayAppointments.length !== 1 ? "s" : ""} scheduled
          </p>
        </div>
        <span
          aria-hidden
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          ⌄
        </span>
      </button>

      {expanded && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg-soft)] text-left">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Encounter</th>
              </tr>
            </thead>
            <tbody>
              {todayAppointments.map((apt) => {
                const linked = getLinkedEncounter(apt);
                const canStart = apt.status === "Check In" || apt.status === "Check Out";
                return (
                  <tr key={apt.id} className="border-t border-[var(--line-soft)]">
                    <td className="px-3 py-2 tabular-nums">{formatTimeLabel(apt.startTime)}</td>
                    <td className="px-3 py-2 font-semibold">{apt.patientName}</td>
                    <td className="px-3 py-2">{apt.appointmentType}</td>
                    <td className="px-3 py-2">{formatAppointmentStatusLabel(apt.status)}</td>
                    <td className="px-3 py-2">
                      {linked ? (
                        <button
                          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                          onClick={() => onOpenEncounter(linked.id, apt.patientName)}
                          type="button"
                        >
                          {linked.signed ? "View Encounter" : "Open Encounter"}
                        </button>
                      ) : (
                        <button
                          className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                            canStart
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "cursor-not-allowed border-[var(--line-soft)] bg-[var(--bg-soft)] text-[var(--text-muted)]"
                          }`}
                          disabled={!canStart}
                          onClick={() => {
                            const dateUs = (() => {
                              const [y, m, d] = apt.date.split("-");
                              return `${m}/${d}/${y}`;
                            })();
                            onCreateEncounter(apt.id, apt.patientId, apt.patientName, apt.appointmentType, dateUs);
                          }}
                          title={
                            canStart
                              ? "Start encounter"
                              : "Patient must be Checked In before starting an encounter"
                          }
                          type="button"
                        >
                          + Encounter
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {todayAppointments.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-[var(--text-muted)]" colSpan={5}>
                    No appointments scheduled for today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function EncounterWorkspace({ initialPatientId, initialEncounterId }: EncounterWorkspaceProps) {
  const { macroLibrary } = useMacroTemplates();
  const { billingMacros } = useBillingMacros();
  const { officeSettings } = useOfficeSettings();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { scheduleAppointments, updateAppointment } = useScheduleAppointments();
  const {
    encountersByNewest,
    createEncounter,
    updateEncounter,
    setSoapSection,
    addMacroRun,
    updateMacroRun,
    removeMacroRun,
    appendSoapSection,
    addCharge,
    addChargesBulk,
    updateCharge,
    removeCharge,
    moveCharge,
    setSigned,
    deleteEncounter,
    forceSaveAll,
  } = useEncounterNotes();

  const { contacts: allContacts } = useContactDirectory();
  const specialistContactNames = useMemo(() => {
    const nonSpecialistCategories = new Set(["attorney", "imaging", "hospital/er"]);
    return allContacts
      .filter((c) => !nonSpecialistCategories.has(c.category.toLowerCase()))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));
  }, [allContacts]);

  const initialEncounterSearchValue = useMemo(() => {
    if (!initialPatientId) {
      return "";
    }
    return patients.find((entry) => entry.id === initialPatientId)?.fullName ?? "";
  }, [initialPatientId]);

  const soapEditorRef = useRef<RichTextTemplateEditorHandle>(null);
  const [activeSection, setActiveSection] = useState<EncounterSection>("subjective");
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(initialEncounterId ?? null);
  const [encounterSearch, setEncounterSearch] = useState(initialEncounterSearchValue);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [message, setMessage] = useState("");
  const [printSelectionByPatient, setPrintSelectionByPatient] = useState<Record<string, string[]>>({});
  const [openChargesPanel, setOpenChargesPanel] = useState(false);
  const [chargeSearch, setChargeSearch] = useState("");
  const [aptDateSort, setAptDateSort] = useState<"newest" | "oldest">("newest");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [showPriorChargesPreview, setShowPriorChargesPreview] = useState(false);

  const [runMacroId, setRunMacroId] = useState<string | null>(null);
  const [editingMacroRunId, setEditingMacroRunId] = useState<string | null>(null);
  const [runMacroAnswers, setRunMacroAnswers] = useState<MacroAnswerMap>({});
  // When set, the macro picker dialog is editing a single prompt only — used
  // when the user taps an inline prompt span in the SOAP editor and wants to
  // change just that one answer without re-running the whole macro.
  const [editingMacroPromptId, setEditingMacroPromptId] = useState<string | null>(null);
  const [saltSourceEncounterIdDraft, setSaltSourceEncounterIdDraft] = useState("");
  const [autoSalt, setAutoSalt] = useState(false);
  const [autoSaltCharges, setAutoSaltCharges] = useState(false);

  const selectedEncounterPatientId = useMemo(() => {
    if (!selectedEncounterId) {
      return null;
    }
    return encountersByNewest.find((entry) => entry.id === selectedEncounterId)?.patientId ?? null;
  }, [encountersByNewest, selectedEncounterId]);

  const filteredEncounterList = useMemo(() => {
    const query = normalizeLookupText(encounterSearch);
    if (!query) {
      return [];
    }
    const scopedEntries = encountersByNewest
      .filter((entry) => {
        if (statusFilter === "open") {
          return !entry.signed;
        }
        if (statusFilter === "closed") {
          return entry.signed;
        }
        return true;
      })
      .filter((entry) => {
        return normalizeLookupText(entry.patientName).includes(query);
      });
    if (!scopedEntries.length) {
      return [];
    }

    const activePatientId =
      selectedEncounterPatientId &&
      scopedEntries.some((entry) => entry.patientId === selectedEncounterPatientId)
        ? selectedEncounterPatientId
        : scopedEntries[0]?.patientId ?? null;
    if (!activePatientId) {
      return [];
    }

    return scopedEntries
      .filter((entry) => entry.patientId === activePatientId)
      .sort((left, right) => {
        const byDate = toSortStamp(right.encounterDate) - toSortStamp(left.encounterDate);
        if (byDate !== 0) {
          return byDate;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [encounterSearch, encountersByNewest, selectedEncounterPatientId, statusFilter]);

  const initialPatientEncounterId = useMemo(() => {
    if (!initialPatientId) {
      return null;
    }
    return encountersByNewest.find((entry) => entry.patientId === initialPatientId)?.id ?? null;
  }, [encountersByNewest, initialPatientId]);

  const resolvedEncounterId =
    selectedEncounterId && encountersByNewest.some((entry) => entry.id === selectedEncounterId)
      ? selectedEncounterId
      : initialPatientEncounterId && filteredEncounterList.some((entry) => entry.id === initialPatientEncounterId)
        ? initialPatientEncounterId
        : filteredEncounterList[0]?.id ?? null;

  const selectedEncounter = useMemo(
    () => encountersByNewest.find((entry) => entry.id === resolvedEncounterId) ?? null,
    [encountersByNewest, resolvedEncounterId],
  );

  const selectedPatient = useMemo(
    () =>
      (selectedEncounter
        ? patients.find((entry) => entry.id === selectedEncounter.patientId)
        : null) ?? null,
    [selectedEncounter],
  );
  const priorPatientEncounters = useMemo(() => {
    if (!selectedEncounter) {
      return [];
    }
    // Only include encounters dated strictly BEFORE the current encounter so
    // the user can never accidentally SALT-copy from a future visit into a
    // back-dated note.
    const currentStamp = toSortStamp(selectedEncounter.encounterDate);
    return encountersByNewest
      .filter(
        (entry) =>
          entry.patientId === selectedEncounter.patientId &&
          entry.id !== selectedEncounter.id &&
          toSortStamp(entry.encounterDate) < currentStamp,
      )
      .sort((left, right) => {
        const byDate = toSortStamp(right.encounterDate) - toSortStamp(left.encounterDate);
        if (byDate !== 0) {
          return byDate;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [encountersByNewest, selectedEncounter]);
  const filteredEncounterListByOldest = useMemo(
    () =>
      [...filteredEncounterList].sort((left, right) => {
        const byDate = toSortStamp(left.encounterDate) - toSortStamp(right.encounterDate);
        if (byDate !== 0) {
          return byDate;
        }
        return left.updatedAt.localeCompare(right.updatedAt);
      }),
    [filteredEncounterList],
  );
  const filteredEncounterPatientId = filteredEncounterList[0]?.patientId ?? null;
  const filteredEncounterPatientName = filteredEncounterList[0]?.patientName ?? "";
  const allPatientAppointments = useMemo(() => {
    if (!filteredEncounterPatientId) return [];
    return scheduleAppointments.filter((a) => a.patientId === filteredEncounterPatientId);
  }, [filteredEncounterPatientId, scheduleAppointments]);

  const patientAppointments = useMemo(() => {
    const dir = aptDateSort === "newest" ? -1 : 1;
    return allPatientAppointments
      .filter((apt) => {
        if (!hideCompleted) return true;
        // "Completed" = Check Out AND encounter is closed (signed)
        if (apt.status === "Check Out") {
          const dateUs = (() => {
            const [y, m, d] = apt.date.split("-");
            return `${m}/${d}/${y}`;
          })();
          const linked = encountersByNewest.find(
            (e) => e.patientId === apt.patientId && e.encounterDate === dateUs,
          );
          // Only hide if encounter exists AND is signed (fully done)
          if (linked?.signed) return false;
        }
        // Also hide cancelled if hiding completed
        if (apt.status === "Canceled") return false;
        return true;
      })
      .sort((a, b) => dir * a.date.localeCompare(b.date) || dir * a.startTime.localeCompare(b.startTime));
  }, [allPatientAppointments, aptDateSort, hideCompleted, encountersByNewest]);
  const appointmentTypeOptions = useMemo(() => {
    const names = appointmentTypes.map((entry) => entry.name);
    if (selectedEncounter && !names.includes(selectedEncounter.appointmentType)) {
      return [selectedEncounter.appointmentType, ...names];
    }
    return names;
  }, [appointmentTypes, selectedEncounter]);
  const linkedAppointmentsForEncounter = useMemo(() => {
    if (!selectedEncounter) {
      return [];
    }
    return scheduleAppointments
      .filter(
        (entry) =>
          entry.patientId === selectedEncounter.patientId &&
          toUsDate(entry.date) === selectedEncounter.encounterDate,
      )
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }, [scheduleAppointments, selectedEncounter]);
  const linkedAppointmentForStatus = useMemo(() => {
    if (!selectedEncounter) {
      return null;
    }
    return (
      linkedAppointmentsForEncounter.find(
        (entry) => entry.appointmentType.toLowerCase() === selectedEncounter.appointmentType.toLowerCase(),
      ) ??
      linkedAppointmentsForEncounter[0] ??
      null
    );
  }, [linkedAppointmentsForEncounter, selectedEncounter]);
  const scheduleStatusValue: AppointmentStatus = linkedAppointmentForStatus?.status ?? "Scheduled";
  const selectedSoapPrintEncounterIds = useMemo(() => {
    if (!filteredEncounterPatientId) {
      return [];
    }
    const explicit = printSelectionByPatient[filteredEncounterPatientId];
    if (explicit) {
      const allowedIds = new Set(filteredEncounterListByOldest.map((entry) => entry.id));
      return explicit.filter((entryId) => allowedIds.has(entryId));
    }
    return [];
  }, [filteredEncounterListByOldest, filteredEncounterPatientId, printSelectionByPatient]);
  const resolvedSaltSourceEncounterId = priorPatientEncounters.some(
    (entry) => entry.id === saltSourceEncounterIdDraft,
  )
    ? saltSourceEncounterIdDraft
    : priorPatientEncounters[0]?.id ?? "";
  const saltSourceEncounter = useMemo(
    () =>
      priorPatientEncounters.find(
        (entry) => entry.id === resolvedSaltSourceEncounterId,
      ) ?? null,
    [priorPatientEncounters, resolvedSaltSourceEncounterId],
  );

  // Track which encounter we last auto-salted into so we don't repeat
  const autoSaltedRef = useRef<string | null>(null);
  const autoSaltedChargesRef = useRef<string | null>(null);

  // Auto-Salt: when enabled and a new encounter is selected that has empty SOAP,
  // automatically copy all SOAP sections from the most recent prior encounter.
  useEffect(() => {
    if (!autoSalt) return;
    if (!selectedEncounter) return;
    if (selectedEncounter.signed) return;
    if (!saltSourceEncounter) return;
    // Don't re-salt the same encounter
    if (autoSaltedRef.current === selectedEncounter.id) return;

    // Only auto-salt if all SOAP sections are empty
    const allEmpty = encounterSections.every(
      (section) => selectedEncounter.soap[section].trim().length === 0,
    );
    if (!allEmpty) {
      // Mark as "already handled" so switching away and back doesn't re-check
      autoSaltedRef.current = selectedEncounter.id;
      return;
    }

    // Copy all SOAP from the most recent prior encounter
    autoSaltedRef.current = selectedEncounter.id;
    const sectionsWithText = encounterSections.filter(
      (section) => saltSourceEncounter.soap[section].trim().length > 0,
    );
    if (sectionsWithText.length === 0) return;

    let totalMacros = 0;
    sectionsWithText.forEach((section) => {
      const sourceText = saltSourceEncounter.soap[section].trim();
      const { html: rewrittenText, idMap } = rewriteMacroRunIds(sourceText);
      setSoapSection(selectedEncounter.id, section, rewrittenText);
      idMap.forEach((newId, oldId) => {
        const sourceRun = saltSourceEncounter.macroRuns.find((entry) => entry.id === oldId);
        if (!sourceRun) return;
        addMacroRun(selectedEncounter.id, {
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
        totalMacros += 1;
      });
    });
    const macroSuffix = totalMacros > 0 ? ` (with ${totalMacros} editable macro${totalMacros === 1 ? "" : "s"})` : "";
    setMessage(
      `Auto-Salted ${sectionsWithText.length} SOAP section${sectionsWithText.length === 1 ? "" : "s"} from ${saltSourceEncounter.encounterDate}${macroSuffix}.`,
    );
  }, [autoSalt, selectedEncounter, saltSourceEncounter, setSoapSection, addMacroRun]);

  // Auto-Salt Charges: when enabled and a new encounter is selected that has no charges,
  // automatically copy charges from the most recent prior encounter.
  useEffect(() => {
    if (!autoSaltCharges) return;
    if (!selectedEncounter) return;
    if (selectedEncounter.signed) return;
    if (!saltSourceEncounter) return;
    if (autoSaltedChargesRef.current === selectedEncounter.id) return;

    // Only auto-salt charges if encounter has no charges yet
    if (selectedEncounter.charges.length > 0) {
      autoSaltedChargesRef.current = selectedEncounter.id;
      return;
    }

    autoSaltedChargesRef.current = selectedEncounter.id;
    if (saltSourceEncounter.charges.length === 0) return;

    const copiedCount = addChargesBulk(
      selectedEncounter.id,
      saltSourceEncounter.charges.map((charge) => ({
        treatmentMacroId: charge.treatmentMacroId,
        name: charge.name,
        procedureCode: charge.procedureCode,
        unitPrice: charge.unitPrice,
        units: charge.units,
      })),
    );
    if (copiedCount > 0) {
      setMessage(
        `Auto-Salted ${copiedCount} charge${copiedCount === 1 ? "" : "s"} from ${saltSourceEncounter.encounterDate}.`,
      );
    }
  }, [autoSaltCharges, selectedEncounter, saltSourceEncounter, addChargesBulk]);

  const sectionMacros = useMemo(
    () =>
      macroLibrary.templates.filter(
        (entry) => entry.section === activeSection && entry.active,
      ),
    [activeSection, macroLibrary.templates],
  );

  const sectionMacroFolderGroups = useMemo(
    () => groupMacrosByFolder(sectionMacros),
    [sectionMacros],
  );

  const [macroFoldersCollapsed, setMacroFoldersCollapsed] = useState<Set<string>>(new Set());
  const toggleMacroFolder = (folder: string) => {
    setMacroFoldersCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  };

  const activeTreatments = useMemo(
    () => billingMacros.treatments.filter((entry) => entry.active),
    [billingMacros.treatments],
  );

  const filteredActiveTreatments = useMemo(() => {
    const query = chargeSearch.trim().toLowerCase();
    if (!query) {
      return activeTreatments;
    }
    return activeTreatments.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(query) ||
        entry.procedureCode.toLowerCase().includes(query)
      );
    });
  }, [activeTreatments, chargeSearch]);

  const runMacro = useMemo(
    () => macroLibrary.templates.find((entry) => entry.id === runMacroId) ?? null,
    [macroLibrary.templates, runMacroId],
  );
  const sectionMacroRuns = useMemo(() => {
    if (!selectedEncounter) {
      return [];
    }
    return selectedEncounter.macroRuns
      .filter((entry) => entry.section === activeSection)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [activeSection, selectedEncounter]);
  const editingMacroRun = useMemo(() => {
    if (!editingMacroRunId) {
      return null;
    }
    return sectionMacroRuns.find((entry) => entry.id === editingMacroRunId) ?? null;
  }, [editingMacroRunId, sectionMacroRuns]);

  const buildMacroContext = (patientId: string): Record<string, string> => {
    const patient = patients.find((entry) => entry.id === patientId);
    const names = getNames(patient?.fullName ?? "");
    const pronouns = getPronouns(patient?.sex);
    const honorifics = getHonorifics(patient?.sex, patient?.maritalStatus, names.lastName);
    return {
      FIRST_NAME: names.firstName,
      LAST_NAME: names.lastName,
      FULL_NAME: `${names.firstName} ${names.lastName}`.trim(),
      AGE: getAgeFromDob(patient?.dob ?? ""),
      SEX: patient?.sex ?? "",
      DOB: toUsDate(patient?.dob ?? ""),
      INJURY_DATE: toUsDate(patient?.dateOfLoss ?? ""),
      ATTORNEY: patient?.attorney ?? "",
      HE_SHE: pronouns.heShe,
      HIM_HER: pronouns.himHer,
      HIS_HER: pronouns.hisHer,
      MR_MRS_MS_LAST_NAME: honorifics.mrMrsMsLastName,
    };
  };

  const applyMacroTemplate = (
    macro: MacroTemplate,
    answers: MacroAnswerMap,
    existingRun?: EncounterMacroRunRecord | null,
  ) => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to add SOAP macro text.");
      return;
    }
    const context = buildMacroContext(selectedEncounter.patientId);
    // Inject specialist picker selection into context if present
    const specialistAnswer = answers.__specialist_referred__;
    if (typeof specialistAnswer === "string" && specialistAnswer.trim()) {
      context.SPECIALIST_REFERRED = specialistAnswer.trim();
    }
    const snippetId = existingRun?.id ?? createEncounterMacroRunId();
    // Render the full macro body with each prompt answer wrapped in an inline
    // atomic span. The static parts of the macro stay editable; only the
    // answer pills are read-only and re-tappable.
    const generatedText = renderMacroTemplateWithPromptSpans(
      macro.body,
      answers,
      context,
      snippetId,
    );
    if (!generatedText) {
      setMessage("Generated macro output was empty.");
      return;
    }

    if (existingRun) {
      const currentSectionText = selectedEncounter.soap[activeSection];
      let nextSectionText = currentSectionText;

      // 1) New format — surgical per-prompt-span replacement so the user's
      //    edits to the static text are preserved.
      const hasPromptSpans = new RegExp(
        `data-macro-run-id=["']${snippetId}["'][^>]*data-prompt-id=`,
        "i",
      ).test(currentSectionText);

      // 2) Legacy format — old single wrapper around the entire macro output.
      const legacyWrapperPattern = new RegExp(
        `<(?:div|span)[^>]*data-macro-run-id=["']${snippetId}["'](?![^>]*data-prompt-id)[^>]*>[\\s\\S]*?</(?:div|span)>`,
        "i",
      );

      if (hasPromptSpans) {
        macro.questions.forEach((question) => {
          const replacement = renderMacroPromptSpan(
            snippetId,
            question.id,
            formatMacroAnswerValue(answers[question.id]),
          );
          const promptPattern = new RegExp(
            `<span[^>]*data-macro-run-id=["']${snippetId}["'][^>]*data-prompt-id=["']${question.id}["'][^>]*>[\\s\\S]*?</span>`,
            "gi",
          );
          nextSectionText = nextSectionText.replace(promptPattern, replacement);
        });
      } else if (legacyWrapperPattern.test(currentSectionText)) {
        nextSectionText = currentSectionText.replace(legacyWrapperPattern, generatedText);
      } else {
        // Couldn't locate the original macro output — append fresh.
        nextSectionText = currentSectionText.trim()
          ? `${currentSectionText.trim()}\n${generatedText}`
          : generatedText;
      }

      setSoapSection(selectedEncounter.id, activeSection, nextSectionText);
      updateMacroRun(selectedEncounter.id, existingRun.id, {
        answers: { ...answers },
        generatedText,
      });
      setMessage(`${sectionLabels[activeSection]} macro updated: ${macro.buttonName}.`);
      return;
    }

    appendSoapSection(selectedEncounter.id, activeSection, generatedText);
    addMacroRun(selectedEncounter.id, {
      id: snippetId,
      section: activeSection,
      macroId: macro.id,
      macroName: macro.buttonName,
      body: macro.body,
      answers: { ...answers },
      generatedText,
    });
    setMessage(`${sectionLabels[activeSection]} updated from macro: ${macro.buttonName}.`);
  };

  const handleRunMacroClick = (macro: MacroTemplate) => {
    if (!selectedEncounter) {
      setMessage("Select an encounter first.");
      return;
    }
    const needsSpecialistPicker = /\{\{\s*SPECIALIST_REFERRED\s*\}\}/.test(macro.body);
    if (!macro.questions.length && !needsSpecialistPicker) {
      applyMacroTemplate(macro, {});
      return;
    }
    const initialAnswers: MacroAnswerMap = {};
    macro.questions.forEach((question) => {
      if (question.multiSelect) {
        initialAnswers[question.id] = [];
        return;
      }
      initialAnswers[question.id] = question.options[0] ?? "";
    });
    if (needsSpecialistPicker) {
      initialAnswers.__specialist_referred__ = specialistContactNames[0] ?? "";
    }
    setEditingMacroRunId(null);
    setRunMacroAnswers(initialAnswers);
    setRunMacroId(macro.id);
  };

  const handleEditExistingMacroRun = (
    run: EncounterMacroRunRecord,
    onlyPromptId: string | null = null,
  ) => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to edit macro answers.");
      return;
    }
    const macro = macroLibrary.templates.find((entry) => entry.id === run.macroId);
    if (!macro || !macro.active) {
      setMessage("This macro is unavailable. It may have been removed or deactivated.");
      return;
    }
    const initialAnswers: MacroAnswerMap = {};
    macro.questions.forEach((question) => {
      const savedValue = run.answers[question.id];
      if (question.multiSelect) {
        if (Array.isArray(savedValue)) {
          initialAnswers[question.id] = savedValue;
        } else if (typeof savedValue === "string" && savedValue.trim()) {
          initialAnswers[question.id] = [savedValue.trim()];
        } else {
          initialAnswers[question.id] = [];
        }
        return;
      }
      if (Array.isArray(savedValue)) {
        initialAnswers[question.id] = savedValue[0] ?? question.options[0] ?? "";
        return;
      }
      initialAnswers[question.id] = savedValue ?? question.options[0] ?? "";
    });
    if (/\{\{\s*SPECIALIST_REFERRED\s*\}\}/.test(macro.body)) {
      const saved = run.answers.__specialist_referred__;
      initialAnswers.__specialist_referred__ = (typeof saved === "string" ? saved : "") || specialistContactNames[0] || "";
    }
    setEditingMacroRunId(run.id);
    setEditingMacroPromptId(onlyPromptId);
    setRunMacroAnswers(initialAnswers);
    setRunMacroId(macro.id);
  };

  const handleSoapEditorElementClick = (target: HTMLElement) => {
    if (!selectedEncounter) {
      return;
    }
    const wrapper = target.closest("[data-macro-run-id]") as HTMLElement | null;
    if (!wrapper) {
      return;
    }
    const runId = wrapper.getAttribute("data-macro-run-id");
    if (!runId) {
      return;
    }
    const matchingRun = selectedEncounter.macroRuns.find((entry) => entry.id === runId);
    if (!matchingRun) {
      return;
    }
    // New format: tapping a single prompt span opens an inline edit for just
    // that question. Legacy wrappers (no data-prompt-id) fall back to the
    // full-macro picker.
    const promptId = wrapper.getAttribute("data-prompt-id");
    handleEditExistingMacroRun(matchingRun, promptId);
  };

  const handleConfirmMacroRun = () => {
    if (!runMacro) {
      return;
    }
    applyMacroTemplate(runMacro, runMacroAnswers, editingMacroRun);
    setRunMacroId(null);
    setEditingMacroRunId(null);
    setEditingMacroPromptId(null);
    setRunMacroAnswers({});
  };

  const handleCopyActiveSectionFromSelected = () => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to copy prior SOAP text.");
      return;
    }
    if (!saltSourceEncounter) {
      setMessage("Select a prior encounter first.");
      return;
    }
    const sourceText = saltSourceEncounter.soap[activeSection].trim();
    if (!sourceText) {
      setMessage(`No ${sectionLabels[activeSection]} text found in selected prior encounter.`);
      return;
    }
    const currentText = selectedEncounter.soap[activeSection].trim();
    if (currentText && currentText !== sourceText) {
      const confirmed = window.confirm(
        `Replace current ${sectionLabels[activeSection]} text with the selected prior encounter note?`,
      );
      if (!confirmed) {
        return;
      }
    }
    // Re-key every macro-run id reference in the source HTML (covers both
    // the new per-prompt span format and the legacy single-wrapper format),
    // then carry the underlying macro runs over so taps still re-open the
    // picker on the destination encounter.
    const { html: rewrittenText, idMap } = rewriteMacroRunIds(sourceText);
    setSoapSection(selectedEncounter.id, activeSection, rewrittenText);
    let copiedRunCount = 0;
    idMap.forEach((newId, oldId) => {
      const sourceRun = saltSourceEncounter.macroRuns.find((entry) => entry.id === oldId);
      if (!sourceRun) {
        return;
      }
      addMacroRun(selectedEncounter.id, {
        id: newId,
        section: activeSection,
        macroId: sourceRun.macroId,
        macroName: sourceRun.macroName,
        body: sourceRun.body,
        answers: { ...sourceRun.answers },
        generatedText: sourceRun.generatedText.replace(
          new RegExp(`data-macro-run-id=["']${oldId}["']`, "g"),
          `data-macro-run-id="${newId}"`,
        ),
      });
      copiedRunCount += 1;
    });
    const macroSuffix = copiedRunCount > 0 ? ` (with ${copiedRunCount} editable macro${copiedRunCount === 1 ? "" : "s"})` : "";
    setMessage(`Copied ${sectionLabels[activeSection]} from ${saltSourceEncounter.encounterDate}${macroSuffix}.`);
  };

  const handleCopyAllSoapFromSelected = () => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to copy prior SOAP text.");
      return;
    }
    if (!saltSourceEncounter) {
      setMessage("Select a prior encounter first.");
      return;
    }
    const sectionsWithText = encounterSections.filter(
      (section) => saltSourceEncounter.soap[section].trim().length > 0,
    );
    if (sectionsWithText.length === 0) {
      setMessage(`No SOAP text found on ${saltSourceEncounter.encounterDate}.`);
      return;
    }
    const hasExistingText = encounterSections.some(
      (section) => selectedEncounter.soap[section].trim().length > 0,
    );
    if (hasExistingText) {
      const confirmed = window.confirm(
        `Replace ALL current SOAP sections with the notes from ${saltSourceEncounter.encounterDate}?`,
      );
      if (!confirmed) {
        return;
      }
    }
    let totalSections = 0;
    let totalMacros = 0;
    sectionsWithText.forEach((section) => {
      const sourceText = saltSourceEncounter.soap[section].trim();
      const { html: rewrittenText, idMap } = rewriteMacroRunIds(sourceText);
      setSoapSection(selectedEncounter.id, section, rewrittenText);
      idMap.forEach((newId, oldId) => {
        const sourceRun = saltSourceEncounter.macroRuns.find((entry) => entry.id === oldId);
        if (!sourceRun) {
          return;
        }
        addMacroRun(selectedEncounter.id, {
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
        totalMacros += 1;
      });
      totalSections += 1;
    });
    const macroSuffix = totalMacros > 0 ? ` (with ${totalMacros} editable macro${totalMacros === 1 ? "" : "s"})` : "";
    setMessage(
      `Copied ${totalSections} SOAP section${totalSections === 1 ? "" : "s"} from ${saltSourceEncounter.encounterDate}${macroSuffix}.`,
    );
  };

  const handleCopyChargesFromSelected = () => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to copy prior charges.");
      return;
    }
    if (!saltSourceEncounter) {
      setMessage("Select a prior encounter first.");
      return;
    }
    if (saltSourceEncounter.charges.length === 0) {
      setMessage(`No charges found on ${saltSourceEncounter.encounterDate}.`);
      return;
    }
    if (selectedEncounter.charges.length > 0) {
      const confirmed = window.confirm(
        `Append ${saltSourceEncounter.charges.length} charge(s) from ${saltSourceEncounter.encounterDate} to this encounter? Existing charges will be kept.`,
      );
      if (!confirmed) {
        return;
      }
    }
    const copiedCount = addChargesBulk(
      selectedEncounter.id,
      saltSourceEncounter.charges.map((charge) => ({
        treatmentMacroId: charge.treatmentMacroId,
        name: charge.name,
        procedureCode: charge.procedureCode,
        unitPrice: charge.unitPrice,
        units: charge.units,
      })),
    );
    setMessage(
      `Copied ${copiedCount} charge${copiedCount === 1 ? "" : "s"} from ${saltSourceEncounter.encounterDate}.`,
    );
  };

  const handleDeleteEncounter = () => {
    if (!selectedEncounter) {
      return;
    }
    const chargeCount = selectedEncounter.charges.length;
    const chargeWarning =
      chargeCount > 0
        ? `\n\nThis will also remove ${chargeCount} charge${chargeCount === 1 ? "" : ""} attached to this encounter so billing stays in sync.`
        : "";
    const confirmed = window.confirm(
      `Delete encounter for ${selectedEncounter.patientName} on ${selectedEncounter.encounterDate}?${chargeWarning}`,
    );
    if (!confirmed) {
      return;
    }
    // Reset linked appointment back to Check In so the user can recreate.
    if (linkedAppointmentForStatus) {
      updateAppointment(linkedAppointmentForStatus.id, (current) => ({
        ...current,
        status: "Check In",
      }));
    }
    // Charges live inside EncounterNoteRecord.charges[], so deleting the
    // encounter naturally removes all attached charges in one shot.
    deleteEncounter(selectedEncounter.id);
    setMessage(
      chargeCount > 0
        ? `Encounter deleted (${chargeCount} charge${chargeCount === 1 ? "" : "s"} removed). Appointment set back to Check In.`
        : "Encounter deleted. Appointment set back to Check In.",
    );
  };

  const addChargeFromTreatment = (treatmentMacroId: string) => {
    if (!selectedEncounter) {
      return;
    }
    if (selectedEncounter.signed) {
      setMessage("Encounter is closed. Reopen it to add charges.");
      return;
    }
    const treatment = activeTreatments.find((entry) => entry.id === treatmentMacroId);
    if (!treatment) {
      setMessage("Treatment not found.");
      return;
    }
    const chargeInput = {
      treatmentMacroId: treatment.id,
      name: treatment.name,
      procedureCode: treatment.procedureCode,
      unitPrice: treatment.unitPrice,
      units: treatment.defaultUnits,
    };
    // First attempt without bumping — detect duplicate
    const result = addCharge(selectedEncounter.id, chargeInput);
    if (result === "duplicate") {
      if (window.confirm(`"${treatment.name}" is already added. Add another unit?`)) {
        addCharge(selectedEncounter.id, chargeInput, { bumpIfDuplicate: true });
        setMessage(`Added unit to "${treatment.name}".`);
      }
      return;
    }
    setMessage(result === "added" ? "Treatment added to encounter charges." : "Unable to add treatment.");
  };

  const encounterChargeTotal = useMemo(() => {
    if (!selectedEncounter) {
      return 0;
    }
    return selectedEncounter.charges.reduce((sum, entry) => sum + entry.unitPrice * entry.units, 0);
  }, [selectedEncounter]);

  const setSoapPrintSelectionForCurrentPatient = (encounterIds: string[]) => {
    if (!filteredEncounterPatientId) {
      return;
    }
    setPrintSelectionByPatient((current) => ({
      ...current,
      [filteredEncounterPatientId]: encounterIds,
    }));
  };

  const toggleSoapPrintEncounter = (encounterId: string) => {
    if (!filteredEncounterPatientId) {
      return;
    }
    const currentSelection = selectedSoapPrintEncounterIds;
    const nextSelection = currentSelection.includes(encounterId)
      ? currentSelection.filter((entry) => entry !== encounterId)
      : [...currentSelection, encounterId];
    setSoapPrintSelectionForCurrentPatient(nextSelection);
  };

  const handlePrintSelectedSoapNotes = () => {
    if (!filteredEncounterPatientId || !filteredEncounterListByOldest.length) {
      setMessage("Type a patient name and select at least one encounter first.");
      return;
    }
    if (!selectedSoapPrintEncounterIds.length) {
      setMessage("Select at least one encounter to print.");
      return;
    }
    const selectedSet = new Set(selectedSoapPrintEncounterIds);
    const patientRecord = patients.find((p) => p.id === filteredEncounterPatientId);
    const { firstName: pFirst, lastName: pLast } = getNames(patientRecord?.fullName ?? filteredEncounterPatientName);
    const dol = toUsDate(patientRecord?.dateOfLoss ?? "");
    const dolMatch = dol.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const caseNum = dolMatch
      ? `${dolMatch[1]}${dolMatch[2]}${dolMatch[3].slice(-2)}${pLast.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2)}${pFirst.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2)}`
      : "";
    const nameStr = [pLast, pFirst].filter(Boolean).join(", ");
    const soapTitle = [caseNum, nameStr].filter(Boolean).join(" ");
    const printableHtml = buildSoapPrintHtml({
      officeName: officeSettings.officeName,
      officeAddress: officeSettings.address,
      officePhone: officeSettings.phone,
      officeFax: officeSettings.fax,
      officeEmail: officeSettings.email,
      logoDataUrl: officeSettings.logoDataUrl,
      patientName: filteredEncounterPatientName,
      documentTitle: soapTitle ? `${soapTitle} - SOAP Notes` : undefined,
      encounters: filteredEncounterListByOldest
        .filter((entry) => selectedSet.has(entry.id))
        .map((entry) => ({
          id: entry.id,
          encounterDate: entry.encounterDate,
          provider: entry.provider,
          appointmentType: entry.appointmentType,
          signed: entry.signed,
          soap: entry.soap,
        })),
    });
    const opened = printHtmlWithIframeFallback(printableHtml);
    if (!opened) {
      setMessage("Could not open print view. Check popup/browser settings and try again.");
      return;
    }
    setMessage("SOAP print view opened in oldest-to-newest order. Use Save as PDF in the print dialog.");
  };

  const handleEncounterScheduleStatusChange = (nextStatus: AppointmentStatus) => {
    if (!selectedEncounter) {
      return;
    }
    if (!linkedAppointmentForStatus) {
      setMessage("No linked appointment found on this encounter date.");
      return;
    }
    if (!isAppointmentStatusSelectable(nextStatus, linkedAppointmentForStatus.status)) {
      setMessage(`Cannot mark ${nextStatus} — patient must be Checked In first.`);
      return;
    }
    if (!confirmStatusChangeIfNeeded(linkedAppointmentForStatus.status, nextStatus)) return;
    updateAppointment(linkedAppointmentForStatus.id, (current) => ({
      ...current,
      status: nextStatus,
    }));
    setMessage(`Schedule status updated to ${nextStatus}.`);
  };

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <h2 className="text-2xl font-semibold">Encounter / Daily Visit Notes</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          SOAP charting with carry-forward copy tools and treatment charges. Create new encounters from Schedule or Patient File.
        </p>
      </section>

      {message && <p className="text-sm font-semibold text-[var(--brand-primary)]">{message}</p>}

      <AppointmentsOverview
        appointments={scheduleAppointments}
        encounters={encountersByNewest}
        patients={patients}
        officeSettings={officeSettings}
        appointmentTypes={appointmentTypes}
        onCreateEncounter={(appointmentId, patientId, patientName, appointmentType, date) => {
          // Gate: only allow encounter creation when the source appointment is
          // currently Checked In (or already Checked Out, which means the
          // encounter was started earlier and we're re-opening). This keeps
          // No Show / Canceled / Reschedule appointments from accidentally
          // getting paired with a chartable visit.
          const sourceAppointment = scheduleAppointments.find((entry) => entry.id === appointmentId);
          if (sourceAppointment && sourceAppointment.status !== "Check In" && sourceAppointment.status !== "Check Out") {
            setMessage(
              `Cannot start encounter — patient must be Checked In first (current status: ${formatAppointmentStatusLabel(sourceAppointment.status)}).`,
            );
            return;
          }
          const provider = officeSettings.doctorName || "Provider";
          const newId = createEncounter({
            patientId,
            patientName,
            provider,
            appointmentType,
            encounterDate: date,
          });
          if (newId) {
            setEncounterSearch(patientName);
            setSelectedEncounterId(newId);
            setMessage(`Encounter created for ${date}.`);
          }
        }}
        onOpenEncounter={(encounterId, patientName) => {
          setEncounterSearch(patientName);
          setSelectedEncounterId(encounterId);
        }}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(360px,420px)_1fr]">
        <aside className="space-y-4">
          <article className="panel-card p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid flex-1 gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Patient</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setEncounterSearch(event.target.value)}
                  placeholder="Type patient name..."
                  value={encounterSearch}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Status</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setStatusFilter(event.target.value as "all" | "open" | "closed")}
                  value={statusFilter}
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  </select>
              </label>
            </div>

            {!normalizeLookupText(encounterSearch) ? (
              <p className="mt-3 text-sm text-[var(--text-muted)]">Type a patient name to load encounters.</p>
            ) : filteredEncounterList.length === 0 && allPatientAppointments.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--text-muted)]">No encounters or appointments found.</p>
            ) : (
              <>
                {/* ── Unified Appointments + Encounters ── */}
                {filteredEncounterPatientId && allPatientAppointments.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        Appointments
                      </h4>
                      <div className="flex items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold select-none text-[var(--text-muted)]">
                          <input
                            type="checkbox"
                            className="accent-[var(--brand-primary)]"
                            checked={hideCompleted}
                            onChange={(e) => setHideCompleted(e.target.checked)}
                          />
                          Hide completed
                        </label>
                        <button
                          className="rounded border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-[10px] font-semibold hover:bg-[var(--bg-soft)]"
                          onClick={() => setAptDateSort((prev) => (prev === "newest" ? "oldest" : "newest"))}
                          title={`Sort by date: ${aptDateSort === "newest" ? "Newest first" : "Oldest first"}`}
                          type="button"
                        >
                          {aptDateSort === "newest" ? "↓" : "↑"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 overflow-x-auto rounded-xl border border-[var(--line-soft)]">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-[var(--bg-soft)] text-left">
                            <th className="w-6 px-1 py-1"></th>
                            <th className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Date</th>
                            <th className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Type</th>
                            <th className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</th>
                            <th className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Enc.</th>
                            <th className="w-6 px-1 py-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {patientAppointments.map((apt) => {
                            const dateUs = (() => {
                              const [y, m, d] = apt.date.split("-");
                              return `${m}/${d}/${y}`;
                            })();
                            // Match encounter by patient + date + type first; fall back
                            // to date-only if this is the only appointment on that day.
                            const linkedByType = encountersByNewest.find(
                              (e) =>
                                e.patientId === apt.patientId &&
                                e.encounterDate === dateUs &&
                                e.appointmentType.toLowerCase() === apt.appointmentType.toLowerCase(),
                            );
                            const linkedByDate = encountersByNewest.find(
                              (e) => e.patientId === apt.patientId && e.encounterDate === dateUs,
                            );
                            const sameDayAptCount = patientAppointments.filter((a) => a.date === apt.date).length;
                            const linked = linkedByType ?? (sameDayAptCount === 1 ? linkedByDate : null);
                            const canStart = apt.status !== "Canceled";
                            const isLinkedToSelected = linkedAppointmentForStatus?.id === apt.id;
                            const printChecked = linked ? selectedSoapPrintEncounterIds.includes(linked.id) : false;
                            // Smart word-wrap: break long type names at the midpoint
                            const typeWords = apt.appointmentType.split(" ");
                            const typeLine1 = typeWords.length >= 4
                              ? typeWords.slice(0, Math.ceil(typeWords.length / 2)).join(" ")
                              : apt.appointmentType;
                            const typeLine2 = typeWords.length >= 4
                              ? typeWords.slice(Math.ceil(typeWords.length / 2)).join(" ")
                              : null;
                            return (
                              <tr
                                key={apt.id}
                                className={`border-t border-[var(--line-soft)] ${
                                  isLinkedToSelected
                                    ? "bg-[rgba(13,121,191,0.08)]"
                                    : ""
                                }`}
                              >
                                <td className="px-1 py-1.5 text-center">
                                  {linked && (
                                    <input
                                      checked={printChecked}
                                      className="accent-[var(--brand-primary)]"
                                      onChange={() => toggleSoapPrintEncounter(linked.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      type="checkbox"
                                    />
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-xs tabular-nums">{dateUs}</td>
                                <td className="px-2 py-1.5 text-xs leading-tight">
                                  {typeLine2 ? (
                                    <>{typeLine1}<br />{typeLine2}</>
                                  ) : typeLine1}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${getStatusBadgeClass(apt.status)}`}>
                                    {formatAppointmentStatusLabel(apt.status)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5">
                                  {linked ? (
                                    <button
                                      className={`rounded-lg border px-2 py-0.5 text-xs font-semibold transition-all active:scale-[0.97] ${
                                        resolvedEncounterId === linked.id
                                          ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.08)] text-[var(--brand-primary)]"
                                          : "border-[var(--line-soft)] bg-white"
                                      }`}
                                      onClick={() => setSelectedEncounterId(linked.id)}
                                      type="button"
                                    >
                                      {linked.signed ? "View" : "Open"}
                                    </button>
                                  ) : canStart ? (
                                    <button
                                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 transition-all active:scale-[0.97] active:brightness-95"
                                      onClick={() => {
                                        const provider = officeSettings.doctorName || "Provider";
                                        const newId = createEncounter({
                                          patientId: apt.patientId,
                                          patientName: apt.patientName,
                                          provider,
                                          appointmentType: apt.appointmentType,
                                          encounterDate: dateUs,
                                        });
                                        if (newId) {
                                          setSelectedEncounterId(newId);
                                          setMessage(`Encounter created for ${dateUs}.`);
                                        }
                                      }}
                                      title="Start encounter"
                                      type="button"
                                    >
                                      <span className="whitespace-nowrap">+ Enc.</span>
                                    </button>
                                  ) : (
                                    <span className="text-xs text-[var(--text-muted)]">-</span>
                                  )}
                                </td>
                                <td className="px-1 py-1.5 text-center">
                                  {linked && (
                                    <button
                                      className="rounded p-0.5 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600 active:scale-90"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (window.confirm(`Delete encounter for ${dateUs} (${apt.appointmentType})? This cannot be undone.`)) {
                                          deleteEncounter(linked.id);
                                          if (resolvedEncounterId === linked.id) {
                                            setSelectedEncounterId("");
                                          }
                                          setMessage(`Encounter for ${dateUs} deleted.`);
                                        }
                                      }}
                                      title="Delete encounter"
                                      type="button"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Print controls */}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex gap-1.5">
                        <button
                          className="rounded border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-[10px] font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                          disabled={!filteredEncounterListByOldest.length}
                          onClick={() =>
                            setSoapPrintSelectionForCurrentPatient(
                              filteredEncounterListByOldest.map((entry) => entry.id),
                            )
                          }
                          type="button"
                        >
                          Select All
                        </button>
                        <button
                          className="rounded border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-[10px] font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                          disabled={!filteredEncounterListByOldest.length}
                          onClick={() => setSoapPrintSelectionForCurrentPatient([])}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner disabled:opacity-50"
                        disabled={!selectedSoapPrintEncounterIds.length}
                        onClick={handlePrintSelectedSoapNotes}
                        type="button"
                      >
                        Print Encounters
                        {selectedSoapPrintEncounterIds.length > 0 && (
                          <span className="ml-1 text-[10px] font-medium text-[var(--text-muted)]">({selectedSoapPrintEncounterIds.length})</span>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Encounter Warnings */}
                {filteredEncounterList.length > 0 && (() => {
                  const warnings: Array<{ encId: string; date: string; issues: string[] }> = [];
                  for (const enc of filteredEncounterList) {
                    const issues: string[] = [];
                    if (!enc.soap.subjective.trim()) issues.push("S");
                    if (!enc.soap.objective.trim()) issues.push("O");
                    if (!enc.soap.assessment.trim()) issues.push("A");
                    if (!enc.soap.plan.trim()) issues.push("P");
                    if (enc.charges.length === 0) issues.push("No Charges");
                    if (issues.length > 0 && !enc.signed) {
                      warnings.push({ encId: enc.id, date: enc.encounterDate, issues });
                    }
                  }
                  if (warnings.length === 0) return null;
                  return (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Encounter Warnings</p>
                      <ul className="mt-1 space-y-0.5">
                        {warnings.map((w) => (
                          <li key={w.encId} className="flex items-center gap-2 text-xs text-amber-800">
                            <button
                              type="button"
                              className="font-semibold underline hover:text-amber-900"
                              onClick={() => setSelectedEncounterId(w.encId)}
                            >
                              {w.date}
                            </button>
                            <span className="text-amber-600">
                              Missing: {w.issues.join(", ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {allPatientAppointments.length === 0 && filteredEncounterList.length === 0 && normalizeLookupText(encounterSearch) && (
                  <p className="mt-3 text-sm text-[var(--text-muted)]">No appointments or encounters found.</p>
                )}
              </>
            )}
          </article>
        </aside>

        <article className="panel-card p-4">
          {!selectedEncounter ? (
            <p className="text-sm text-[var(--text-muted)]">
              Select an encounter to start charting. New encounters can be created from Schedule or from a Patient File.
            </p>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                {/* Header row: patient name + action buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold leading-tight">{selectedEncounter.patientName}</h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span>{selectedEncounter.encounterDate}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${selectedEncounter.signed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {selectedEncounter.signed ? "Closed" : "Open"}
                      </span>
                      <span>Charges: {selectedEncounter.charges.length} (${encounterChargeTotal.toFixed(2)})</span>
                      {selectedPatient && (
                        <Link className="underline" href={`/patients/${selectedPatient.id}`}>
                          Patient File
                        </Link>
                      )}
                    </div>
                    {selectedPatient?.alerts && selectedPatient.alerts.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selectedPatient.alerts.map((alert, i) => (
                          <span
                            key={`enc-alert-${i}`}
                            className="inline-flex items-center rounded-md border border-[#e8b931] bg-[#fef9e7] px-1.5 py-0.5 text-[10px] font-bold text-[#92400e]"
                          >
                            ⚠ {alert}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition-all active:scale-[0.97]"
                      onClick={async () => {
                        setMessage("Saving encounters...");
                        const result = await forceSaveAll(selectedEncounter.patientId);
                        if (result.ok) {
                          setMessage(`Encounters saved (${result.count}).${result.error ? ` Note: ${result.error}` : ""}`);
                        } else {
                          setMessage(`Save failed: ${result.error || "Unknown error"}`);
                        }
                      }}
                      type="button"
                    >
                      Save Encounters
                    </button>
                    {selectedEncounter.signed ? (
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-[11px] font-semibold transition-all active:scale-[0.97]"
                        onClick={() => {
                          setSigned(selectedEncounter.id, false);
                          if (linkedAppointmentForStatus) {
                            updateAppointment(linkedAppointmentForStatus.id, (current) => ({
                              ...current,
                              status: "Check In",
                            }));
                            setMessage(`Encounter reopened and ${selectedEncounter.patientName} checked back in.`);
                          } else {
                            setMessage("Encounter reopened.");
                          }
                        }}
                        type="button"
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-all active:scale-[0.97]"
                        onClick={() => {
                          if (selectedEncounter.charges.length === 0) {
                            if (!window.confirm("This encounter has no charges. Close and check out anyway?")) return;
                          }
                          setSigned(selectedEncounter.id, true);
                          if (linkedAppointmentForStatus) {
                            updateAppointment(linkedAppointmentForStatus.id, (current) => ({
                              ...current,
                              status: "Check Out",
                            }));
                            setMessage(`Encounter closed and ${selectedEncounter.patientName} checked out.`);
                          } else {
                            setMessage("Encounter closed. No linked appointment found to check out.");
                          }
                        }}
                        title={
                          linkedAppointmentForStatus
                            ? "Close encounter and mark linked appointment as Check Out"
                            : "Close encounter (no linked appointment found for check out)"
                        }
                        type="button"
                      >
                        Close + Check Out
                      </button>
                    )}
                    <button
                      className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 transition-all active:scale-[0.97]"
                      onClick={handleDeleteEncounter}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Compact info boxes grid */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <label className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Provider</span>
                    <input
                      className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm focus:outline-none"
                      disabled={selectedEncounter.signed}
                      onChange={(event) =>
                        updateEncounter(selectedEncounter.id, { provider: event.target.value })
                      }
                      value={selectedEncounter.provider}
                    />
                  </label>
                  <label className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Type</span>
                    <select
                      className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm focus:outline-none"
                      disabled={selectedEncounter.signed}
                      onChange={(event) =>
                        updateEncounter(selectedEncounter.id, { appointmentType: event.target.value })
                      }
                      value={selectedEncounter.appointmentType}
                    >
                      {appointmentTypeOptions.map((option) => (
                        <option key={`encounter-appointment-type-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Date</span>
                    <input
                      className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm focus:outline-none"
                      disabled={selectedEncounter.signed}
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(event) =>
                        updateEncounter(selectedEncounter.id, {
                          encounterDate: normalizeEncounterDateInput(event.target.value),
                        })
                      }
                      value={selectedEncounter.encounterDate}
                    />
                  </label>
                  <label className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Status
                      {linkedAppointmentForStatus && (
                        <span className="ml-1 font-normal normal-case text-[var(--text-muted)]">
                          ({formatTimeLabel(linkedAppointmentForStatus.startTime)})
                        </span>
                      )}
                    </span>
                    <select
                      className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm focus:outline-none"
                      disabled={!linkedAppointmentForStatus}
                      onChange={(event) =>
                        handleEncounterScheduleStatusChange(event.target.value as AppointmentStatus)
                      }
                      value={scheduleStatusValue}
                    >
                      {appointmentStatusOptions.map((option) => {
                        const disabled = !isAppointmentStatusSelectable(
                          option,
                          (linkedAppointmentForStatus?.status ?? scheduleStatusValue) as AppointmentStatus,
                        );
                        return (
                          <option
                            key={`encounter-schedule-status-${option}`}
                            disabled={disabled}
                            value={option}
                          >
                            {formatAppointmentStatusLabel(option)}
                            {disabled ? " (requires Checked In first)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>

                {/* Compare / Copy — compact row */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Copy From</span>
                  <select
                    className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-xs"
                    disabled={selectedEncounter.signed || priorPatientEncounters.length === 0}
                    onChange={(event) => setSaltSourceEncounterIdDraft(event.target.value)}
                    value={resolvedSaltSourceEncounterId}
                  >
                    {priorPatientEncounters.length === 0 ? (
                      <option value="">No prior encounters</option>
                    ) : (
                      <>
                        <option value="">Select prior encounter</option>
                        {priorPatientEncounters.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.encounterDate}
                            {entry.appointmentType ? ` • ${entry.appointmentType}` : ""}
                            {entry.signed ? " • Closed" : ""}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-[11px] font-semibold transition-all active:scale-[0.97] disabled:opacity-40"
                    disabled={selectedEncounter.signed || !saltSourceEncounter}
                    onClick={handleCopyActiveSectionFromSelected}
                    type="button"
                  >
                    Copy {sectionLabels[activeSection]}
                  </button>
                  <button
                    className="rounded-lg border border-[var(--brand-primary)] bg-[rgba(13,121,191,0.08)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-primary)] transition-all active:scale-[0.97] disabled:opacity-40 disabled:border-[var(--line-soft)] disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
                    disabled={selectedEncounter.signed || !saltSourceEncounter}
                    onClick={handleCopyAllSoapFromSelected}
                    title={
                      saltSourceEncounter
                        ? `Copy all SOAP sections from ${saltSourceEncounter.encounterDate}`
                        : "Select a prior encounter to copy SOAP from"
                    }
                    type="button"
                  >
                    Copy SOAP
                  </button>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-semibold select-none">
                    <input
                      checked={autoSalt}
                      className="accent-[var(--brand-primary)]"
                      onChange={(e) => {
                        setAutoSalt(e.target.checked);
                        if (e.target.checked) {
                          autoSaltedRef.current = null;
                        }
                      }}
                      type="checkbox"
                    />
                    Auto-Salt
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-[var(--line-soft)] bg-white p-3">

                <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                  <p className="text-sm font-semibold">SOAP Macros: {sectionLabels[activeSection]}</p>
                  <div className="mt-2 space-y-2">
                    {sectionMacroFolderGroups.map((group) => {
                      const isUngrouped = group.folder === "";
                      const isCollapsed = !isUngrouped && macroFoldersCollapsed.has(group.folder);

                      return (
                        <div key={group.folder || "__ungrouped__"}>
                          {!isUngrouped && (
                            <button
                              className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] hover:bg-white/60"
                              onClick={() => toggleMacroFolder(group.folder)}
                              type="button"
                            >
                              <svg
                                className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                viewBox="0 0 24 24"
                              >
                                <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {group.folder}
                            </button>
                          )}
                          {!isCollapsed && (
                            <div className="flex flex-wrap gap-2">
                              {group.macros.map((macro) => (
                                <button
                                  key={macro.id}
                                  className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                                  onClick={() => handleRunMacroClick(macro)}
                                  type="button"
                                >
                                  {macro.buttonName}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {sectionMacros.length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">
                        No active macros in this section yet. Configure them in Settings &gt; SOAP Macro Settings.
                      </p>
                    )}
                  </div>
                </div>

                <details className="mt-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)]">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
                    Inserted Macro Inputs{sectionMacroRuns.length > 0 && (
                      <span className="ml-1.5 text-xs font-medium text-[var(--text-muted)]">({sectionMacroRuns.length})</span>
                    )}
                  </summary>
                  <div className="px-3 pb-3">
                    {sectionMacroRuns.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectionMacroRuns.map((run) => {
                          const answerPreview = Object.values(run.answers)
                            .flatMap((value) => (Array.isArray(value) ? value : [value]))
                            .map((value) => value.trim())
                            .filter((value) => value.length > 0)
                            .slice(0, 2)
                            .join(" • ");
                          return (
                            <span key={run.id} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line-soft)] bg-white pr-1">
                              <button
                                className="px-3 py-1.5 text-left text-sm font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                                disabled={selectedEncounter.signed}
                                onClick={() => handleEditExistingMacroRun(run)}
                                type="button"
                              >
                                <span>{run.macroName}</span>
                                {answerPreview && (
                                  <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">{answerPreview}</span>
                                )}
                              </button>
                              {!selectedEncounter.signed && (
                                <button
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-red-50 hover:text-[#b43b34] transition-colors"
                                  onClick={() => {
                                    if (window.confirm(`Remove "${run.macroName}" input?`)) {
                                      removeMacroRun(selectedEncounter.id, run.id);
                                    }
                                  }}
                                  title={`Remove ${run.macroName}`}
                                  type="button"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--text-muted)]">
                        No macro inserts yet in this section.
                      </p>
                    )}
                  </div>
                </details>

                <div className="mt-3 flex flex-wrap gap-2">
                  {encounterSections.map((section) => (
                    <button
                      key={section}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] ${
                        activeSection === section
                          ? "bg-[var(--brand-primary)] text-white active:brightness-90"
                          : "bg-[var(--bg-soft)] text-[var(--text-main)] active:shadow-inner"
                      }`}
                      onClick={() => setActiveSection(section)}
                      type="button"
                    >
                      {sectionLabels[section]}
                    </button>
                  ))}
                </div>

                {saltSourceEncounter ? (
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-1">
                      <span className="text-sm font-semibold text-[var(--text-muted)]">
                        {sectionLabels[activeSection]} Note
                      </span>
                      <RichTextTemplateEditor
                        ref={soapEditorRef}
                        value={selectedEncounter.soap[activeSection]}
                        onChange={(nextValue) =>
                          setSoapSection(selectedEncounter.id, activeSection, nextValue)
                        }
                        minHeightClassName="min-h-64"
                        placeholder="Type directly here, use macros, or mix both."
                        onElementClick={handleSoapEditorElementClick}
                      />
                    </div>
                    <div className="grid gap-1">
                      <span className="text-sm font-semibold text-[var(--text-muted)]">
                        Previous {sectionLabels[activeSection]} ({saltSourceEncounter.encounterDate})
                      </span>
                      {saltSourceEncounter.soap[activeSection].trim() ? (
                        <div
                          className="rich-text-editor min-h-64 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                          // Prior encounter notes are stored as HTML so they can
                          // contain bold/underline/macro pills. Render the markup
                          // instead of showing the raw tags.
                          dangerouslySetInnerHTML={{
                            __html: saltSourceEncounter.soap[activeSection],
                          }}
                        />
                      ) : (
                        <div className="min-h-64 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
                          No text in this section for selected prior encounter.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">
                      {sectionLabels[activeSection]} Note
                    </span>
                    <RichTextTemplateEditor
                      ref={soapEditorRef}
                      value={selectedEncounter.soap[activeSection]}
                      onChange={(nextValue) =>
                        setSoapSection(selectedEncounter.id, activeSection, nextValue)
                      }
                      minHeightClassName="min-h-64"
                      placeholder="Type directly here, use macros, or mix both."
                      onElementClick={handleSoapEditorElementClick}
                    />
                  </div>
                )}
              </section>

              <section>
                <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-lg font-semibold">Encounter Charges</h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
                        disabled={!saltSourceEncounter}
                        onClick={() => setShowPriorChargesPreview((prev) => !prev)}
                        title={
                          saltSourceEncounter
                            ? `View charges from ${saltSourceEncounter.encounterDate}`
                            : "Select a prior encounter to view its charges"
                        }
                        type="button"
                      >
                        {showPriorChargesPreview ? "Hide Prior Charges" : "View Prior Charges"}
                      </button>
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]"
                        disabled={!saltSourceEncounter || selectedEncounter.signed}
                        onClick={handleCopyChargesFromSelected}
                        title={
                          saltSourceEncounter
                            ? `Copy charges from ${saltSourceEncounter.encounterDate}`
                            : "Select a prior encounter to copy charges from"
                        }
                        type="button"
                      >
                        Copy Charges From Prior
                      </button>
                    </div>
                  </div>
                  {showPriorChargesPreview && saltSourceEncounter && (
                    <div className="mt-2 rounded-xl border border-[var(--line-soft)] bg-[#f6f9fc] p-3 text-sm">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Prior charges from {saltSourceEncounter.encounterDate}
                      </p>
                      {saltSourceEncounter.charges.length === 0 ? (
                        <p className="text-[var(--text-muted)]">
                          No charges recorded on this prior encounter.
                        </p>
                      ) : (
                        <>
                          <ul className="grid gap-1">
                            {saltSourceEncounter.charges.map((charge) => (
                              <li
                                key={`prior-charge-${charge.id}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5"
                              >
                                <span className="font-semibold">
                                  {charge.name}
                                  {charge.procedureCode ? (
                                    <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">
                                      {charge.procedureCode}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="tabular-nums text-[var(--text-muted)]">
                                  ${charge.unitPrice.toFixed(2)} × {charge.units} ={" "}
                                  <span className="font-semibold text-[var(--text-main)]">
                                    ${(charge.unitPrice * charge.units).toFixed(2)}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-right text-xs font-semibold">
                            Prior total: $
                            {saltSourceEncounter.charges
                              .reduce((sum, c) => sum + c.unitPrice * c.units, 0)
                              .toFixed(2)}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                        onClick={() => setOpenChargesPanel((previous) => !previous)}
                        type="button"
                      >
                        {openChargesPanel ? "Hide Open Charges" : "Open Charges"}
                      </button>
                      {openChargesPanel && (
                        <input
                          className="min-w-52 flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                          onChange={(event) => setChargeSearch(event.target.value)}
                          placeholder="Search charge by name or CPT..."
                          value={chargeSearch}
                        />
                      )}
                    </div>

                    {openChargesPanel && (
                      <div className="mt-2 max-h-60 overflow-auto rounded-xl border border-[var(--line-soft)] bg-white p-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          {filteredActiveTreatments.map((entry) => (
                            <button
                              key={entry.id}
                              className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-left transition hover:border-[var(--brand-primary)] hover:bg-[rgba(13,121,191,0.08)]"
                              disabled={selectedEncounter.signed}
                              onClick={() => { addChargeFromTreatment(entry.id); setChargeSearch(""); }}
                              type="button"
                            >
                              <p className="text-sm font-semibold">{entry.name}</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {entry.procedureCode} • ${entry.unitPrice} x {entry.defaultUnits}
                              </p>
                            </button>
                          ))}
                        </div>
                        {filteredActiveTreatments.length === 0 && (
                          <p className="text-sm text-[var(--text-muted)]">No active charges match your search.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 max-h-56 space-y-1 overflow-auto rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
                    {selectedEncounter.charges.length === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">No charges added for this encounter.</p>
                    )}
                    {selectedEncounter.charges.length > 0 && (
                      <div className="mb-1 grid grid-cols-[28px_1fr_100px_80px_60px_70px_56px] items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        <span />
                        <span>Treatment</span>
                        <span>CPT</span>
                        <span>Price</span>
                        <span>Qty</span>
                        <span>Total</span>
                        <span />
                      </div>
                    )}
                    {selectedEncounter.charges.map((entry, idx) => (
                      <div key={entry.id} className="grid grid-cols-[28px_1fr_100px_80px_60px_70px_56px] items-center gap-1 rounded-lg border border-[var(--line-soft)] bg-white px-1 py-0.5">
                        {/* Move arrows */}
                        <div className="flex flex-col items-center">
                          <button
                            className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--brand-primary)] disabled:opacity-30"
                            disabled={selectedEncounter.signed || idx === 0}
                            onClick={() => moveCharge(selectedEncounter.id, entry.id, "up")}
                            title="Move up"
                            type="button"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m5 15 7-7 7 7" /></svg>
                          </button>
                          <button
                            className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--brand-primary)] disabled:opacity-30"
                            disabled={selectedEncounter.signed || idx === selectedEncounter.charges.length - 1}
                            onClick={() => moveCharge(selectedEncounter.id, entry.id, "down")}
                            title="Move down"
                            type="button"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg>
                          </button>
                        </div>
                        {/* Treatment */}
                        <input
                          className="w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line-soft)] focus:border-[var(--brand-primary)] focus:outline-none"
                          disabled={selectedEncounter.signed}
                          onChange={(event) => updateCharge(selectedEncounter.id, entry.id, { name: event.target.value })}
                          value={entry.name}
                        />
                        {/* CPT */}
                        <input
                          className="w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line-soft)] focus:border-[var(--brand-primary)] focus:outline-none"
                          disabled={selectedEncounter.signed}
                          onChange={(event) => updateCharge(selectedEncounter.id, entry.id, { procedureCode: event.target.value })}
                          value={entry.procedureCode}
                        />
                        {/* Price */}
                        <input
                          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line-soft)] focus:border-[var(--brand-primary)] focus:outline-none"
                          disabled={selectedEncounter.signed}
                          min={0}
                          onChange={(event) => updateCharge(selectedEncounter.id, entry.id, { unitPrice: Number(event.target.value) })}
                          step="0.01"
                          type="number"
                          value={entry.unitPrice}
                        />
                        {/* Qty */}
                        <input
                          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line-soft)] focus:border-[var(--brand-primary)] focus:outline-none"
                          disabled={selectedEncounter.signed}
                          min={1}
                          onChange={(event) => updateCharge(selectedEncounter.id, entry.id, { units: Number(event.target.value) })}
                          step={1}
                          type="number"
                          value={entry.units}
                        />
                        {/* Total */}
                        <p className="px-1 text-xs font-semibold">${(entry.unitPrice * entry.units).toFixed(2)}</p>
                        {/* Remove */}
                        <button
                          className="rounded-lg p-1 text-[#b43b34] hover:bg-red-50 transition-colors disabled:opacity-30"
                          disabled={selectedEncounter.signed}
                          onClick={() => { if (window.confirm(`Remove charge "${entry.name}"?`)) removeCharge(selectedEncounter.id, entry.id); }}
                          title="Remove charge"
                          type="button"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">Encounter Total: ${encounterChargeTotal.toFixed(2)}</p>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1.5 text-xs font-semibold select-none hover:bg-[var(--bg-soft)]">
                      <input
                        checked={autoSaltCharges}
                        className="accent-[var(--brand-primary)]"
                        onChange={(e) => {
                          setAutoSaltCharges(e.target.checked);
                          if (e.target.checked) {
                            autoSaltedChargesRef.current = null;
                          }
                        }}
                        type="checkbox"
                      />
                      Salt Encounter Charges
                    </label>
                  </div>
                </article>
              </section>
            </div>
          )}
        </article>
      </section>

      {runMacro && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
          <div className="panel-card max-h-[85vh] w-full max-w-3xl overflow-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xl font-semibold">
                {editingMacroPromptId
                  ? `Edit Answer: ${runMacro.questions.find((q) => q.id === editingMacroPromptId)?.label ?? runMacro.buttonName}`
                  : editingMacroRun
                    ? `Edit Macro Answers: ${runMacro.buttonName}`
                    : `Run Macro: ${runMacro.buttonName}`}
              </h4>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1"
                onClick={() => {
                  setRunMacroId(null);
                  setEditingMacroRunId(null);
                  setEditingMacroPromptId(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              {/* Specialist Picker — shown when template uses {{SPECIALIST_REFERRED}}.
                  Hidden when editing a single non-specialist prompt. */}
              {runMacroAnswers.__specialist_referred__ !== undefined &&
                (!editingMacroPromptId || editingMacroPromptId === "__specialist_referred__") && (
                <div className="rounded-xl border-2 border-[#0d79bf] bg-[#e9f4fb] p-3">
                  <p className="text-sm font-semibold">
                    Referring Specialist
                    <span className="ml-2 rounded-full bg-[#0d79bf] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      From Contacts
                    </span>
                  </p>
                  {specialistContactNames.length > 0 ? (
                    <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: specialistContactNames.length > 5 ? `repeat(${Math.ceil(specialistContactNames.length / 5)}, 1fr)` : "1fr" }}>
                      {specialistContactNames.map((name) => (
                        <label
                          key={`spec-pick-${name}`}
                          className="inline-flex w-full items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        >
                          <input
                            checked={runMacroAnswers.__specialist_referred__ === name}
                            onChange={() =>
                              setRunMacroAnswers((current) => ({
                                ...current,
                                __specialist_referred__: name,
                              }))
                            }
                            type="radio"
                          />
                          {name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      No specialist contacts found. Add specialists in{" "}
                      <span className="font-semibold">Contacts</span> (categories: Pain Management, Orthopedic, Neurologist, etc.).
                    </p>
                  )}
                  {/* Free text fallback */}
                  <div className="mt-2">
                    <label className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
                      <input
                        checked={typeof runMacroAnswers.__specialist_referred__ === "string" && runMacroAnswers.__specialist_referred__ !== "" && !specialistContactNames.includes(runMacroAnswers.__specialist_referred__ as string)}
                        onChange={() =>
                          setRunMacroAnswers((current) => ({
                            ...current,
                            __specialist_referred__: "",
                          }))
                        }
                        type="radio"
                      />
                      <input
                        className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                        onChange={(event) =>
                          setRunMacroAnswers((current) => ({
                            ...current,
                            __specialist_referred__: event.target.value,
                          }))
                        }
                        onClick={() => {
                          const val = runMacroAnswers.__specialist_referred__;
                          if (typeof val === "string" && specialistContactNames.includes(val)) {
                            setRunMacroAnswers((current) => ({
                              ...current,
                              __specialist_referred__: "",
                            }));
                          }
                        }}
                        placeholder="Other (type specialist name)"
                        value={
                          typeof runMacroAnswers.__specialist_referred__ === "string" && !specialistContactNames.includes(runMacroAnswers.__specialist_referred__)
                            ? runMacroAnswers.__specialist_referred__
                            : ""
                        }
                      />
                    </label>
                  </div>
                </div>
              )}

              {(editingMacroPromptId
                ? runMacro.questions.filter((question) => question.id === editingMacroPromptId)
                : runMacro.questions
              ).map((question) => (
                (() => {
                  const normalizedOptions = question.options
                    .map((option) => option.trim())
                    .filter((option): option is string => Boolean(option));
                  const answerValue = runMacroAnswers[question.id];
                  const selectedAnswers = Array.isArray(answerValue)
                    ? answerValue.map((option) => option.trim()).filter((option) => option.length > 0)
                    : typeof answerValue === "string" && answerValue.trim()
                      ? [answerValue.trim()]
                      : [];
                  const selectedAnswer = selectedAnswers[0] ?? "";
                  const freeTextValue = Array.isArray(answerValue) ? answerValue.join(", ") : answerValue ?? "";
                  const numericOptions = Array.from(
                    new Set(
                      normalizedOptions
                        .filter((option) => /^\d+$/.test(option))
                        .map((option) => Number(option)),
                    ),
                  ).sort((left, right) => left - right);
                  const nonNumericOptions = normalizedOptions.filter((option) => !/^\d+$/.test(option));
                  const usePainScaleColumns = numericOptions.length >= 5;
                  const midPoint = usePainScaleColumns ? Math.ceil(numericOptions.length / 2) : 0;
                  const leftPainScaleOptions = usePainScaleColumns
                    ? numericOptions.slice(0, midPoint).map(String)
                    : [];
                  const rightPainScaleOptions = usePainScaleColumns
                    ? numericOptions.slice(midPoint).map(String)
                    : [];
                  const selectableOptions = normalizedOptions.length > 0 ? normalizedOptions : question.options;
                  const useMultiColumn = !usePainScaleColumns && selectableOptions.length >= 5;
                  const columnCount = useMultiColumn ? Math.ceil(selectableOptions.length / 5) : 1;
                  const columns: string[][] = [];
                  if (useMultiColumn) {
                    const perCol = Math.ceil(selectableOptions.length / columnCount);
                    for (let c = 0; c < columnCount; c++) {
                      columns.push(selectableOptions.slice(c * perCol, (c + 1) * perCol));
                    }
                  }
                  const renderOptionRow = (option: string) => (
                    <label
                      key={`${question.id}-${option}`}
                      className="inline-flex w-full items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm"
                    >
                      {question.multiSelect ? (
                        <input
                          checked={selectedAnswers.includes(option)}
                          onChange={() =>
                            setRunMacroAnswers((current) => {
                              const rawCurrentValues = current[question.id];
                              const currentValues = Array.isArray(rawCurrentValues) ? rawCurrentValues : [];
                              const toggled = currentValues.includes(option)
                                ? currentValues.filter((entry) => entry !== option)
                                : [...currentValues, option];
                              // Sort by the original option order, not click order
                              const optionOrder = question.options;
                              const nextValues = toggled.slice().sort((a, b) => {
                                const ai = optionOrder.indexOf(a);
                                const bi = optionOrder.indexOf(b);
                                // Items not in the predefined list go to the end
                                return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
                              });
                              return {
                                ...current,
                                [question.id]: nextValues,
                              };
                            })
                          }
                          type="checkbox"
                        />
                      ) : (
                        <input
                          checked={selectedAnswer === option}
                          onChange={() =>
                            setRunMacroAnswers((current) => ({
                              ...current,
                              [question.id]: option,
                            }))
                          }
                          type="radio"
                        />
                      )}
                      {option}
                    </label>
                  );

                  // The free-text field below the options always shows the current
                  // answer (or the joined multi-select answers) so the user can edit
                  // it like a "live preview". Picking a radio overwrites the field
                  // with that option text; the user can then click into the field
                  // and append a detail (e.g. "Yes" -> "Yes - Glendale Adventist").
                  const freeTextEditableValue = Array.isArray(answerValue)
                    ? answerValue.join(", ")
                    : (answerValue ?? "");

                  return (
                    <div key={question.id} className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                      <p className="text-sm font-semibold">{question.label}</p>
                      {question.options.length > 0 ? (
                        <>
                          {usePainScaleColumns ? (
                            <div className="mt-2 space-y-2">
                              <div className="grid gap-2 md:grid-cols-2">
                                <div className="grid gap-2">{leftPainScaleOptions.map(renderOptionRow)}</div>
                                <div className="grid gap-2">{rightPainScaleOptions.map(renderOptionRow)}</div>
                              </div>
                              {nonNumericOptions.length > 0 && (
                                <div className="grid gap-2">{nonNumericOptions.map(renderOptionRow)}</div>
                              )}
                            </div>
                          ) : useMultiColumn ? (
                            <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)` }}>
                              {columns.map((col, ci) => (
                                <div key={ci} className="grid gap-2 content-start">{col.map(renderOptionRow)}</div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2 grid gap-2">{selectableOptions.map(renderOptionRow)}</div>
                          )}
                          {/* Live-preview / edit field — always shows the current
                              answer and is always editable. Picking a radio above
                              updates this field; typing here overwrites the answer.
                              Lets the user pick "Yes" then type " - Glendale Adventist"
                              to end up with "Yes - Glendale Adventist" without losing
                              the macro structure. */}
                          <div className="mt-2">
                            <label className="flex items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm">
                              <span className="pt-1 text-xs font-semibold text-[var(--text-muted)]">
                                Other / edit:
                              </span>
                              <textarea
                                className="flex-1 resize-y rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                                onChange={(event) =>
                                  setRunMacroAnswers((current) => ({
                                    ...current,
                                    [question.id]: event.target.value,
                                  }))
                                }
                                placeholder="Pick an option above to start, or type your own"
                                rows={1}
                                value={freeTextEditableValue}
                              />
                            </label>
                          </div>
                        </>
                      ) : (
                        <input
                          className="mt-2 w-full rounded-xl border border-[var(--line-soft)] px-3 py-2"
                          onChange={(event) =>
                            setRunMacroAnswers((current) => ({
                              ...current,
                              [question.id]: event.target.value,
                            }))
                          }
                          value={freeTextValue}
                        />
                      )}
                    </div>
                  );
                })()
              ))}
              {runMacro.questions.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No question prompts for this macro.</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={() => {
                  setRunMacroId(null);
                  setEditingMacroRunId(null);
                  setEditingMacroPromptId(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={handleConfirmMacroRun}
                type="button"
              >
                {editingMacroRun ? "Update Existing Macro Text" : "Insert Into SOAP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

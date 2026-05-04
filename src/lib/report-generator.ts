import { renderDocumentTemplate } from "@/lib/document-templates";
import { encounterSections, type EncounterChargeEntry, type EncounterNoteRecord, type EncounterSection } from "@/lib/encounter-notes";

type NarrativeOfficeContext = {
  officeName: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  doctorName: string;
};

type NarrativePatientContext = {
  firstName: string;
  lastName: string;
  fullName: string;
  dob: string;
  dateOfLoss: string;
  initialExam: string;
  phone: string;
  email: string;
  caseNumber: string;
  attorney: string;
  attorneyPhone: string;
  attorneyFax: string;
  attorneyEmail: string;
  attorneyAddress: string;
  caseStatus: string;
  lienStatus: string;
  priorCare: string;
  patientNotes: string;
  xrayFindings: string;
  mriCtFindings: string;
  specialistRecommendations: string;
  mrMrsMsLastName: string;
  mrMrsMsFullName: string;
  heShe: string;
  hisHer: string;
};

type NarrativeAdditionalContext = {
  dischargeDate: string;
  rbSentDate: string;
  paidDate: string;
  billedAmount: string;
  paidAmount: string;
  reviewStatus: string;
};

type NarrativeDiagnosisEntry = {
  code: string;
  description: string;
};

type NarrativeImagingEntry = {
  modalityLabel: string;
  sentDate: string;
  center: string;
  regions: string[];
  lateralityByRegion?: Record<string, string>;
  flexExtRegions?: string[];
  scheduledDate?: string;
  doneDate: string;
  reportReceivedDate: string;
  reportReviewedDate: string;
  findings?: string;
};

type NarrativeSpecialistEntry = {
  specialist: string;
  sentDate: string;
  scheduledDate: string;
  completedDate?: string;
  reportReceivedDate: string;
  reportReviewedDate?: string;
  recommendations?: string;
};

export interface NarrativeReportBuildInput {
  office: NarrativeOfficeContext;
  patient: NarrativePatientContext;
  additional: NarrativeAdditionalContext;
  encounters: EncounterNoteRecord[];
  diagnoses: NarrativeDiagnosisEntry[];
  xrayReferrals: NarrativeImagingEntry[];
  mriReferrals: NarrativeImagingEntry[];
  specialistReferrals: NarrativeSpecialistEntry[];
  /** Per-category patient-refused override flags. When the user has
   *  marked the patient as refusing imaging (no entries on file) the
   *  narrative summary swaps the bare "-" placeholder for an
   *  explanatory sentence so the report doesn't read like data is
   *  missing. */
  followUpOverrides?: {
    xrayPatientRefused?: boolean;
    mriPatientRefused?: boolean;
    specialistPatientRefused?: boolean;
  };
  promptValues?: Record<string, string>;
}

/**
 * Sanitise SOAP / macro HTML for embedding into a narrative report template.
 *
 * The template body itself is HTML (from the rich-text editor), so we
 * must NOT flatten SOAP values to plain text — that would destroy bold,
 * underline, and paragraph structure the user set up. Instead we only
 * strip the interactive macro-prompt wrapper spans (keeping their inner
 * answer text) and normalise edge empty paragraphs.
 */
function sanitizeSoapHtml(html: string): string {
  if (!html) return "";
  // Strip macro-prompt span wrappers but keep the visible answer text inside
  let text = html.replace(
    /<span\s+class="macro-prompt"[^>]*>([\s\S]*?)<\/span>/gi,
    "$1",
  );
  // Strip leading / trailing empty paragraphs
  text = text
    .replace(/^(?:<p>\s*(?:&nbsp;|<br\s*\/?\s*>)?\s*<\/p>\s*)+/gi, "")
    .replace(/(?:<p>\s*(?:&nbsp;|<br\s*\/?\s*>)?\s*<\/p>\s*)+$/gi, "");
  return text.trim();
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
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCFullYear() !== year
  ) {
    return null;
  }
  return date;
}

function toSortStamp(dateText: string) {
  const parsed = parseUsDate(dateText);
  if (!parsed) {
    return 0;
  }
  return parsed.getTime();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toTwoDigit(value: number) {
  return `${value}`.padStart(2, "0");
}

function getTodayUsDate() {
  const now = new Date();
  return `${toTwoDigit(now.getMonth() + 1)}/${toTwoDigit(now.getDate())}/${now.getFullYear()}`;
}

function formatSoapRollup(encounters: EncounterNoteRecord[], section: EncounterSection) {
  const rows = encounters
    .map((entry) => ({
      date: entry.encounterDate,
      appointmentType: entry.appointmentType,
      value: sanitizeSoapHtml(entry.soap[section]),
    }))
    .filter((entry) => entry.value);

  if (!rows.length) {
    return "-";
  }

  return rows
    .map((entry) => `<b>${toUsDate(entry.date)} (${entry.appointmentType})</b><br>${entry.value}`)
    .join("<br><br>");
}

function formatMacroRollup(encounters: EncounterNoteRecord[], section: EncounterSection) {
  const rows = encounters.flatMap((entry) =>
    entry.macroRuns
      .filter((run) => run.section === section)
      .map((run) => ({
        date: entry.encounterDate,
        macroName: run.macroName,
        value: sanitizeSoapHtml(run.generatedText),
      })),
  );

  const nonEmpty = rows.filter((entry) => entry.value);
  if (!nonEmpty.length) {
    return "-";
  }

  return nonEmpty.map((entry) => `<b>${entry.date} • ${entry.macroName}</b><br>${entry.value}`).join("<br><br>");
}

function formatChargeLine(encounterDate: string, charge: EncounterChargeEntry, index: number) {
  const unitPrice = Number.isFinite(charge.unitPrice) ? charge.unitPrice : 0;
  const units = Number.isFinite(charge.units) ? charge.units : 1;
  const total = unitPrice * units;
  return `${index}. ${toUsDate(encounterDate)} | ${charge.procedureCode} | ${charge.name} | ${formatCurrency(unitPrice)} x ${units} = ${formatCurrency(total)}`;
}

function formatDiagnosisList(entries: NarrativeDiagnosisEntry[]) {
  if (!entries.length) {
    return "-";
  }
  return entries
    .map((entry, index) => `${index + 1}. ${entry.code} - ${entry.description}`)
    .join("\n");
}

function formatImagingRegions(entry: NarrativeImagingEntry) {
  if (!entry.regions.length) {
    return "-";
  }
  const flexExt = new Set(entry.flexExtRegions ?? []);
  return entry.regions
    .map((region) => {
      const laterality = entry.lateralityByRegion?.[region] ?? "";
      const lateralityLabel = laterality ? ` (${laterality})` : "";
      const flexExtLabel = flexExt.has(region) ? " Flex/Ext" : "";
      return `${region}${lateralityLabel}${flexExtLabel}`;
    })
    .join(", ");
}

type ImagingRefusalKind = "xray" | "mri";

function imagingRefusalText(kind: ImagingRefusalKind): string {
  return kind === "xray"
    ? "Patient refused radiological imaging due to radiation concerns."
    : "Patient refused MRI's and wanted to continue with conservative chiropractic care.";
}

function formatImagingSummary(
  entries: NarrativeImagingEntry[],
  fallbackLabel: string,
  options: { patientRefused?: boolean; refusalKind?: ImagingRefusalKind } = {},
) {
  if (!entries.length) {
    // When the user has explicitly marked the patient as refusing this
    // imaging category, replace the bare "-" with the office's stock
    // refusal sentence so the report reads like a deliberate clinical
    // decision rather than missing data.
    if (options.patientRefused && options.refusalKind) {
      return imagingRefusalText(options.refusalKind);
    }
    return "-";
  }
  return entries
    .map((entry, index) => {
      const modality = entry.modalityLabel || fallbackLabel;
      const line = `${index + 1}. ${modality} | Completed: ${toUsDate(entry.doneDate || "-")} | Center: ${entry.center || "-"} | Regions: ${formatImagingRegions(entry)}`;
      const findings = entry.findings?.trim();
      // "Findings:" goes on its own line so when the body starts with a
      // region heading ("Cervical:", "Lumbar:", etc.) the first heading
      // doesn't get jammed onto the same visual line as the Findings:
      // label — which read as "Findings: Cervical:" in the rendered report.
      return findings ? `${line}\n   Findings:\n${findings}` : line;
    })
    .join("\n");
}

// Split a free-text recommendations block into individual items so they
// can be sub-numbered under a parent specialist (1 → 1a, 1b, 1c). Splits
// on hard line breaks and on common bullet markers (•, –, "1.", "1)")
// at the start of a line so the user's preferred input style — typed
// dashes, pasted bulleted lists, hand-numbered lines — all collapse to
// a single canonical numbering scheme in the report.
function splitRecommendationItems(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\r?\n+/)
    .map((line) => line.trim())
    // Strip leading bullets / hand-numbers so we don't double-prefix.
    .map((line) => line.replace(/^([•\-–*]+|\d+[.)]|[a-z][.)])\s*/i, "").trim())
    .filter((line) => line.length > 0);
  return lines;
}

function formatSpecialistSummary(entries: NarrativeSpecialistEntry[]) {
  if (!entries.length) {
    return "-";
  }
  return entries
    .map((entry, index) => {
      // Sent / Completed dates were dropped per the office's preferred
      // narrative format — the specialist's name and their actual
      // recommendations are what carries weight in the report.
      const parentNumber = index + 1;
      const headerLine = `${parentNumber}. ${entry.specialist || "-"}`;
      const recItems = splitRecommendationItems(entry.recommendations ?? "");
      if (recItems.length === 0) {
        return headerLine;
      }
      // Sub-number recommendations as 1a / 1b / 1c... so each item gets a
      // stable handle the doctor can refer to in correspondence ("per
      // item 1b of the consult..."). Capped at 26 sub-items per
      // specialist — way past anything realistic in clinical practice.
      const lines = recItems.slice(0, 26).map((item, subIdx) => {
        const letter = String.fromCharCode("a".charCodeAt(0) + subIdx);
        return `   ${parentNumber}${letter}. ${item}`;
      });
      const overflow = recItems.length > 26 ? [`   …(${recItems.length - 26} additional items)`] : [];
      return [headerLine, "   Recommendations:", ...lines, ...overflow].join("\n");
    })
    .join("\n");
}

export function appointmentTypeToTokenPrefix(typeName: string) {
  return typeName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatAmount(value: string) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return numeric.toFixed(2);
}

// ---------------------------------------------------------------------------
// Decompression Treatment Summary builder
// ---------------------------------------------------------------------------

interface DecompressionGroup {
  typeName: string;          // e.g. "cervical spinal decompression"
  count: number;
  segments: string[];        // deduplicated, ordered
  weights: number[];         // chronological (first encounter → last)
}

function toSentenceCase(text: string) {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Extracts unique segment values from all macro runs in a single encounter.
 * Handles both single-string and string-array answer values for the
 * `targeted_segment` key (case-insensitive key match).
 */
function extractSegments(encounter: EncounterNoteRecord): string[] {
  const segments: string[] = [];
  for (const run of encounter.macroRuns) {
    for (const [key, value] of Object.entries(run.answers)) {
      if (key.toLowerCase().replace(/[\s_-]+/g, "") !== "targetedsegment") continue;
      if (typeof value === "string" && value.trim()) {
        segments.push(value.trim());
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string" && v.trim()) segments.push(v.trim());
        }
      }
    }
  }
  return segments;
}

/**
 * Extracts the decompression/traction weight from an encounter's macro runs.
 * Only looks at macro runs whose name contains "decompression" or "traction"
 * to avoid picking up the patient's body weight from general exam macros.
 * Returns the numeric weight or null if not found.
 */
function extractWeight(encounter: EncounterNoteRecord): number | null {
  // First pass: only look at decompression/traction-related macros
  for (const run of encounter.macroRuns) {
    const macroNameNorm = run.macroName.toLowerCase();
    if (!/decompression|traction/i.test(macroNameNorm)) continue;
    for (const [key, value] of Object.entries(run.answers)) {
      if (key.toLowerCase().replace(/[\s_-]+/g, "") !== "weight") continue;
      const str = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
      if (!str) continue;
      const num = parseFloat(str);
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  // Second pass: look for keys that explicitly mention decompression/traction weight
  for (const run of encounter.macroRuns) {
    for (const [key, value] of Object.entries(run.answers)) {
      const normKey = key.toLowerCase().replace(/[\s_-]+/g, "");
      if (
        normKey === "decompressionweight" ||
        normKey === "tractionweight" ||
        normKey === "treatmentweight" ||
        normKey === "pullingweight"
      ) {
        const str = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
        if (!str) continue;
        const num = parseFloat(str);
        if (Number.isFinite(num) && num > 0) return num;
      }
    }
  }
  return null;
}

function toTitleCase(value: string): string {
  return value
    .split(/(\s+|-|')/)
    .map((part) => {
      if (!part || /^(\s+|-|')$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function buildDecompressionSummary(
  encountersAsc: EncounterNoteRecord[],
  patientFullName: string,
  mrMrsMsLastName: string,
): string {
  // Only closed encounters with "decompression" in appointment type
  const decomp = encountersAsc.filter(
    (e) => e.signed && /decompression/i.test(e.appointmentType),
  );

  if (!decomp.length) return "-";

  // Group by appointment type (case-insensitive normalized key)
  const groupMap = new Map<string, EncounterNoteRecord[]>();
  for (const enc of decomp) {
    const key = enc.appointmentType.trim().toLowerCase();
    const list = groupMap.get(key) ?? [];
    list.push(enc);
    groupMap.set(key, list);
  }

  const groups: DecompressionGroup[] = [];
  for (const [, encounters] of groupMap) {
    // Use the first encounter's appointmentType for display (preserves original casing)
    const typeName = encounters[0].appointmentType;

    // Deduplicate segments across all encounters in this group
    const allSegments: string[] = [];
    for (const enc of encounters) {
      allSegments.push(...extractSegments(enc));
    }
    const uniqueSegments = [...new Set(allSegments)];

    // Collect weights chronologically (encounters are already sorted asc)
    const weights: number[] = [];
    for (const enc of encounters) {
      const w = extractWeight(enc);
      if (w !== null) weights.push(w);
    }

    groups.push({
      typeName,
      count: encounters.length,
      segments: uniqueSegments,
      weights,
    });
  }

  // Use the proper honorific + Title-Cased last name ("Mr. Smith") rather
  // than the raw stored fullName, which is often "SMITH, JOHN" all-caps
  // and reads strangely in a narrative paragraph. Fall back to the full
  // name only when no honorific was supplied.
  const subject = mrMrsMsLastName.trim()
    ? toTitleCase(mrMrsMsLastName.trim())
    : toTitleCase(patientFullName.trim());

  // Suppress an obvious lint warning if patientFullName is unused after
  // this refactor (kept as the safety-net fallback above).
  void patientFullName;

  const sentences: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prefix = i === 0
      ? `${subject} completed`
      : `${subject} also completed`;

    const typeLabel = toSentenceCase(g.typeName);

    // Segments clause
    const segmentClause = g.segments.length
      ? `, targeting the ${g.segments.join(", ")} segment${g.segments.length > 1 ? "s" : ""}`
      : "";

    // Weight clause
    let weightClause = "";
    if (g.weights.length > 0) {
      const firstWeight = g.weights[0];
      const lastWeight = g.weights[g.weights.length - 1];
      if (firstWeight === lastWeight || g.weights.length === 1) {
        weightClause = ` at ${firstWeight} pounds`;
      } else {
        weightClause = `. Treatment began with ${firstWeight} pounds and ended with ${lastWeight} pounds`;
      }
    }

    const sentence = `${prefix} ${g.count} treatment${g.count !== 1 ? "s" : ""} of ${typeLabel}${segmentClause}${weightClause}.`;
    sentences.push(sentence);
  }

  return sentences.join(" ");
}

/** Convert ISO YYYY-MM-DD to US MM/DD/YYYY; pass through if already US format or empty. */
function toUsDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-");
    return `${m}/${d}/${y}`;
  }
  return trimmed;
}

export function buildNarrativeReportContext(input: NarrativeReportBuildInput) {
  const encountersAsc = [...input.encounters].sort(
    (left, right) => toSortStamp(left.encounterDate) - toSortStamp(right.encounterDate),
  );
  const firstEncounter = encountersAsc[0] ?? null;
  const latestEncounter = encountersAsc.at(-1) ?? null;

  const allCharges = encountersAsc.flatMap((entry) =>
    entry.charges.map((charge) => ({ encounterDate: entry.encounterDate, charge })),
  );

  const chargeLedger = allCharges.length
    ? allCharges.map((entry, index) => formatChargeLine(entry.encounterDate, entry.charge, index + 1)).join("\n")
    : "-";

  const totalChargeAmount = allCharges.reduce((total, entry) => {
    const unitPrice = Number.isFinite(entry.charge.unitPrice) ? entry.charge.unitPrice : 0;
    const units = Number.isFinite(entry.charge.units) ? entry.charge.units : 1;
    return total + unitPrice * units;
  }, 0);

  const billedAmountValue = Number.parseFloat(input.additional.billedAmount);
  const paidAmountValue = Number.parseFloat(input.additional.paidAmount);
  const percentagePaid =
    Number.isFinite(billedAmountValue) &&
    billedAmountValue > 0 &&
    Number.isFinite(paidAmountValue) &&
    paidAmountValue >= 0
      ? `${((paidAmountValue / billedAmountValue) * 100).toFixed(1)}%`
      : "-";

  const encounterTimeline = encountersAsc.length
    ? encountersAsc
        .map(
          (entry, index) =>
            `${index + 1}. ${toUsDate(entry.encounterDate)} | ${entry.appointmentType} | ${entry.provider} | ${
              entry.signed ? "Closed" : "Open"
            }`,
        )
        .join("\n")
    : "-";

  // Tokens whose values are sanitised HTML and must NOT be escaped by
  // renderDocumentTemplate — they keep <b>, <u>, <p> etc. intact.
  const rawHtmlTokens = new Set<string>();

  const context: Record<string, string> = {
    TODAY_DATE: getTodayUsDate(),
    OFFICE_NAME: input.office.officeName,
    OFFICE_ADDRESS: input.office.address,
    OFFICE_PHONE: input.office.phone,
    OFFICE_FAX: input.office.fax,
    OFFICE_EMAIL: input.office.email,
    DOCTOR_NAME: input.office.doctorName,

    PATIENT_FULL_NAME: input.patient.fullName,
    PATIENT_FIRST_NAME: input.patient.firstName,
    PATIENT_LAST_NAME: input.patient.lastName,
    PATIENT_DOB: toUsDate(input.patient.dob),
    PATIENT_PHONE: input.patient.phone,
    PATIENT_EMAIL: input.patient.email,
    DATE_OF_INJURY: toUsDate(input.patient.dateOfLoss),
    INITIAL_EXAM: toUsDate(input.patient.initialExam),
    CASE_NUMBER: input.patient.caseNumber,
    ATTORNEY_NAME: input.patient.attorney,
    ATTORNEY_PHONE: input.patient.attorneyPhone,
    ATTORNEY_FAX: input.patient.attorneyFax,
    ATTORNEY_EMAIL: input.patient.attorneyEmail,
    ATTORNEY_ADDRESS: input.patient.attorneyAddress,
    CASE_STATUS: input.patient.caseStatus,
    LIEN_STATUS: input.patient.lienStatus,
    PRIOR_CARE: input.patient.priorCare,
    PATIENT_NOTES: input.patient.patientNotes,
    XRAY_FINDINGS: input.patient.xrayFindings,
    MRI_CT_FINDINGS: input.patient.mriCtFindings,
    SPECIALIST_RECOMMENDATIONS: input.patient.specialistRecommendations,
    MR_MRS_MS_LAST_NAME: input.patient.mrMrsMsLastName,
    MR_MRS_MS_FULL_NAME: input.patient.mrMrsMsFullName,
    HE_SHE: input.patient.heShe,
    HIS_HER: input.patient.hisHer,

    DISCHARGE_DATE: toUsDate(input.additional.dischargeDate),
    RB_SENT_DATE: toUsDate(input.additional.rbSentDate),
    PAID_DATE: toUsDate(input.additional.paidDate),
    BILLED_AMOUNT: formatAmount(input.additional.billedAmount),
    PAID_AMOUNT: formatAmount(input.additional.paidAmount),
    REVIEW_STATUS: input.additional.reviewStatus,
    PERCENTAGE_PAID: percentagePaid,

    ENCOUNTER_COUNT: `${encountersAsc.length}`,
    FIRST_ENCOUNTER_DATE: toUsDate(firstEncounter?.encounterDate ?? "-"),
    LATEST_ENCOUNTER_DATE: toUsDate(latestEncounter?.encounterDate ?? "-"),

    FIRST_SUBJECTIVE: sanitizeSoapHtml(firstEncounter?.soap.subjective ?? "") || "-",
    FIRST_OBJECTIVE: sanitizeSoapHtml(firstEncounter?.soap.objective ?? "") || "-",
    FIRST_ASSESSMENT: sanitizeSoapHtml(firstEncounter?.soap.assessment ?? "") || "-",
    FIRST_PLAN: sanitizeSoapHtml(firstEncounter?.soap.plan ?? "") || "-",

    LATEST_SUBJECTIVE: sanitizeSoapHtml(latestEncounter?.soap.subjective ?? "") || "-",
    LATEST_OBJECTIVE: sanitizeSoapHtml(latestEncounter?.soap.objective ?? "") || "-",
    LATEST_ASSESSMENT: sanitizeSoapHtml(latestEncounter?.soap.assessment ?? "") || "-",
    LATEST_PLAN: sanitizeSoapHtml(latestEncounter?.soap.plan ?? "") || "-",

    ALL_SUBJECTIVE: formatSoapRollup(encountersAsc, "subjective"),
    ALL_OBJECTIVE: formatSoapRollup(encountersAsc, "objective"),
    ALL_ASSESSMENT: formatSoapRollup(encountersAsc, "assessment"),
    ALL_PLAN: formatSoapRollup(encountersAsc, "plan"),

    MACRO_SUBJECTIVE: formatMacroRollup(encountersAsc, "subjective"),
    MACRO_OBJECTIVE: formatMacroRollup(encountersAsc, "objective"),
    MACRO_ASSESSMENT: formatMacroRollup(encountersAsc, "assessment"),
    MACRO_PLAN: formatMacroRollup(encountersAsc, "plan"),

    ENCOUNTER_TIMELINE: encounterTimeline,
    DIAGNOSIS_LIST: formatDiagnosisList(input.diagnoses),
    DIAGNOSIS_CODES: input.diagnoses.map((entry) => entry.code).join(", "),
    CHARGE_LEDGER: chargeLedger,
    TOTAL_CHARGE_AMOUNT: formatCurrency(totalChargeAmount),

    XRAY_SUMMARY: formatImagingSummary(input.xrayReferrals, "X-Ray", {
      patientRefused: input.followUpOverrides?.xrayPatientRefused,
      refusalKind: "xray",
    }),
    XRAY_SENT_DATE: toUsDate(input.xrayReferrals[0]?.sentDate || "-"),
    XRAY_COMPLETED_DATE: toUsDate(input.xrayReferrals[0]?.doneDate || "-"),
    XRAY_REVIEWED_DATE: toUsDate(input.xrayReferrals[0]?.reportReviewedDate || "-"),
    MRI_CT_SUMMARY: formatImagingSummary(input.mriReferrals, "MRI/CT", {
      patientRefused: input.followUpOverrides?.mriPatientRefused,
      refusalKind: "mri",
    }),
    MRI_SENT_DATE: toUsDate(input.mriReferrals[0]?.sentDate || "-"),
    MRI_SCHEDULED_DATE: toUsDate(input.mriReferrals[0]?.scheduledDate || "-"),
    MRI_COMPLETED_DATE: toUsDate(input.mriReferrals[0]?.doneDate || "-"),
    MRI_REVIEWED_DATE: toUsDate(input.mriReferrals[0]?.reportReviewedDate || "-"),
    IMAGING_SUMMARY: [
      "X-Ray:",
      formatImagingSummary(input.xrayReferrals, "X-Ray", {
        patientRefused: input.followUpOverrides?.xrayPatientRefused,
        refusalKind: "xray",
      }),
      "",
      "MRI/CT:",
      formatImagingSummary(input.mriReferrals, "MRI/CT", {
        patientRefused: input.followUpOverrides?.mriPatientRefused,
        refusalKind: "mri",
      }),
    ].join("\n"),
    SPECIALIST_SUMMARY: formatSpecialistSummary(input.specialistReferrals),
    SPECIALIST_NAME: (() => {
      const names = input.specialistReferrals
        .map((s) => s.specialist.trim())
        .filter(Boolean);
      if (!names.length) return "-";
      // Deduplicate (same specialist referred for multiple issues)
      const unique = [...new Set(names)];
      if (unique.length === 1) return unique[0];
      if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
      return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
    })(),
  };

  // ── Numbered specialist tokens (SPECIALIST_1_NAME … SPECIALIST_10_RECOMMENDATIONS) ──
  for (let i = 0; i < 10; i++) {
    const n = i + 1;
    const sp = input.specialistReferrals[i] ?? null;
    context[`SPECIALIST_${n}_NAME`] = sp?.specialist || "-";
    context[`SPECIALIST_${n}_SENT`] = toUsDate(sp?.sentDate || "-");
    context[`SPECIALIST_${n}_COMPLETED`] = toUsDate(sp?.completedDate || "-");
    context[`SPECIALIST_${n}_RECOMMENDATIONS`] = sp?.recommendations?.trim() || "-";
  }

  // ── Numbered encounter tokens (ENCOUNTER_1_SUBJECTIVE … ENCOUNTER_20_PLAN) ──
  for (let i = 0; i < 20; i++) {
    const n = i + 1;
    const enc = encountersAsc[i] ?? null;
    context[`ENCOUNTER_${n}_SUBJECTIVE`] = sanitizeSoapHtml(enc?.soap.subjective ?? "") || "-";
    context[`ENCOUNTER_${n}_OBJECTIVE`] = sanitizeSoapHtml(enc?.soap.objective ?? "") || "-";
    context[`ENCOUNTER_${n}_ASSESSMENT`] = sanitizeSoapHtml(enc?.soap.assessment ?? "") || "-";
    context[`ENCOUNTER_${n}_PLAN`] = sanitizeSoapHtml(enc?.soap.plan ?? "") || "-";
    context[`ENCOUNTER_${n}_DATE`] = toUsDate(enc?.encounterDate ?? "-");
    context[`ENCOUNTER_${n}_TYPE`] = enc?.appointmentType ?? "-";
  }

  // ── Appointment-type encounter tokens (e.g. PERSONAL_INJURY_RE_EXAM_1_SUBJECTIVE) ──
  const encountersByType = new Map<string, typeof encountersAsc>();
  for (const enc of encountersAsc) {
    const key = appointmentTypeToTokenPrefix(enc.appointmentType);
    if (!key) continue;
    const group = encountersByType.get(key) ?? [];
    group.push(enc);
    encountersByType.set(key, group);
  }
  for (const [typeKey, group] of encountersByType) {
    for (let i = 0; i < Math.min(group.length, 20); i++) {
      const n = i + 1;
      const enc = group[i];
      context[`${typeKey}_${n}_SUBJECTIVE`] = sanitizeSoapHtml(enc.soap.subjective) || "-";
      context[`${typeKey}_${n}_OBJECTIVE`] = sanitizeSoapHtml(enc.soap.objective) || "-";
      context[`${typeKey}_${n}_ASSESSMENT`] = sanitizeSoapHtml(enc.soap.assessment) || "-";
      context[`${typeKey}_${n}_PLAN`] = sanitizeSoapHtml(enc.soap.plan) || "-";
      context[`${typeKey}_${n}_DATE`] = toUsDate(enc.encounterDate);
      context[`${typeKey}_${n}_TYPE`] = enc.appointmentType;
    }
  }

  // ── Decompression Treatment Summary ──
  context.DECOMPRESSION_SUMMARY = buildDecompressionSummary(
    encountersAsc,
    input.patient.fullName,
    input.patient.mrMrsMsLastName,
  );

  encounterSections.forEach((section) => {
    context[`FIRST_${section.toUpperCase()}`] =
      sanitizeSoapHtml(firstEncounter?.soap[section] ?? "") || context[`FIRST_${section.toUpperCase()}`] || "-";
    context[`LATEST_${section.toUpperCase()}`] =
      sanitizeSoapHtml(latestEncounter?.soap[section] ?? "") || context[`LATEST_${section.toUpperCase()}`] || "-";
    context[`ALL_${section.toUpperCase()}`] =
      context[`ALL_${section.toUpperCase()}`] || formatSoapRollup(encountersAsc, section);
    context[`MACRO_${section.toUpperCase()}`] =
      context[`MACRO_${section.toUpperCase()}`] || formatMacroRollup(encountersAsc, section);
  });

  if (input.promptValues) {
    Object.entries(input.promptValues).forEach(([token, value]) => {
      if (!token.trim()) {
        return;
      }
      context[token.trim().toUpperCase()] = value;
    });
  }

  // ── Mark all SOAP-derived tokens as raw HTML ──
  // These contain sanitised HTML from the rich-text editor and must keep
  // their <b>, <u>, <p> formatting when embedded into the (also-HTML)
  // report template body.
  const soapSuffixes = ["SUBJECTIVE", "OBJECTIVE", "ASSESSMENT", "PLAN"];
  for (const s of soapSuffixes) {
    rawHtmlTokens.add(`FIRST_${s}`);
    rawHtmlTokens.add(`LATEST_${s}`);
    rawHtmlTokens.add(`ALL_${s}`);
    rawHtmlTokens.add(`MACRO_${s}`);
    for (let n = 1; n <= 20; n++) {
      rawHtmlTokens.add(`ENCOUNTER_${n}_${s}`);
    }
  }
  for (const [typeKey] of encountersByType) {
    for (let n = 1; n <= 20; n++) {
      for (const s of soapSuffixes) {
        rawHtmlTokens.add(`${typeKey}_${n}_${s}`);
      }
    }
  }

  return { context, rawHtmlTokens };
}

export function renderNarrativeReportBody(
  templateBody: string,
  context: Record<string, string>,
  rawHtmlTokens?: Set<string>,
) {
  return renderDocumentTemplate(templateBody, context, rawHtmlTokens);
}

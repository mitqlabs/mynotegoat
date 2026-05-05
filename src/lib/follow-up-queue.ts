import type {
  MriAppearMode,
  MriCtClearCondition,
  SpecialistAppearWhen,
  SpecialistClearCondition,
  XrayClearCondition,
} from "@/lib/dashboard-workspace-settings";
import type { PatientRecord } from "@/lib/mock-data";
import type { PatientFollowUpOverrideMap } from "@/lib/patient-follow-up-overrides";

export type FollowUpCategory = "X-Ray" | "MRI / CT" | "Specialist" | "Lien / LOP";

export type FollowUpItem = {
  id: string;
  patientId: string;
  patientName: string;
  caseNumber: string;
  attorney: string;
  caseStatus: string;
  category: FollowUpCategory;
  stage: string;
  anchorDate: string;
  daysFromAnchor: number | null;
  note: string;
};

export type FollowUpQueueOptions = {
  includeXray?: boolean;
  includeMriCt?: boolean;
  includeSpecialist?: boolean;
  includeLienLop?: boolean;
  xrayAppearAuto?: boolean;
  mriAppearMode?: MriAppearMode;
  mriAppearDays?: number;
  specialistAppearWhen?: SpecialistAppearWhen;
  xrayClearedBy?: XrayClearCondition[];
  mriCtClearedBy?: MriCtClearCondition[];
  specialistClearedBy?: SpecialistClearCondition[];
  lienLopClearStatuses?: string[];
  /** Case statuses that auto-clear the X-Ray category for a patient.
   *  Empty/undefined → falls back to the global closedCaseStatuses
   *  list, preserving the legacy behavior where Case Closed = no
   *  reminders. */
  xrayClearStatuses?: string[];
  mriCtClearStatuses?: string[];
  specialistClearStatuses?: string[];
  followUpOverrides?: PatientFollowUpOverrideMap;
  maxItems?: number;
  closedCaseStatuses?: string[];
  xrayNoReportWarningDays?: number;
  mriNoReportWarningDays?: number;
  mriNoScheduleWarningDays?: number;
  specialistNoReportWarningDays?: number;
  specialistNoScheduleWarningDays?: number;
};

export function formatUsDateDisplay(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return value;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }

  const usShortMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (usShortMatch) {
    const month = usShortMatch[1].padStart(2, "0");
    const day = usShortMatch[2].padStart(2, "0");
    const year = `20${usShortMatch[3]}`;
    return `${month}/${day}/${year}`;
  }

  const usLongMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usLongMatch) {
    const month = usLongMatch[1].padStart(2, "0");
    const day = usLongMatch[2].padStart(2, "0");
    return `${month}/${day}/${usLongMatch[3]}`;
  }

  return value;
}

export function formatLeadingDateDisplay(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})(.*)$/);
  if (!match) {
    return value;
  }
  return `${formatUsDateDisplay(match[1])}${match[2]}`;
}

export function hasMatrixValue(value: string | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 && normalized !== "-";
}

export function toUsDateCanonical(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }
  const usShortMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (usShortMatch) {
    return `${usShortMatch[1].padStart(2, "0")}/${usShortMatch[2].padStart(2, "0")}/20${usShortMatch[3]}`;
  }
  const usLongMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usLongMatch) {
    return `${usLongMatch[1].padStart(2, "0")}/${usLongMatch[2].padStart(2, "0")}/${usLongMatch[3]}`;
  }
  return "";
}

export function extractLeadingDatePart(value: string | undefined) {
  const normalized = (value ?? "").trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!match) {
    return "";
  }
  return toUsDateCanonical(match[1]);
}

export function stripLeadingDatePart(value: string | undefined) {
  const normalized = (value ?? "").trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*(.*)$/);
  if (!match) {
    return normalized;
  }
  return match[2].trim();
}

export function toDateStampFromUs(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return 0;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const stamp = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

export function getDaysFromToday(usDate: string) {
  const stamp = toDateStampFromUs(usDate);
  if (!stamp) {
    return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = today.getTime() - stamp;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function buildCaseNumber(dateOfLoss: string, fullName: string) {
  const formattedDate = toUsDateCanonical(dateOfLoss);
  const dateMatch = formattedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return "";
  }
  const [lastName = "", firstName = ""] = fullName.split(",").map((entry) => entry.trim());
  const month = dateMatch[1];
  const day = dateMatch[2];
  const year = dateMatch[3].slice(-2);
  const cleanLast = lastName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  const cleanFirst = firstName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
  return `${month}${day}${year}${cleanLast}${cleanFirst}`;
}

function cleanAttorneyLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function buildNormalizedStatusSet(statuses: string[]) {
  return new Set(statuses.map((status) => status.trim().toLowerCase()).filter(Boolean));
}

function matchesLienClearStatus(lienRaw: string, clearStatuses: Set<string>) {
  if (!clearStatuses.size) {
    return false;
  }
  const normalizedLien = lienRaw.trim().toLowerCase();
  if (!normalizedLien) {
    return false;
  }
  for (const status of clearStatuses) {
    if (normalizedLien === status || normalizedLien.includes(status)) {
      return true;
    }
  }
  return false;
}

function isXrayCleared(
  clearedBy: Set<string>,
  overrides: { patientRefused: boolean; completedPriorCare: boolean; notNeeded: boolean } | undefined,
  xrayReviewedHasValue: boolean,
) {
  if (clearedBy.has("patientRefused") && overrides?.patientRefused) return true;
  if (clearedBy.has("completedPriorCare") && overrides?.completedPriorCare) return true;
  if (clearedBy.has("reviewed") && xrayReviewedHasValue) return true;
  if (clearedBy.has("noXray") && overrides?.notNeeded) return true;
  return false;
}

function isMriCtCleared(
  clearedBy: Set<string>,
  overrides: { patientRefused: boolean; completedPriorCare: boolean; notNeeded: boolean } | undefined,
  mriReviewedHasValue: boolean,
) {
  if (clearedBy.has("patientRefused") && overrides?.patientRefused) return true;
  if (clearedBy.has("completedPriorCare") && overrides?.completedPriorCare) return true;
  if (clearedBy.has("reviewed") && mriReviewedHasValue) return true;
  if (clearedBy.has("noMri") && overrides?.notNeeded) return true;
  return false;
}

function isSpecialistCleared(
  clearedBy: Set<string>,
  overrides: { patientRefused: boolean; completedPriorCare: boolean; notNeeded: boolean } | undefined,
  specialistReportHasValue: boolean,
) {
  if (clearedBy.has("patientRefused") && overrides?.patientRefused) return true;
  if (clearedBy.has("completedPriorCare") && overrides?.completedPriorCare) return true;
  if (clearedBy.has("report") && specialistReportHasValue) return true;
  if (clearedBy.has("noPm") && overrides?.notNeeded) return true;
  return false;
}

export function buildFollowUpItems(
  patientRows: PatientRecord[],
  options: FollowUpQueueOptions = {},
) {
  const includeXray = options.includeXray ?? true;
  const includeMriCt = options.includeMriCt ?? true;
  const includeSpecialist = options.includeSpecialist ?? true;
  const includeLienLop = options.includeLienLop ?? true;

  const xrayAppearAuto = options.xrayAppearAuto ?? true;
  const mriAppearMode: MriAppearMode = options.mriAppearMode ?? "auto";
  const mriAppearDays = options.mriAppearDays ?? 21;
  const specialistAppearWhen = options.specialistAppearWhen ?? "auto";

  // mriNoScheduleDays + specialistNoScheduleDays still drive a grace
  // window before the "Appt Not Scheduled" row pops up — keeps the row
  // from firing the second a referral leaves the office.
  //
  // The other warning settings (xrayNoReportWarningDays,
  // mriNoReportWarningDays, specialistNoReportWarningDays) are
  // intentionally NOT read here anymore: the case-flow stages are now
  // a strict 2- or 3-step progression (X-Ray: Needs Referral → Waiting
  // for Report; MRI/Specialist: Needs Referral → Appt Not Scheduled →
  // Report Not Received). The Age column on the Case Flow row tells
  // the user how long they've been waiting; we don't need a duplicate
  // "(N days since sent)" suffix-row on top of it. Settings are left
  // in dashboard-workspace-settings so persisted prefs still load.
  const mriNoScheduleDays = options.mriNoScheduleWarningDays ?? 3;
  const specialistNoScheduleDays = options.specialistNoScheduleWarningDays ?? 3;

  const xrayClearedBySet = new Set<string>(options.xrayClearedBy ?? ["patientRefused", "completedPriorCare", "reviewed", "noXray"]);
  const mriCtClearedBySet = new Set<string>(options.mriCtClearedBy ?? ["patientRefused", "completedPriorCare", "reviewed", "noMri"]);
  const specialistClearedBySet = new Set<string>(options.specialistClearedBy ?? ["patientRefused", "completedPriorCare", "report", "noPm"]);

  const lienLopClearStatuses = buildNormalizedStatusSet(options.lienLopClearStatuses ?? []);
  const followUpOverrides = options.followUpOverrides ?? {};
  const maxItems =
    typeof options.maxItems === "number" && Number.isFinite(options.maxItems)
      ? Math.max(1, Math.round(options.maxItems))
      : null;
  const closedStatuses = new Set(
    (options.closedCaseStatuses ?? []).map((statusName) => statusName.trim().toLowerCase()).filter(Boolean),
  );

  // Per-category clear-statuses sets. If the per-category list is empty,
  // fall back to the global "Case Closed" statuses so existing behavior
  // (Case Closed = no reminders for any category) is preserved for users
  // who haven't configured granular per-category control yet.
  const buildClearSet = (perCategory: string[] | undefined): Set<string> => {
    const list = perCategory && perCategory.length > 0 ? perCategory : Array.from(closedStatuses);
    return new Set(
      list
        .map((statusName) => statusName.trim().toLowerCase())
        .filter(Boolean),
    );
  };
  const xrayClearStatuses = buildClearSet(options.xrayClearStatuses);
  const mriCtClearStatuses = buildClearSet(options.mriCtClearStatuses);
  const specialistClearStatuses = buildClearSet(options.specialistClearStatuses);

  const rows: FollowUpItem[] = [];

  patientRows.forEach((patient) => {
    // Cash patients never have a lien/submission lifecycle — no attorney,
    // no R&B, no imaging follow-up queue. They're billed at the desk via
    // Cash Payments and should not generate Case Flow items.
    if (patient.isCashPatient) return;

    const patientStatusKey = patient.caseStatus.trim().toLowerCase();
    // Per-category status check — replaces the previous global early-return
    // on closedCaseStatuses. Each category checks its own clear set so
    // (e.g.) Discharged can clear X-Ray while still letting Lien fire.
    const xrayClearedByStatus = xrayClearStatuses.has(patientStatusKey);
    const mriCtClearedByStatus = mriCtClearStatuses.has(patientStatusKey);
    const specialistClearedByStatus = specialistClearStatuses.has(patientStatusKey);
    const lienClearedByStatus = closedStatuses.has(patientStatusKey);
    // (lienLopClearStatuses already gates Lien below — closedStatuses
    //  fallback for Lien preserves the historic "Case Closed hides Lien
    //  too" behavior. Users who want Lien to keep firing on a closed
    //  status simply don't mark that status as Case Closed.)

    const matrix = patient.matrix ?? {};
    const caseNumber = buildCaseNumber(patient.dateOfLoss, patient.fullName);

    // Stale-matrix heal: if the user has no X-Ray (or MRI) entries
    // in the patient file, the matrix still carries the last-sent
    // dates from a deleted entry, a legacy import, or a cloud sync
    // that lost the referrals array. Treat the matrix as empty in
    // that case so Case Flow doesn't report "Sent, waiting for done
    // date" on a patient whose imaging list is visibly empty.
    //
    // We treat empty array AND undefined the same way: if the patient
    // page shows zero entries but the matrix says "sent on date X",
    // the matrix is the stale one and the page is the truth. Earlier
    // versions of this guard kept undefined trusting the matrix for
    // legacy back-compat — but that left the case flow contradicting
    // the patient page, which is more confusing than missing the
    // legacy stage.
    // Per-referral "patientRefused" flag — set in the Edit Imaging /
    // Edit Specialist modals when a patient was sent but never went.
    // The case flow needs to treat refused referrals as closed so it
    // stops asking the user to chase a Done date that's never coming.
    const isRefused = (entry: unknown) =>
      Boolean((entry as { patientRefused?: boolean })?.patientRefused);
    const xrayAllEntries = Array.isArray(patient.xrayReferrals) ? patient.xrayReferrals : [];
    const mriAllEntries = Array.isArray(patient.mriReferrals) ? patient.mriReferrals : [];
    const xrayOpenEntries = xrayAllEntries.filter((entry) => !isRefused(entry));
    const mriOpenEntries = mriAllEntries.filter((entry) => !isRefused(entry));
    const xrayHasEntries = xrayOpenEntries.length > 0;
    const mriHasEntries = mriOpenEntries.length > 0;
    const xrayAllRefused = xrayAllEntries.length > 0 && xrayOpenEntries.length === 0;
    const mriAllRefused = mriAllEntries.length > 0 && mriOpenEntries.length === 0;
    const xrayMatrixStale = !xrayHasEntries;
    const mriMatrixStale = !mriHasEntries;

    const xraySentRaw = xrayMatrixStale ? "" : (matrix.xraySent ?? "");
    const xrayDoneRaw = xrayMatrixStale ? "" : (matrix.xrayDone ?? "");
    const xrayReceivedRaw = xrayMatrixStale ? "" : (matrix.xrayReceived ?? "");
    const xrayReviewedRaw = xrayMatrixStale ? "" : (matrix.xrayReviewed ?? "");

    const mriSentRaw = mriMatrixStale ? "" : (matrix.mriSent ?? "");
    const mriScheduledRaw = mriMatrixStale ? "" : (matrix.mriScheduled ?? "");
    const mriDoneRaw = mriMatrixStale ? "" : (matrix.mriDone ?? "");
    const mriReceivedRaw = mriMatrixStale ? "" : (matrix.mriReceived ?? "");
    const mriReviewedRaw = mriMatrixStale ? "" : (matrix.mriReviewed ?? "");

    const specialistSentRaw = matrix.specialistSent ?? "";
    const specialistScheduledRaw = matrix.specialistScheduled ?? "";
    const specialistReportRaw = matrix.specialistReport ?? "";
    const lienRaw = matrix.lien ?? "";
    const initialExamRaw = matrix.initialExam ?? "";

    const patientOverrides = followUpOverrides[patient.id];

    // --- X-Ray ---
    if (includeXray && !xrayClearedByStatus) {
      const xrayCleared =
        isXrayCleared(xrayClearedBySet, patientOverrides?.xray, hasMatrixValue(xrayReviewedRaw)) ||
        // Every referral on file is patient-refused — nothing to chase.
        xrayAllRefused;

      if (!xrayCleared) {
        const hasSent = hasMatrixValue(xraySentRaw);
        const hasReceived = hasMatrixValue(xrayReceivedRaw);

        // Two-stage X-Ray flow, mutually exclusive. The intermediate
        // "Done, waiting for report" / "Report received, waiting for
        // review" rows are gone — once the report is received, the row
        // disappears entirely (review is tracked elsewhere, not here).
        // The duplicate "no report received (X days)" warning row is
        // also gone; if the user wants a chase reminder, leave the row
        // visible — its age in the Age column tells the same story.
        if (xrayAppearAuto && !hasSent) {
          // Stage 1: Needs Referral.
          const anchorDate = toUsDateCanonical(patient.dateOfLoss);
          rows.push({
            id: `${patient.id}-xray-needs-sent`,
            patientId: patient.id,
            patientName: patient.fullName,
            caseNumber,
            attorney: cleanAttorneyLabel(patient.attorney),
            caseStatus: patient.caseStatus,
            category: "X-Ray",
            stage: "Needs Referral",
            anchorDate,
            daysFromAnchor: getDaysFromToday(anchorDate),
            note: "",
          });
        } else if (hasSent && !hasReceived) {
          // Stage 2: Waiting for Report.
          const sentDate = extractLeadingDatePart(xraySentRaw);
          rows.push({
            id: `${patient.id}-xray-report-received`,
            patientId: patient.id,
            patientName: patient.fullName,
            caseNumber,
            attorney: cleanAttorneyLabel(patient.attorney),
            caseStatus: patient.caseStatus,
            category: "X-Ray",
            stage: "Waiting for Report",
            anchorDate: sentDate,
            daysFromAnchor: getDaysFromToday(sentDate),
            note: stripLeadingDatePart(xraySentRaw),
          });
        }
      }
    }

    // --- MRI / CT ---
    if (includeMriCt && !mriCtClearedByStatus) {
      const mriCleared =
        isMriCtCleared(mriCtClearedBySet, patientOverrides?.mriCt, hasMatrixValue(mriReviewedRaw)) ||
        // Every MRI/CT referral on file is patient-refused — leave it alone.
        mriAllRefused;

      if (!mriCleared) {
        const hasSent = hasMatrixValue(mriSentRaw);
        const hasScheduled = hasMatrixValue(mriScheduledRaw);
        const hasReceived = hasMatrixValue(mriReceivedRaw);

        // Stage-1 appear rule. "auto" surfaces the row immediately on
        // case creation; "days_from_initial" waits N days from the
        // initial exam so chiros who only refer for MRI after a course
        // of conservative care don't get pinged on day one.
        let shouldAppear = hasSent;
        if (!hasSent) {
          if (mriAppearMode === "auto") {
            shouldAppear = true;
          } else if (mriAppearMode === "days_from_initial") {
            const initialDate = extractLeadingDatePart(initialExamRaw);
            if (initialDate) {
              const daysSinceInitial = getDaysFromToday(initialDate);
              if (daysSinceInitial !== null && daysSinceInitial >= mriAppearDays) {
                shouldAppear = true;
              }
            }
          }
        }

        // Three-stage MRI flow, mutually exclusive. The old
        // "Done waiting for received" / "Report received waiting for
        // review" stages and the duplicated "no report received (X
        // days)" / "appt not scheduled (X days)" warning rows are gone;
        // a single patient can only sit at one stage now, gated by the
        // next required date being filled.
        if (shouldAppear && !hasSent) {
          // Stage 1: Needs Referral.
          const anchorDate = extractLeadingDatePart(initialExamRaw) || toUsDateCanonical(patient.dateOfLoss);
          rows.push({
            id: `${patient.id}-mri-needs-sent`,
            patientId: patient.id,
            patientName: patient.fullName,
            caseNumber,
            attorney: cleanAttorneyLabel(patient.attorney),
            caseStatus: patient.caseStatus,
            category: "MRI / CT",
            stage: "Needs Referral",
            anchorDate,
            daysFromAnchor: getDaysFromToday(anchorDate),
            note: "",
          });
        } else if (hasSent && !hasScheduled) {
          // Stage 2: Appt Not Scheduled. Honors the existing
          // mriNoScheduleWarningDays grace (default 3) so the row
          // doesn't pop up the moment the referral leaves the office.
          const sentDate = extractLeadingDatePart(mriSentRaw);
          const daysSinceSent = getDaysFromToday(sentDate);
          const passedGrace =
            daysSinceSent === null
              ? true
              : daysSinceSent >= mriNoScheduleDays;
          if (passedGrace) {
            rows.push({
              id: `${patient.id}-mri-no-schedule`,
              patientId: patient.id,
              patientName: patient.fullName,
              caseNumber,
              attorney: cleanAttorneyLabel(patient.attorney),
              caseStatus: patient.caseStatus,
              category: "MRI / CT",
              stage: "Appt Not Scheduled",
              anchorDate: sentDate,
              daysFromAnchor: daysSinceSent,
              note: stripLeadingDatePart(mriSentRaw),
            });
          }
        } else if (hasScheduled && !hasReceived) {
          // Stage 3: Report Not Received. Fires the day AFTER the
          // scheduled MRI date — the report rarely lands the same day
          // as the scan, and showing the row on the visit day itself
          // generates noise for cases that are still on track.
          const scheduledDate = extractLeadingDatePart(mriScheduledRaw);
          const daysSinceScheduled = getDaysFromToday(scheduledDate);
          const visitHasPassed =
            daysSinceScheduled === null ? true : daysSinceScheduled >= 1;
          if (visitHasPassed) {
            rows.push({
              id: `${patient.id}-mri-report-received`,
              patientId: patient.id,
              patientName: patient.fullName,
              caseNumber,
              attorney: cleanAttorneyLabel(patient.attorney),
              caseStatus: patient.caseStatus,
              category: "MRI / CT",
              stage: "Report Not Received",
              anchorDate: scheduledDate,
              daysFromAnchor: daysSinceScheduled,
              note: "",
            });
          }
        }
      }
    }

    // --- Specialist ---
    if (includeSpecialist && !specialistClearedByStatus) {
      const specialistAllEntries = Array.isArray(patient.specialistReferrals)
        ? patient.specialistReferrals
        : [];
      const specialistOpenEntries = specialistAllEntries.filter((entry) => !isRefused(entry));
      const specialistAllRefused =
        specialistAllEntries.length > 0 && specialistOpenEntries.length === 0;
      const specCleared =
        isSpecialistCleared(
          specialistClearedBySet,
          patientOverrides?.specialist,
          hasMatrixValue(specialistReportRaw),
        ) ||
        // Every specialist referral on file is patient-refused.
        specialistAllRefused;

      if (!specCleared) {
        const hasSent = hasMatrixValue(specialistSentRaw);
        const hasScheduled = hasMatrixValue(specialistScheduledRaw);

        // Specialist appear rule
        let specialistShouldAppear = hasSent; // always show if referral started
        if (!hasSent) {
          if (specialistAppearWhen === "auto") {
            // Auto: appear immediately like X-Ray (on case creation)
            specialistShouldAppear = true;
          } else if (specialistAppearWhen === "mri_sent" && hasMatrixValue(mriSentRaw)) {
            specialistShouldAppear = true;
          } else if (specialistAppearWhen === "mri_reviewed" && hasMatrixValue(mriReviewedRaw)) {
            specialistShouldAppear = true;
          }
        }

        // Three-stage progression, mutually exclusive — each stage gates
        // on the previous date being filled, so a patient can only ever
        // appear at one stage at a time. Previously the queue piled on
        // separate "warning" rows whose preconditions overlapped (e.g.
        // "Appt not scheduled" and "No report received" both fired off
        // hasSent), so a single patient could show both rows even though
        // no appointment had been scheduled. The user feedback that
        // surfaced this: "Smith, John → Appt Not Scheduled" + "Smith,
        // John → Report Not Received" appearing simultaneously.
        if (specialistShouldAppear && !hasSent) {
          // Stage 1: Needs Referral. Anchor falls back to MRI sent date,
          // then DOL, so the row's age reflects how long we've been
          // waiting to act on the referral.
          const anchorDate = extractLeadingDatePart(mriSentRaw) || toUsDateCanonical(patient.dateOfLoss);
          rows.push({
            id: `${patient.id}-specialist-needs-sent`,
            patientId: patient.id,
            patientName: patient.fullName,
            caseNumber,
            attorney: cleanAttorneyLabel(patient.attorney),
            caseStatus: patient.caseStatus,
            category: "Specialist",
            stage: "Needs Referral",
            anchorDate,
            daysFromAnchor: getDaysFromToday(anchorDate),
            note: "",
          });
        } else if (hasSent && !hasScheduled) {
          // Stage 2: Appt Not Scheduled. Honors the existing
          // specialistNoScheduleWarningDays grace (default 3) so the row
          // doesn't pop up the second the referral leaves the office.
          const sentDate = extractLeadingDatePart(specialistSentRaw);
          const daysSinceSent = getDaysFromToday(sentDate);
          const passedGrace =
            daysSinceSent === null
              ? true // unparseable sent date → don't suppress
              : daysSinceSent >= specialistNoScheduleDays;
          if (passedGrace) {
            rows.push({
              id: `${patient.id}-specialist-scheduled`,
              patientId: patient.id,
              patientName: patient.fullName,
              caseNumber,
              attorney: cleanAttorneyLabel(patient.attorney),
              caseStatus: patient.caseStatus,
              category: "Specialist",
              stage: "Appt Not Scheduled",
              anchorDate: sentDate,
              daysFromAnchor: daysSinceSent,
              note: stripLeadingDatePart(specialistSentRaw),
            });
          }
        } else if (hasScheduled && !hasMatrixValue(specialistReportRaw)) {
          // Stage 3: Report Not Received. Fires the day AFTER the
          // scheduled appointment — the report rarely lands the same
          // day as the visit, and showing the row on the visit day
          // itself generates noise for cases that are still on track.
          // Unparseable scheduled date falls back to showing the row.
          const scheduledDate = extractLeadingDatePart(specialistScheduledRaw);
          const daysSinceScheduled = getDaysFromToday(scheduledDate);
          const visitHasPassed =
            daysSinceScheduled === null ? true : daysSinceScheduled >= 1;
          if (visitHasPassed) {
            rows.push({
              id: `${patient.id}-specialist-report`,
              patientId: patient.id,
              patientName: patient.fullName,
              caseNumber,
              attorney: cleanAttorneyLabel(patient.attorney),
              caseStatus: patient.caseStatus,
              category: "Specialist",
              stage: "Report Not Received",
              anchorDate: scheduledDate,
              daysFromAnchor: daysSinceScheduled,
              note: stripLeadingDatePart(specialistSentRaw),
            });
          }
        }
      }
    }

    // --- Lien / LOP ---
    if (includeLienLop && !lienClearedByStatus) {
      const normalizedLien = lienRaw.trim().toLowerCase();
      const lienHasValue = hasMatrixValue(lienRaw);
      const isSelectedClearStatus = matchesLienClearStatus(lienRaw, lienLopClearStatuses);
      const isNotSent =
        !lienHasValue || normalizedLien === "not set" || normalizedLien === "not sent";
      const isReceived =
        normalizedLien.includes("received") ||
        normalizedLien.includes("complete") ||
        normalizedLien.includes("resolved");

      if (!isSelectedClearStatus && (isNotSent || !isReceived)) {
        const stage = isNotSent
          ? "Not sent yet"
          : normalizedLien.includes("request")
            ? "Requested, waiting for received"
            : "Sent, waiting for received";
        const anchorDate =
          extractLeadingDatePart(lienRaw) ||
          extractLeadingDatePart(initialExamRaw) ||
          toUsDateCanonical(patient.dateOfLoss);
        rows.push({
          id: `${patient.id}-lien-follow-up`,
          patientId: patient.id,
          patientName: patient.fullName,
          caseNumber,
          attorney: cleanAttorneyLabel(patient.attorney),
          caseStatus: patient.caseStatus,
          category: "Lien / LOP",
          stage,
          anchorDate,
          daysFromAnchor: getDaysFromToday(anchorDate),
          note: isNotSent ? "" : stripLeadingDatePart(lienRaw),
        });
      }
    }
  });

  const sorted = rows.sort((left, right) => {
    const leftDays = left.daysFromAnchor ?? -99999;
    const rightDays = right.daysFromAnchor ?? -99999;
    if (leftDays !== rightDays) {
      return rightDays - leftDays;
    }
    const leftDate = toDateStampFromUs(left.anchorDate);
    const rightDate = toDateStampFromUs(right.anchorDate);
    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }
    return left.patientName.localeCompare(right.patientName);
  });

  return maxItems ? sorted.slice(0, maxItems) : sorted;
}

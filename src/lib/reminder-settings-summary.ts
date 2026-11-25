/**
 * One-line Case Flow summaries for the Reminders settings rows.
 * Display only — these strings are not stored.
 */
import type { DashboardWorkspaceSettings, SpecialistAppearWhen } from "@/lib/dashboard-workspace-settings";

export const XRAY_CLEAR_CHOICES = [
  ["patientRefused", "Patient Refused"],
  ["completedPriorCare", "Completed Prior Care"],
  ["noXray", "No X-Ray"],
] as const;

export const MRI_CLEAR_CHOICES = [
  ["patientRefused", "Patient Refused"],
  ["completedPriorCare", "Completed Prior Care"],
  ["noMri", "No MRI"],
] as const;

export const SPECIALIST_CLEAR_CHOICES = [
  ["patientRefused", "Patient Refused"],
  ["completedPriorCare", "Completed Prior Care"],
  ["report", "Received"],
  ["noPm", "No Spcl"],
] as const;

const SPECIALIST_APPEAR_SUMMARY: Record<SpecialistAppearWhen, string> = {
  auto: "Appears on case creation",
  mri_sent: "Appears after MRI sent",
  mri_completed: "Appears after MRI completed",
  mri_reviewed: "Appears once MRI reviewed",
};

function days(n: number) {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

function statuses(n: number) {
  return `${n} ${n === 1 ? "status" : "statuses"}`;
}

/** How many of the chips on screen are selected. Hidden legacy values stay out of the count. */
export function visibleClearCount(
  selectedConditions: readonly string[],
  selectedStatuses: readonly string[],
  choices: readonly (readonly [string, string])[],
  statusNames: readonly string[],
) {
  const choiceValues = new Set(choices.map(([value]) => value));
  const names = new Set(statusNames);
  const conditions = selectedConditions.filter((value) => choiceValues.has(value)).length;
  const statusesSelected = selectedStatuses.filter((name) => names.has(name)).length;
  return conditions + statusesSelected;
}

type FollowUp = DashboardWorkspaceSettings["patientFollowUp"];

export function xrayRowSummary(followUp: FollowUp, statusNames: readonly string[]) {
  const appear = followUp.xrayAppearAuto ? "Appears on case creation" : "Does not appear on case creation";
  const cleared = visibleClearCount(followUp.xrayClearedBy, followUp.xrayClearStatuses, XRAY_CLEAR_CHOICES, statusNames);
  return `${appear} · clears on ${statuses(cleared)}`;
}

export function mriRowSummary(followUp: FollowUp, statusNames: readonly string[]) {
  const appear =
    followUp.mriAppearMode === "days_from_initial"
      ? `Appears after ${days(followUp.mriAppearDays)}`
      : "Appears on case creation";
  const cleared = visibleClearCount(followUp.mriCtClearedBy, followUp.mriCtClearStatuses, MRI_CLEAR_CHOICES, statusNames);
  return `${appear} · warns after ${days(followUp.mriNoScheduleWarningDays)} · clears on ${statuses(cleared)}`;
}

export function specialistRowSummary(followUp: FollowUp, statusNames: readonly string[]) {
  const appear = SPECIALIST_APPEAR_SUMMARY[followUp.specialistAppearWhen];
  const cleared = visibleClearCount(
    followUp.specialistClearedBy,
    followUp.specialistClearStatuses,
    SPECIALIST_CLEAR_CHOICES,
    statusNames,
  );
  return `${appear} · warns after ${days(followUp.specialistNoScheduleWarningDays)} · clears on ${statuses(cleared)}`;
}

export function lienRowSummary(followUp: FollowUp) {
  const status = followUp.lienLopClearStatuses[0]?.trim();
  return status ? `Clears when ${status}` : "No clear status chosen";
}

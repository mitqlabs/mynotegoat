/**
 * The Case Flow queue options built from Office Settings — ONE place, so the
 * Patient List → Case Flow screen and G.O.A.T.'s case-pipeline answers read
 * exactly the same rules (appear/clear conditions, closed statuses, overrides).
 */
import type { DashboardWorkspaceSettings } from "@/lib/dashboard-workspace-settings";
import type { FollowUpQueueOptions } from "@/lib/follow-up-queue";
import type { PatientFollowUpOverrideMap } from "@/lib/patient-follow-up-overrides";

export function caseFlowOptions(
  fu: DashboardWorkspaceSettings["patientFollowUp"],
  closedCaseStatuses: string[],
  followUpOverrides: PatientFollowUpOverrideMap,
): FollowUpQueueOptions {
  return {
    includeXray: fu.includeXray,
    includeMriCt: fu.includeMriCt,
    includeSpecialist: fu.includeSpecialist,
    includeLienLop: fu.includeLienLop,
    xrayAppearAuto: fu.xrayAppearAuto,
    mriAppearMode: fu.mriAppearMode,
    mriAppearDays: fu.mriAppearDays,
    specialistAppearWhen: fu.specialistAppearWhen,
    xrayClearedBy: fu.xrayClearedBy,
    mriCtClearedBy: fu.mriCtClearedBy,
    specialistClearedBy: fu.specialistClearedBy,
    lienLopClearStatuses: fu.lienLopClearStatuses,
    xrayClearStatuses: fu.xrayClearStatuses,
    mriCtClearStatuses: fu.mriCtClearStatuses,
    specialistClearStatuses: fu.specialistClearStatuses,
    xrayNoReportWarningDays: fu.xrayNoReportWarningDays,
    mriNoReportWarningDays: fu.mriNoReportWarningDays,
    mriNoScheduleWarningDays: fu.mriNoScheduleWarningDays,
    specialistNoReportWarningDays: fu.specialistNoReportWarningDays,
    specialistNoScheduleWarningDays: fu.specialistNoScheduleWarningDays,
    followUpOverrides,
    closedCaseStatuses,
  };
}

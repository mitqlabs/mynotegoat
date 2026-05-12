export type XrayClearCondition = "patientRefused" | "completedPriorCare" | "reviewed" | "noXray";
export type MriCtClearCondition = "patientRefused" | "completedPriorCare" | "reviewed" | "noMri";
export type SpecialistClearCondition = "patientRefused" | "completedPriorCare" | "report" | "noPm";
export type MriAppearMode = "auto" | "days_from_initial";
export type SpecialistAppearWhen =
  | "auto"
  | "mri_sent"
  | "mri_completed"
  | "mri_reviewed";

export const XRAY_CLEAR_OPTIONS: { value: XrayClearCondition; label: string }[] = [
  { value: "patientRefused", label: "Patient Refused" },
  { value: "completedPriorCare", label: "Completed Prior Care" },
  { value: "reviewed", label: "Reviewed" },
  { value: "noXray", label: "No X-Ray" },
];

export const MRI_CT_CLEAR_OPTIONS: { value: MriCtClearCondition; label: string }[] = [
  { value: "patientRefused", label: "Patient Refused" },
  { value: "completedPriorCare", label: "Completed Prior Care" },
  { value: "reviewed", label: "Reviewed" },
  { value: "noMri", label: "No MRI" },
];

export const SPECIALIST_CLEAR_OPTIONS: { value: SpecialistClearCondition; label: string }[] = [
  { value: "patientRefused", label: "Patient Refused" },
  { value: "completedPriorCare", label: "Completed Prior Care" },
  { value: "report", label: "Received" },
  { value: "noPm", label: "No Spcl" },
];

export interface DashboardWorkspaceSettings {
  myTasks: {
    showOnDashboard: boolean;
    openOnly: boolean;
    maxItems: number;
  };
  patientFollowUp: {
    showOnDashboard: boolean;
    includeXray: boolean;
    includeMriCt: boolean;
    includeSpecialist: boolean;
    includeLienLop: boolean;
    xrayAppearAuto: boolean;
    mriAppearMode: MriAppearMode;
    mriAppearDays: number;
    specialistAppearWhen: SpecialistAppearWhen;
    xrayNoReportWarningDays: number;
    mriNoReportWarningDays: number;
    mriNoScheduleWarningDays: number;
    specialistNoReportWarningDays: number;
    specialistNoScheduleWarningDays: number;
    xrayClearedBy: XrayClearCondition[];
    mriCtClearedBy: MriCtClearCondition[];
    specialistClearedBy: SpecialistClearCondition[];
    lienLopClearStatuses: string[];
    /** Case statuses that auto-clear the X-Ray follow-up category for a
     *  patient. Mirrors the Lien behavior — used to keep e.g. Discharged
     *  cases from showing X-Ray reminders that no longer matter while
     *  still letting Lien reminders fire. */
    xrayClearStatuses: string[];
    mriCtClearStatuses: string[];
    specialistClearStatuses: string[];
    staleDaysThreshold: number;
    maxItems: number;
  };
}

const STORAGE_KEY = "casemate.dashboard-workspace-settings.v1";

const VALID_XRAY_CLEAR: Set<string> = new Set(["patientRefused", "completedPriorCare", "reviewed", "noXray"]);
const VALID_MRI_CLEAR: Set<string> = new Set(["patientRefused", "completedPriorCare", "reviewed", "noMri"]);
const VALID_SPECIALIST_CLEAR: Set<string> = new Set(["patientRefused", "completedPriorCare", "report", "noPm"]);

export function getDefaultDashboardWorkspaceSettings(): DashboardWorkspaceSettings {
  return {
    myTasks: {
      showOnDashboard: true,
      openOnly: true,
      maxItems: 6,
    },
    patientFollowUp: {
      showOnDashboard: true,
      includeXray: true,
      includeMriCt: true,
      includeSpecialist: true,
      includeLienLop: true,
      xrayAppearAuto: true,
      mriAppearMode: "auto",
      mriAppearDays: 21,
      // Default updated per user workflow: "Needs Referral" should
      // surface once the MRI is actually completed (the scan was
      // done), not on case creation. Surfacing earlier was generating
      // false alerts for patients whose treatment plan was still
      // pre-imaging.
      specialistAppearWhen: "mri_completed",
      xrayNoReportWarningDays: 14,
      mriNoReportWarningDays: 14,
      mriNoScheduleWarningDays: 3,
      specialistNoReportWarningDays: 14,
      specialistNoScheduleWarningDays: 3,
      xrayClearedBy: ["patientRefused", "completedPriorCare", "reviewed", "noXray"],
      mriCtClearedBy: ["patientRefused", "completedPriorCare", "reviewed", "noMri"],
      specialistClearedBy: ["patientRefused", "completedPriorCare", "report", "noPm"],
      lienLopClearStatuses: ["Received"],
      // Default per-category clear lists are empty: existing users keep
      // their behavior because buildFollowUpItems still falls back to the
      // closedCaseStatuses list when these are blank. Users who want
      // granular per-status control fill these in via Reminder Settings.
      xrayClearStatuses: [],
      mriCtClearStatuses: [],
      specialistClearStatuses: [],
      staleDaysThreshold: 14,
      maxItems: 10,
    },
  };
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeMriAppearMode(value: unknown, fallback: MriAppearMode): MriAppearMode {
  return value === "auto" || value === "days_from_initial" ? value : fallback;
}

function normalizeSpecialistAppearWhen(value: unknown, fallback: SpecialistAppearWhen): SpecialistAppearWhen {
  return value === "auto" ||
    value === "mri_sent" ||
    value === "mri_completed" ||
    value === "mri_reviewed"
    ? value
    : fallback;
}

function normalizeClearArray<T extends string>(value: unknown, validSet: Set<string>, fallback: T[]): T[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const result: T[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && validSet.has(entry) && !seen.has(entry)) {
      seen.add(entry);
      result.push(entry as T);
    }
  }
  return result.length > 0 ? result : fallback;
}

function normalizeStatusList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const deduped = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }
    const normalized = entry.trim();
    if (!normalized) {
      return;
    }
    deduped.add(normalized);
  });
  return deduped.size ? Array.from(deduped).slice(0, 20) : fallback;
}

export function normalizeDashboardWorkspaceSettings(value: unknown): DashboardWorkspaceSettings {
  const defaults = getDefaultDashboardWorkspaceSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const raw = value as Partial<DashboardWorkspaceSettings>;
  const rawMyTasks = (raw.myTasks ?? {}) as Partial<DashboardWorkspaceSettings["myTasks"]>;
  const rawFollowUp = (raw.patientFollowUp ?? {}) as Partial<
    DashboardWorkspaceSettings["patientFollowUp"]
  >;

  // Migration: if old xrayClearWhen/mriCtClearWhen/specialistClearWhen fields exist, map them
  const rawAny = rawFollowUp as Record<string, unknown>;
  let xrayClearedByRaw = rawFollowUp.xrayClearedBy;
  let mriCtClearedByRaw = rawFollowUp.mriCtClearedBy;
  let specialistClearedByRaw = rawFollowUp.specialistClearedBy;

  if (!xrayClearedByRaw && typeof rawAny.xrayClearWhen === "string") {
    xrayClearedByRaw = ["patientRefused", "completedPriorCare", rawAny.xrayClearWhen as XrayClearCondition, "noXray"];
  }
  if (!mriCtClearedByRaw && typeof rawAny.mriCtClearWhen === "string") {
    mriCtClearedByRaw = ["patientRefused", "completedPriorCare", rawAny.mriCtClearWhen as MriCtClearCondition, "noMri"];
  }
  if (!specialistClearedByRaw && typeof rawAny.specialistClearWhen === "string") {
    specialistClearedByRaw = ["patientRefused", "completedPriorCare", rawAny.specialistClearWhen as SpecialistClearCondition, "noPm"];
  }

  return {
    myTasks: {
      showOnDashboard:
        typeof rawMyTasks.showOnDashboard === "boolean"
          ? rawMyTasks.showOnDashboard
          : defaults.myTasks.showOnDashboard,
      openOnly: typeof rawMyTasks.openOnly === "boolean" ? rawMyTasks.openOnly : defaults.myTasks.openOnly,
      maxItems: normalizeNumber(rawMyTasks.maxItems, 1, 25, defaults.myTasks.maxItems),
    },
    patientFollowUp: {
      showOnDashboard:
        typeof rawFollowUp.showOnDashboard === "boolean"
          ? rawFollowUp.showOnDashboard
          : defaults.patientFollowUp.showOnDashboard,
      includeXray:
        typeof rawFollowUp.includeXray === "boolean" ? rawFollowUp.includeXray : defaults.patientFollowUp.includeXray,
      includeMriCt:
        typeof rawFollowUp.includeMriCt === "boolean"
          ? rawFollowUp.includeMriCt
          : defaults.patientFollowUp.includeMriCt,
      includeSpecialist:
        typeof rawFollowUp.includeSpecialist === "boolean"
          ? rawFollowUp.includeSpecialist
          : defaults.patientFollowUp.includeSpecialist,
      includeLienLop:
        typeof rawFollowUp.includeLienLop === "boolean"
          ? rawFollowUp.includeLienLop
          : defaults.patientFollowUp.includeLienLop,
      xrayAppearAuto:
        typeof rawFollowUp.xrayAppearAuto === "boolean"
          ? rawFollowUp.xrayAppearAuto
          : defaults.patientFollowUp.xrayAppearAuto,
      mriAppearMode: normalizeMriAppearMode(
        rawFollowUp.mriAppearMode ?? (rawAny.mriAppearAuto === true ? "days_from_initial" : undefined),
        defaults.patientFollowUp.mriAppearMode,
      ),
      mriAppearDays: normalizeNumber(rawFollowUp.mriAppearDays, 1, 365, defaults.patientFollowUp.mriAppearDays),
      specialistAppearWhen: normalizeSpecialistAppearWhen(
        rawFollowUp.specialistAppearWhen,
        defaults.patientFollowUp.specialistAppearWhen,
      ),
      xrayNoReportWarningDays: normalizeNumber(rawFollowUp.xrayNoReportWarningDays, 0, 365, defaults.patientFollowUp.xrayNoReportWarningDays),
      mriNoReportWarningDays: normalizeNumber(rawFollowUp.mriNoReportWarningDays, 0, 365, defaults.patientFollowUp.mriNoReportWarningDays),
      mriNoScheduleWarningDays: normalizeNumber(rawFollowUp.mriNoScheduleWarningDays, 0, 365, defaults.patientFollowUp.mriNoScheduleWarningDays),
      specialistNoReportWarningDays: normalizeNumber(rawFollowUp.specialistNoReportWarningDays, 0, 365, defaults.patientFollowUp.specialistNoReportWarningDays),
      specialistNoScheduleWarningDays: normalizeNumber(rawFollowUp.specialistNoScheduleWarningDays, 0, 365, defaults.patientFollowUp.specialistNoScheduleWarningDays),
      xrayClearedBy: normalizeClearArray(xrayClearedByRaw, VALID_XRAY_CLEAR, defaults.patientFollowUp.xrayClearedBy),
      mriCtClearedBy: normalizeClearArray(mriCtClearedByRaw, VALID_MRI_CLEAR, defaults.patientFollowUp.mriCtClearedBy),
      specialistClearedBy: normalizeClearArray(
        specialistClearedByRaw,
        VALID_SPECIALIST_CLEAR,
        defaults.patientFollowUp.specialistClearedBy,
      ),
      lienLopClearStatuses: normalizeStatusList(
        rawFollowUp.lienLopClearStatuses,
        defaults.patientFollowUp.lienLopClearStatuses,
      ),
      xrayClearStatuses: normalizeStatusList(
        rawFollowUp.xrayClearStatuses,
        defaults.patientFollowUp.xrayClearStatuses,
      ),
      mriCtClearStatuses: normalizeStatusList(
        rawFollowUp.mriCtClearStatuses,
        defaults.patientFollowUp.mriCtClearStatuses,
      ),
      specialistClearStatuses: normalizeStatusList(
        rawFollowUp.specialistClearStatuses,
        defaults.patientFollowUp.specialistClearStatuses,
      ),
      staleDaysThreshold: normalizeNumber(
        rawFollowUp.staleDaysThreshold,
        1,
        365,
        defaults.patientFollowUp.staleDaysThreshold,
      ),
      maxItems: normalizeNumber(rawFollowUp.maxItems, 1, 50, defaults.patientFollowUp.maxItems),
    },
  };
}

export function loadDashboardWorkspaceSettings(): DashboardWorkspaceSettings {
  if (typeof window === "undefined") {
    return getDefaultDashboardWorkspaceSettings();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultDashboardWorkspaceSettings();
    }
    return normalizeDashboardWorkspaceSettings(JSON.parse(raw));
  } catch {
    return getDefaultDashboardWorkspaceSettings();
  }
}

export function saveDashboardWorkspaceSettings(settings: DashboardWorkspaceSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeDashboardWorkspaceSettings(settings)));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

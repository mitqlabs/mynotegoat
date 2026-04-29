export type FollowUpOverrideCategory = "xray" | "mriCt" | "specialist";

export interface FollowUpCategoryOverrideFlags {
  patientRefused: boolean;
  completedPriorCare: boolean;
  notNeeded: boolean;
}

export interface PatientFollowUpOverrideRecord {
  patientId: string;
  xray: FollowUpCategoryOverrideFlags;
  mriCt: FollowUpCategoryOverrideFlags;
  specialist: FollowUpCategoryOverrideFlags;
  createdAt: string;
  updatedAt: string;
}

export type PatientFollowUpOverrideMap = Record<string, PatientFollowUpOverrideRecord>;

const STORAGE_KEY = "casemate.patient-follow-up-overrides.v1";

function nowIso() {
  return new Date().toISOString();
}

function createDefaultFlags(): FollowUpCategoryOverrideFlags {
  return {
    patientRefused: false,
    completedPriorCare: false,
    notNeeded: false,
  };
}

function normalizeFlags(value: unknown): FollowUpCategoryOverrideFlags {
  if (!value || typeof value !== "object") {
    return createDefaultFlags();
  }
  const row = value as Partial<FollowUpCategoryOverrideFlags>;
  return {
    patientRefused: Boolean(row.patientRefused),
    completedPriorCare: Boolean(row.completedPriorCare),
    notNeeded: Boolean(row.notNeeded),
  };
}

function normalizeRecord(value: unknown): PatientFollowUpOverrideRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<PatientFollowUpOverrideRecord>;
  const patientId = typeof row.patientId === "string" ? row.patientId.trim() : "";
  if (!patientId) {
    return null;
  }
  return {
    patientId,
    xray: normalizeFlags(row.xray),
    mriCt: normalizeFlags(row.mriCt),
    specialist: normalizeFlags(row.specialist),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : nowIso(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
  };
}

export function createPatientFollowUpOverrideRecord(patientId: string): PatientFollowUpOverrideRecord {
  const timestamp = nowIso();
  return {
    patientId: patientId.trim(),
    xray: createDefaultFlags(),
    mriCt: createDefaultFlags(),
    specialist: createDefaultFlags(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function hasAnyFollowUpOverrideFlags(record: PatientFollowUpOverrideRecord) {
  return (
    record.xray.patientRefused ||
    record.xray.completedPriorCare ||
    record.xray.notNeeded ||
    record.mriCt.patientRefused ||
    record.mriCt.completedPriorCare ||
    record.mriCt.notNeeded ||
    record.specialist.patientRefused ||
    record.specialist.completedPriorCare ||
    record.specialist.notNeeded
  );
}

export function loadPatientFollowUpOverridesMap(): PatientFollowUpOverrideMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const map: PatientFollowUpOverrideMap = {};
    Object.entries(parsed).forEach(([patientId, value]) => {
      const normalized = normalizeRecord(value);
      if (!normalized) {
        return;
      }
      map[patientId] = normalized;
    });
    return map;
  } catch {
    return {};
  }
}

export function savePatientFollowUpOverridesMap(value: PatientFollowUpOverrideMap): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  // Use the throwing variant — callers that await must be able to detect
  // failure so the patient page can show an explicit "Save FAILED" pill
  // instead of silently losing the toggle on the next bootstrap. Fire-
  // and-forget callers should attach a logging catch handler themselves.
  return import("@/lib/kv-cloud").then((m) => m.dualWriteKvOrThrow(STORAGE_KEY, "billing", value));
}

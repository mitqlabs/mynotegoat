export type CaseStatus =
  | "Active"
  | "Discharged"
  | "Ready To Submit"
  | "Submitted"
  | "Dropped"
  | "Paid";

export type PatientPriority = "Normal" | "MRI Due" | "No Recent Update";

export type PatientMatrixField =
  | "contact"
  | "initialExam"
  | "lien"
  | "priorCare"
  | "xraySent"
  | "xrayDone"
  | "xrayReceived"
  | "xrayReviewed"
  | "xrayFindings"
  | "reExam1"
  | "mriSent"
  | "mriScheduled"
  | "mriDone"
  | "mriReceived"
  | "mriReviewed"
  | "mriCtFindings"
  | "specialistSent"
  | "specialistScheduled"
  | "specialistReport"
  | "specialistRecommendations"
  | "reExam2"
  | "reExam3"
  | "discharge"
  | "rbSent"
  | "billed"
  | "initialToDischarge"
  | "dischargeToRb"
  | "paidDate"
  | "rbToPaid"
  | "paidAmount"
  | "billPercent"
  | "notes"
  | "review";

export interface PatientRecord {
  id: string;
  fullName: string;
  dob: string;
  sex?: "Male" | "Female" | "Other";
  maritalStatus?: "Single" | "Married" | "Divorced" | "Widowed" | "Other";
  phone: string;
  email?: string;
  address?: string;
  attorney: string;
  caseStatus: CaseStatus;
  dateOfLoss: string;
  lastUpdate: string;
  priority: PatientPriority;
  matrix?: Partial<Record<PatientMatrixField, string>>;
  relatedCases?: { patientId: string; fullName: string; dateOfLoss: string }[];
  xrayReferrals?: unknown[];
  mriReferrals?: unknown[];
  specialistReferrals?: unknown[];
  alerts?: string[];
  /** Soft-delete flag — patient is hidden but recoverable */
  deleted?: boolean;
  /** ISO timestamp of when the patient was soft-deleted */
  deletedAt?: string;
}

export interface AppointmentRecord {
  id: string;
  patientId: string;
  patientName: string;
  provider: string;
  appointmentType: string;
  start: string;
  durationMin: number;
  status: "Scheduled" | "Checked In" | "Seen";
  color: "blue" | "pink" | "orange";
}

export interface EncounterRecord {
  id: string;
  patientId: string;
  patientName: string;
  encounterDate: string;
  provider: string;
  appointmentType: string;
  signed: boolean;
  diagnosesCount: number;
  chargesCount: number;
}

/** Fixed top-level contact categories. These are non-negotiable — every
 *  contact must be exactly one of these. Users can attach an optional
 *  subCategory (e.g. "Pain Management" under "Specialist") which they
 *  manage in Settings → Contact Categories. */
export type ContactCategory = "Attorney" | "Imaging Center" | "Specialist";

export const CONTACT_CATEGORIES: ContactCategory[] = [
  "Attorney",
  "Imaging Center",
  "Specialist",
];

export interface ContactRecord {
  id: string;
  name: string;
  category: ContactCategory;
  /** Optional user-defined sub-category (e.g. "Orthopedic" under Specialist). */
  subCategory?: string;
  phone: string;
  email: string;
  fax?: string;
  address?: string;
}

export interface ChargeRecord {
  id: string;
  encounterDate: string;
  patientName: string;
  procedureCode: string;
  description: string;
  units: number;
  billed: number;
  paid: number;
}

export interface ImagingEventRecord {
  id: string;
  patientId: string;
  facility: string;
  type: "X-Ray" | "MRI";
  quantity?: number;
}

export interface CaseTimelineMetricRecord {
  patientId: string;
  initialToDischargeDays?: number;
  dischargeToRbDays?: number;
  rbToPaidDays?: number;
}

export const dashboardStats = [
  { label: "Total Active Cases", value: "0" },
  { label: "Ready To Submit", value: "0" },
  { label: "Today Appointments", value: "0" },
  { label: "Avg Days Initial To Discharge", value: "0.0" },
];

const seedPatients: PatientRecord[] = [];

export const PATIENTS_STORAGE_KEY = "casemate.patients.v2";

const matrixFieldList: PatientMatrixField[] = [
  "contact",
  "initialExam",
  "lien",
  "priorCare",
  "xraySent",
  "xrayDone",
  "xrayReceived",
  "xrayReviewed",
  "xrayFindings",
  "reExam1",
  "mriSent",
  "mriScheduled",
  "mriDone",
  "mriReceived",
  "mriReviewed",
  "mriCtFindings",
  "specialistSent",
  "specialistScheduled",
  "specialistReport",
  "specialistRecommendations",
  "reExam2",
  "reExam3",
  "discharge",
  "rbSent",
  "billed",
  "initialToDischarge",
  "dischargeToRb",
  "paidDate",
  "rbToPaid",
  "paidAmount",
  "billPercent",
  "notes",
  "review",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return "";
}

function toIsoDate(value: unknown) {
  const raw = cleanString(value);
  if (!raw) {
    return "";
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }
  return "";
}

function normalizeCaseStatus(value: unknown): CaseStatus {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "discharged") {
    return "Discharged";
  }
  if (normalized === "ready to submit" || normalized === "readytosubmit") {
    return "Ready To Submit";
  }
  if (normalized === "submitted") {
    return "Submitted";
  }
  if (normalized === "dropped") {
    return "Dropped";
  }
  if (normalized === "paid") {
    return "Paid";
  }
  return "Active";
}

function normalizePriority(value: unknown): PatientPriority {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "mri due") {
    return "MRI Due";
  }
  if (normalized === "no recent update") {
    return "No Recent Update";
  }
  return "Normal";
}

function normalizeSex(value: unknown): PatientRecord["sex"] | undefined {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "male") {
    return "Male";
  }
  if (normalized === "female") {
    return "Female";
  }
  if (normalized === "other") {
    return "Other";
  }
  return undefined;
}

function normalizeMaritalStatus(value: unknown): PatientRecord["maritalStatus"] | undefined {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "single") return "Single";
  if (normalized === "married") return "Married";
  if (normalized === "divorced") return "Divorced";
  if (normalized === "widowed") return "Widowed";
  if (normalized === "other") return "Other";
  return undefined;
}

function normalizeMatrix(rawValue: unknown): Partial<Record<PatientMatrixField, string>> | undefined {
  if (!isRecord(rawValue)) {
    return undefined;
  }

  const matrix: Partial<Record<PatientMatrixField, string>> = {};
  matrixFieldList.forEach((field) => {
    const value = cleanString(rawValue[field]);
    if (!value) {
      return;
    }
    matrix[field] = value;
  });

  return Object.keys(matrix).length > 0 ? matrix : undefined;
}

function normalizePatientRecord(value: unknown, index: number): PatientRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const firstName = cleanString(value.firstName);
  const lastName = cleanString(value.lastName);
  const composedName = [lastName, firstName].filter(Boolean).join(", ");
  const fullName = cleanString(value.fullName) || cleanString(value.patientName) || cleanString(value.name) || composedName;
  if (!fullName) {
    return null;
  }

  const fallbackDate = new Date().toISOString().slice(0, 10);
  const dateOfLoss = toIsoDate(value.dateOfLoss) || toIsoDate(value.dateOfInjury) || fallbackDate;
  const lastUpdate = toIsoDate(value.lastUpdate) || toIsoDate(value.updatedAt) || dateOfLoss;
  const id = cleanString(value.id) || cleanString(value.patientId) || `PT-IMP-${String(index + 1).padStart(4, "0")}`;

  return {
    id,
    fullName,
    dob: toIsoDate(value.dob) || toIsoDate(value.dateOfBirth),
    sex: normalizeSex(value.sex),
    maritalStatus: normalizeMaritalStatus(value.maritalStatus),
    phone: cleanString(value.phone) || cleanString(value.phoneNumber) || "-",
    email: cleanString(value.email),
    address: cleanString(value.address),
    attorney: cleanString(value.attorney) || cleanString(value.attorneyName) || "Self",
    caseStatus: normalizeCaseStatus(value.caseStatus ?? value.status),
    dateOfLoss,
    lastUpdate,
    priority: normalizePriority(value.priority),
    matrix: normalizeMatrix(value.matrix),
    relatedCases: Array.isArray(value.relatedCases) ? value.relatedCases : undefined,
    xrayReferrals: Array.isArray(value.xrayReferrals) ? value.xrayReferrals : undefined,
    mriReferrals: Array.isArray(value.mriReferrals) ? value.mriReferrals : undefined,
    specialistReferrals: Array.isArray(value.specialistReferrals) ? value.specialistReferrals : undefined,
  };
}

function loadPatientsFromStorage(): PatientRecord[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PATIENTS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    const candidateRows = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.patients)
        ? parsed.patients
        : null;

    if (!candidateRows) {
      return null;
    }

    return candidateRows
      .map((entry, index) => normalizePatientRecord(entry, index))
      .filter((entry): entry is PatientRecord => Boolean(entry));
  } catch {
    return null;
  }
}

function loadPatients(): PatientRecord[] {
  const stored = loadPatientsFromStorage();
  if (stored !== null) {
    return stored;
  }
  return [];
}

export const patients: PatientRecord[] = loadPatients();

export const contacts: ContactRecord[] = [];

export const appointments: AppointmentRecord[] = [];

export const encounters: EncounterRecord[] = [];

export const charges: ChargeRecord[] = [];

export const imagingEvents: ImagingEventRecord[] = [];

export const caseTimelineMetrics: CaseTimelineMetricRecord[] = [];

export const soapMacroButtons = {
  subjective: ["Headaches", "Cervical", "Thoracic", "Lumbar", "Pain Scale"],
  objective: ["MVC HX", "Vitals", "Cervical", "Lumbar/Hip", "Gap In Care"],
  assessment: ["Improving", "Plateau", "Needs MRI", "Needs Specialist"],
  plan: ["CMT 1-2", "EMS", "Re-Exam 2 Weeks", "Referral to Specialist"],
};

export const statusOptions: CaseStatus[] = [
  "Active",
  "Discharged",
  "Ready To Submit",
  "Submitted",
  "Dropped",
  "Paid",
];

export function getPatientById(patientId: string) {
  return patients.find((patient) => patient.id === patientId);
}

export function getEncountersByPatientId(patientId: string) {
  return encounters.filter((encounter) => encounter.patientId === patientId);
}

function persistPatients(nextPatients: PatientRecord[]) {
  const previousById = new Map(patients.map((entry) => [entry.id, entry]));
  patients.splice(0, patients.length, ...nextPatients);
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PATIENTS_STORAGE_KEY, JSON.stringify(nextPatients));

  // Phase-1 cloud-as-truth dual-write. Only fires when the `patients` feature
  // flag is on. Diff-based: only changed rows get upserted, vanished rows get
  // deleted. The dual-write reports its own per-op failures via
  // reportCloudWriteError. The `.catch` here routes any error that ESCAPED
  // the dual-write's internal reporting (e.g. a module import failing before
  // the helper even runs) into the same reporter so the user still sees the
  // red pill — no silent swallowing.
  dualWritePatientsToCloud(nextPatients, previousById).catch((err) => {
    void import("@/lib/storage-sync-interceptor").then(({ reportCloudWriteError }) => {
      reportCloudWriteError("patients dual-write (pre-run)", err);
    });
  });
}

async function dualWritePatientsToCloud(
  nextPatients: PatientRecord[],
  previousById: Map<string, PatientRecord>,
): Promise<void> {
  // Lazy-imported to avoid pulling Supabase into modules that don't need it
  // and to avoid a circular dependency between mock-data and patients-cloud.
  const [
    { isCloudEntityEnabled },
    { upsertPatientToTable, deletePatientFromTable },
    { reportCloudWriteError, reportCloudWriteStart, reportCloudWriteSuccess },
    { runBatched },
  ] = await Promise.all([
    import("@/lib/feature-flags"),
    import("@/lib/patients-cloud"),
    import("@/lib/storage-sync-interceptor"),
    import("@/lib/cloud-auth"),
  ]);
  if (!isCloudEntityEnabled("patients")) {
    return;
  }

  const nextById = new Map(nextPatients.map((entry) => [entry.id, entry]));
  // Collect task factories (thunks) so the batched runner can pace them
  // instead of firing everything simultaneously.
  const ops: Array<() => Promise<unknown>> = [];

  // Patient delta plan:
  //   - Brand-new non-deleted patient → upsert
  //   - Existing non-deleted patient that changed → upsert
  //   - Patient whose `deleted` flag just flipped to true → DELETE from cloud
  //     (the patients table has no `deleted` column, so the cloud row
  //      going away IS the soft-delete. Local still has the row marked
  //      deleted so it appears in Trash; cross-device pulls see it gone.
  //      Restore below re-upserts it.)
  //   - Patient whose `deleted` flag just flipped to false (restore) → upsert
  //   - Patient that vanished from the array entirely → delete (permanent)
  for (const patient of nextPatients) {
    const previous = previousById.get(patient.id);
    const isDeletedNow = patient.deleted === true;
    const wasDeletedBefore = previous?.deleted === true;

    if (!previous) {
      // Brand new — only sync if not already in the trash bucket.
      if (!isDeletedNow) ops.push(() => upsertPatientToTable(patient));
      continue;
    }

    if (isDeletedNow && !wasDeletedBefore) {
      // Just soft-deleted — wipe the cloud row so it doesn't resurrect on
      // next boot / next device.
      ops.push(() => deletePatientFromTable(patient.id));
      continue;
    }

    if (isDeletedNow && wasDeletedBefore) {
      // Still in trash — cloud already doesn't have a row, nothing to do.
      continue;
    }

    // Non-deleted in both states OR restore (was deleted, now not).
    if (JSON.stringify(previous) !== JSON.stringify(patient)) {
      ops.push(() => upsertPatientToTable(patient));
    }
  }

  // Patients that vanished from the array entirely (permanent delete). Also
  // handles patients that were never in the array to begin with — no-op.
  for (const [previousId, previous] of previousById) {
    if (!nextById.has(previousId)) {
      // If the patient was already soft-deleted, its cloud row is already
      // gone. Still issue the delete to make permanent delete idempotent.
      void previous;
      ops.push(() => deletePatientFromTable(previousId));
    }
  }

  if (ops.length === 0) return;

  const results = await runBatched(ops, 4);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === 0) return;

  // Every op already reported itself — aggregate for any caller that wants
  // a single pass/fail signal, and re-throw so the caller knows.
  const aggregate = new Error(
    `[mock-data] ${failures.length} of ${ops.length} patient cloud op(s) failed — ` +
      `first reason: ${failures[0].reason instanceof Error ? failures[0].reason.message : String(failures[0].reason)}`,
  );
  reportCloudWriteError("patients dual-write", aggregate);
  throw aggregate;
}

/**
 * Replace the in-memory + legacy-blob patient cache with a fresh list from
 * the cloud table. Called by the bootstrap when the `patients` feature flag
 * is on. Does NOT trigger a dual-write — this is a one-way pull from the
 * authoritative source. Pauses the storage-sync interceptor for the duration
 * so the localStorage write does not get pushed to the legacy blob row.
 */
export function replacePatientsFromCloud(nextPatients: PatientRecord[]) {
  // Preserve locally-soft-deleted patients that aren't in the cloud
  // snapshot. The cloud table has no `deleted` column — a soft-delete is
  // represented as "row gone from cloud + still present in local with
  // deleted:true". Without this preservation, every page refresh would
  // wipe the Trash tab because the cloud pull wouldn't include those
  // rows. Cross-device behavior stays right too: if the user
  // permanent-deletes on another device, the row never comes back to
  // cloud, and our local trash copy is still restorable from THIS
  // device until the user empties trash here.
  const cloudIds = new Set(nextPatients.map((p) => p.id));
  const localTrash = patients.filter((p) => p.deleted === true && !cloudIds.has(p.id));
  const merged = [...nextPatients, ...localTrash];
  patients.splice(0, patients.length, ...merged);
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PATIENTS_STORAGE_KEY, JSON.stringify(merged));
}

function createPatientId() {
  return `PT-${Date.now()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type CreatePatientDraft = {
  firstName: string;
  lastName: string;
  attorney?: string;
  dob?: string;
  sex?: PatientRecord["sex"];
  maritalStatus?: PatientRecord["maritalStatus"];
  dateOfLoss: string;
  initialExam?: string;
  phone?: string;
  email?: string;
  address?: string;
  caseStatus?: CaseStatus;
  lienStatus?: string;
  priorCare?: string;
  notes?: string;
};

export function createPatientRecord(draft: CreatePatientDraft): PatientRecord | null {
  const firstName = cleanString(draft.firstName);
  const lastName = cleanString(draft.lastName);
  if (!firstName || !lastName) {
    return null;
  }

  const fullName = `${lastName}, ${firstName}`;
  const dateOfLoss = toIsoDate(draft.dateOfLoss) || getTodayIsoDate();
  const dob = toIsoDate(draft.dob);
  const matrix: Partial<Record<PatientMatrixField, string>> = {};
  const phone = cleanString(draft.phone) || "-";
  const initialExam = cleanString(draft.initialExam);
  const lienStatus = cleanString(draft.lienStatus);
  const priorCare = cleanString(draft.priorCare);
  const notes = cleanString(draft.notes);

  if (phone && phone !== "-") {
    matrix.contact = phone;
  }
  if (initialExam) {
    matrix.initialExam = initialExam;
  }
  if (lienStatus) {
    matrix.lien = lienStatus;
  }
  if (priorCare) {
    matrix.priorCare = priorCare;
  }
  if (notes) {
    matrix.notes = notes;
  }

  const nextPatient: PatientRecord = {
    id: createPatientId(),
    fullName,
    dob,
    sex: draft.sex || undefined,
    maritalStatus: draft.maritalStatus || undefined,
    phone,
    email: cleanString(draft.email),
    address: cleanString(draft.address),
    attorney: cleanString(draft.attorney) || "Self",
    caseStatus: draft.caseStatus ?? "Active",
    dateOfLoss,
    lastUpdate: getTodayIsoDate(),
    priority: "Normal",
    matrix: Object.keys(matrix).length > 0 ? matrix : undefined,
  };

  persistPatients([nextPatient, ...patients]);
  return nextPatient;
}

export type UpdatePatientRecordPatch = Partial<
  Pick<
    PatientRecord,
    "fullName" | "dob" | "sex" | "maritalStatus" | "phone" | "email" | "address" | "attorney" | "caseStatus" | "dateOfLoss" | "lastUpdate" | "priority" | "relatedCases" | "xrayReferrals" | "mriReferrals" | "specialistReferrals" | "alerts"
  > & {
    matrix: Partial<Record<PatientMatrixField, string>>;
  }
>;

export function updatePatientRecordById(patientId: string, patch: UpdatePatientRecordPatch) {
  const normalizedPatientId = cleanString(patientId);
  if (!normalizedPatientId) {
    return null;
  }

  const existingPatient = patients.find((entry) => entry.id === normalizedPatientId);
  if (!existingPatient) {
    return null;
  }

  const nextPatient: PatientRecord = {
    ...existingPatient,
    ...patch,
    matrix: patch.matrix
      ? {
          ...(existingPatient.matrix ?? {}),
          ...patch.matrix,
        }
      : existingPatient.matrix,
  };

  const nextPatients = patients.map((entry) => (entry.id === normalizedPatientId ? nextPatient : entry));
  persistPatients(nextPatients);
  return nextPatient;
}

export function deletePatientRecord(patientId: string): boolean {
  const normalizedPatientId = cleanString(patientId);
  if (!normalizedPatientId) {
    return false;
  }
  const index = patients.findIndex((entry) => entry.id === normalizedPatientId);
  if (index === -1) {
    return false;
  }
  // Soft-delete: mark as deleted instead of removing
  const nextPatients = patients.map((entry) =>
    entry.id === normalizedPatientId
      ? { ...entry, deleted: true, deletedAt: new Date().toISOString() }
      : entry,
  );
  persistPatients(nextPatients);
  return true;
}

export function restorePatientRecord(patientId: string): boolean {
  const normalizedPatientId = cleanString(patientId);
  if (!normalizedPatientId) return false;
  const patient = patients.find((entry) => entry.id === normalizedPatientId);
  if (!patient || !patient.deleted) return false;
  const nextPatients = patients.map((entry) =>
    entry.id === normalizedPatientId
      ? { ...entry, deleted: undefined, deletedAt: undefined }
      : entry,
  );
  persistPatients(nextPatients);
  return true;
}

export function permanentlyDeletePatientRecord(patientId: string): boolean {
  const normalizedPatientId = cleanString(patientId);
  if (!normalizedPatientId) return false;
  const index = patients.findIndex((entry) => entry.id === normalizedPatientId);
  if (index === -1) return false;
  const nextPatients = patients.filter((entry) => entry.id !== normalizedPatientId);
  persistPatients(nextPatients);
  return true;
}

export function getDeletedPatients(): PatientRecord[] {
  return patients.filter((p) => p.deleted === true);
}

/**
 * Sync related cases bidirectionally across all members of a group.
 * When patient A links to B and C, this ensures B also links to A+C, and C links to A+B.
 */
export function syncRelatedCasesGroup(sourcePatientId: string, relatedIds: string[]) {
  // Build the full group: source + all related
  const groupIds = new Set([sourcePatientId, ...relatedIds]);
  const patientMap = new Map(patients.map((p) => [p.id, p]));

  const nextPatients = patients.map((p) => {
    if (!groupIds.has(p.id)) {
      return p;
    }
    // This patient's related list = everyone in the group except themselves
    const related = Array.from(groupIds)
      .filter((id) => id !== p.id)
      .map((id) => {
        const other = patientMap.get(id);
        return other
          ? { patientId: other.id, fullName: other.fullName, dateOfLoss: other.dateOfLoss }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return { ...p, relatedCases: related.length > 0 ? related : undefined };
  });

  persistPatients(nextPatients);
}

/**
 * Remove a patient from a related cases group.
 * Removes the link in both directions and updates the remaining group.
 */
export function removeFromRelatedCasesGroup(sourcePatientId: string, removePatientId: string) {
  const sourcePatient = patients.find((p) => p.id === sourcePatientId);
  if (!sourcePatient) return;

  // Get current group from source (excluding the one being removed)
  const remainingRelated = (sourcePatient.relatedCases ?? [])
    .filter((entry) => entry.patientId !== removePatientId)
    .map((entry) => entry.patientId);

  // Full remaining group including source
  const remainingGroupIds = new Set([sourcePatientId, ...remainingRelated]);

  const patientMap = new Map(patients.map((p) => [p.id, p]));

  const nextPatients = patients.map((p) => {
    // The removed patient: strip source from their list
    if (p.id === removePatientId) {
      const updated = (p.relatedCases ?? []).filter((entry) => entry.patientId !== sourcePatientId);
      return { ...p, relatedCases: updated.length > 0 ? updated : undefined };
    }

    // Members of the remaining group: rebuild their list
    if (remainingGroupIds.has(p.id)) {
      const related = Array.from(remainingGroupIds)
        .filter((id) => id !== p.id)
        .map((id) => {
          const other = patientMap.get(id);
          return other
            ? { patientId: other.id, fullName: other.fullName, dateOfLoss: other.dateOfLoss }
            : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      return { ...p, relatedCases: related.length > 0 ? related : undefined };
    }

    return p;
  });

  persistPatients(nextPatients);
}

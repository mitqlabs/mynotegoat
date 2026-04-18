export interface AppointmentTypePatientTypes {
  pi: boolean;
  cash: boolean;
}

export interface AppointmentTypeConfig {
  id: string;
  name: string;
  color: string;
  durationMin: number;
  isDefault: boolean;
  /**
   * Which patient kinds this appointment type applies to. Used to filter
   * the appointment-type dropdown based on whether the selected patient
   * is Cash or PI. Any type missing this field is treated as "Both" so
   * legacy configs continue to work without a migration step.
   */
  patientTypes: AppointmentTypePatientTypes;
}

const STORAGE_KEY = "casemate.schedule-appointment-types.v1";

const bothPatientTypes: AppointmentTypePatientTypes = { pi: true, cash: true };
const piOnly: AppointmentTypePatientTypes = { pi: true, cash: false };
const cashOnly: AppointmentTypePatientTypes = { pi: false, cash: true };

const defaultAppointmentTypes: Omit<AppointmentTypeConfig, "id">[] = [
  { name: "Personal Injury Office Visit", color: "#ef7984", durationMin: 45, isDefault: true, patientTypes: piOnly },
  { name: "Personal Injury New Patient", color: "#e4e64a", durationMin: 60, isDefault: false, patientTypes: piOnly },
  { name: "Personal Injury Re-Exam", color: "#f39a1f", durationMin: 60, isDefault: false, patientTypes: piOnly },
  { name: "Personal Injury Discharge Visit", color: "#c93b1d", durationMin: 60, isDefault: false, patientTypes: piOnly },
  { name: "Spinal Decompression - C/S", color: "#73b4e4", durationMin: 30, isDefault: false, patientTypes: bothPatientTypes },
  { name: "Spinal Decompression - L/S", color: "#1f66e5", durationMin: 30, isDefault: false, patientTypes: bothPatientTypes },
  { name: "Cash New Patient", color: "#5b862b", durationMin: 50, isDefault: false, patientTypes: cashOnly },
  { name: "Cash Office Visit", color: "#84cd15", durationMin: 30, isDefault: false, patientTypes: cashOnly },
];

function normalizePatientTypes(value: unknown): AppointmentTypePatientTypes {
  if (!value || typeof value !== "object") return { pi: true, cash: true };
  const row = value as Partial<AppointmentTypePatientTypes>;
  // Default to { pi: true, cash: true } when missing (legacy configs).
  const pi = typeof row.pi === "boolean" ? row.pi : true;
  const cash = typeof row.cash === "boolean" ? row.cash : true;
  // Sanity: at least one must be true, otherwise the type is unusable.
  if (!pi && !cash) return { pi: true, cash: true };
  return { pi, cash };
}

function createTypeId(prefix = "apt-type") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return fallback;
  }
  return candidate.toLowerCase();
}

function normalizeDuration(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(5, Math.min(720, Math.round(value)));
}

function normalizeType(row: Partial<AppointmentTypeConfig>, index: number): AppointmentTypeConfig | null {
  const fallback = defaultAppointmentTypes[index % defaultAppointmentTypes.length] ?? defaultAppointmentTypes[0];
  const name = normalizeText(row.name);
  if (!name) {
    return null;
  }
  const id = normalizeText(row.id) || createTypeId();
  return {
    id,
    name,
    color: normalizeColor(row.color, fallback.color),
    durationMin: normalizeDuration(row.durationMin, fallback.durationMin),
    isDefault: Boolean(row.isDefault),
    patientTypes: normalizePatientTypes(row.patientTypes),
  };
}

function ensureSingleDefault(types: AppointmentTypeConfig[]) {
  if (!types.length) {
    return types;
  }

  let hasDefault = false;
  return types.map((type, index) => {
    if (type.isDefault && !hasDefault) {
      hasDefault = true;
      return type;
    }
    if (type.isDefault && hasDefault) {
      return { ...type, isDefault: false };
    }
    if (!hasDefault && index === types.length - 1) {
      return { ...type, isDefault: true };
    }
    return type;
  });
}

export function getDefaultAppointmentTypes(): AppointmentTypeConfig[] {
  return defaultAppointmentTypes.map((type, index) => ({
    ...type,
    id: createTypeId(`default-${index + 1}`),
  }));
}

export function normalizeAppointmentTypes(value: unknown): AppointmentTypeConfig[] {
  const defaults = getDefaultAppointmentTypes();
  if (!Array.isArray(value)) {
    return defaults;
  }

  const seenNames = new Set<string>();
  const types: AppointmentTypeConfig[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const normalized = normalizeType(item as Partial<AppointmentTypeConfig>, index);
    if (!normalized) {
      return;
    }

    const key = normalized.name.toLowerCase();
    if (seenNames.has(key)) {
      return;
    }
    seenNames.add(key);
    types.push(normalized);
  });

  if (!types.length) {
    return defaults;
  }

  return ensureSingleDefault(types);
}

export function loadAppointmentTypes(): AppointmentTypeConfig[] {
  if (typeof window === "undefined") {
    return getDefaultAppointmentTypes();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultAppointmentTypes();
    }
    return normalizeAppointmentTypes(JSON.parse(raw));
  } catch {
    return getDefaultAppointmentTypes();
  }
}

export function saveAppointmentTypes(types: AppointmentTypeConfig[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ensureSingleDefault(types)));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "schedulingSettings", types));
}

/**
 * Filter appointment types to those applicable to the given patient.
 * Cash patients see only types where patientTypes.cash is true; PI
 * patients see only types where patientTypes.pi is true. Types missing
 * the flag entirely are shown to everyone (legacy-config safety).
 */
export function filterAppointmentTypesForPatient(
  types: AppointmentTypeConfig[],
  isCashPatient: boolean,
): AppointmentTypeConfig[] {
  return types.filter((type) =>
    isCashPatient ? type.patientTypes.cash : type.patientTypes.pi,
  );
}

export function formatDurationMinutes(durationMin: number) {
  const safe = Math.max(1, Math.round(durationMin));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}

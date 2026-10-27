/**
 * Compliance — an optional per-patient field (like Case Status) that tracks
 * how well a patient is following their care plan.
 *
 * Opt-in: the office turns the "Compliance column" on in Settings → Case
 * Status Categories (stored with the case-status settings in the cloud, off
 * by default). Each patient's value lives on the patient row
 * (patients.compliance), so it syncs the same way Case Status does.
 */

export const COMPLIANCE_OPTIONS = ["New Patient", "Yes", "No", "DNS ATM", "Non-Compliant"] as const;
export type ComplianceValue = (typeof COMPLIANCE_OPTIONS)[number];

/** "" = explicitly cleared (so a clear can be written to the cloud); undefined = never set. */
export type ComplianceField = ComplianceValue | "";

/** Pill colors, same idea as case-status colors. */
export const COMPLIANCE_COLORS: Record<ComplianceValue, string> = {
  "New Patient": "#0d79bf",
  Yes: "#1f9d60",
  No: "#c9423a",
  "DNS ATM": "#f0a43f",
  "Non-Compliant": "#8e3b8f",
};

/** Filter value meaning "no compliance chosen yet". */
export const COMPLIANCE_NOT_SET = "__not_set__";
export const COMPLIANCE_NOT_SET_LABEL = "Not set";

/** Accepts only the five known options (case-insensitive); anything else is "not set". */
export function normalizeCompliance(value: unknown): ComplianceValue | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  return COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === key);
}

export function complianceColor(value: string | undefined): string | null {
  const v = normalizeCompliance(value);
  return v ? COMPLIANCE_COLORS[v] : null;
}

/** Does a patient pass the Compliance filter? "ALL" passes everyone. */
export function matchesComplianceFilter(value: string | undefined, filter: string): boolean {
  if (filter === "ALL") return true;
  const v = normalizeCompliance(value);
  if (filter === COMPLIANCE_NOT_SET) return !v;
  return v === filter;
}

/** Sort rank: the option order, with "not set" last. */
export function complianceRank(value: string | undefined): number {
  const v = normalizeCompliance(value);
  return v ? COMPLIANCE_OPTIONS.indexOf(v) : COMPLIANCE_OPTIONS.length;
}

/**
 * The value to put in a save patch. Nothing is sent for a patient that never
 * had a value (so a save can never touch the column before it's used); a
 * cleared value is sent as "" so the clear reaches the cloud.
 */
export function compliancePatchValue(
  draft: string,
  saved: string | undefined,
): ComplianceField | undefined {
  const v = normalizeCompliance(draft);
  if (v) return v;
  return normalizeCompliance(saved) ? "" : undefined;
}

/**
 * Where the Compliance field is shown. `enabled` is the office-wide switch
 * (Settings); `canEditPatients` is the signed-in person's edit access to the
 * Patients area (owners and admins always; staff per their role).
 */
export function complianceAccess(enabled: boolean, canEditPatients: boolean): {
  showColumn: boolean;
  showField: boolean;
  canEdit: boolean;
} {
  return { showColumn: enabled, showField: enabled, canEdit: enabled && canEditPatients };
}

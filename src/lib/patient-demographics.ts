/**
 * Patient Demographics on Statistics: sex and age counts.
 * Same patient set as Patients by Location (the caller passes that list).
 * Deleted charts are skipped here, the same way location totals skip them.
 * Pure functions — no storage.
 */
import { ageOn } from "@/lib/age";

export interface DemographicPatient {
  sex?: string | null;
  dob?: string | null;
  deleted?: boolean;
}

export interface DemographicRow {
  key: string;
  label: string;
  count: number;
  /** Whole-number percent of the total, same rounding as Patients by Location. */
  percent: number;
}

export const SEX_LABELS = ["Male", "Female", "Not set"] as const;
export type SexLabel = (typeof SEX_LABELS)[number];

/** Male and Female stay as stored. Blank, "Other", and anything else are Not set. */
export function sexLabel(sex: string | null | undefined): SexLabel {
  const value = (sex ?? "").trim();
  if (value === "Male" || value === "Female") return value;
  return "Not set";
}

export const AGE_BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: "under18", label: "Under 18", min: 0, max: 17 },
  { key: "18-29", label: "18-29", min: 18, max: 29 },
  { key: "30-39", label: "30-39", min: 30, max: 39 },
  { key: "40-49", label: "40-49", min: 40, max: 49 },
  { key: "50-59", label: "50-59", min: 50, max: 59 },
  { key: "60-69", label: "60-69", min: 60, max: 69 },
  { key: "70+", label: "70+", min: 70, max: Number.POSITIVE_INFINITY },
];

export const NO_DOB_LABEL = "No DOB";

/** Age band as of `asOf` (defaults to today). Missing or unusable DOB is No DOB. */
export function ageBandLabel(dob: string | null | undefined, asOf?: string | Date | null): string {
  const age = ageOn(dob, asOf);
  if (age === null) return NO_DOB_LABEL;
  for (const band of AGE_BANDS) {
    if (age >= band.min && age <= band.max) return band.label;
  }
  return NO_DOB_LABEL;
}

function counted<T extends { deleted?: boolean }>(patients: T[]): T[] {
  return patients.filter((patient) => !patient.deleted);
}

function rowsFromCounts(labels: { key: string; label: string }[], counts: Map<string, number>, total: number): DemographicRow[] {
  const percent = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  return labels.map((band) => {
    const count = counts.get(band.key) ?? 0;
    return { key: band.key, label: band.label, count, percent: percent(count) };
  });
}

export function summarizeSex(patients: DemographicPatient[]): { total: number; rows: DemographicRow[] } {
  const list = counted(patients);
  const counts = new Map<string, number>(SEX_LABELS.map((label) => [label, 0]));
  for (const patient of list) {
    const label = sexLabel(patient.sex);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return {
    total: list.length,
    rows: rowsFromCounts(
      SEX_LABELS.map((label) => ({ key: label, label })),
      counts,
      list.length,
    ),
  };
}

export function summarizeAge(patients: DemographicPatient[], asOf?: string | Date | null): { total: number; rows: DemographicRow[] } {
  const list = counted(patients);
  const labels = [...AGE_BANDS.map((band) => ({ key: band.label, label: band.label })), { key: NO_DOB_LABEL, label: NO_DOB_LABEL }];
  const counts = new Map<string, number>(labels.map((band) => [band.key, 0]));
  for (const patient of list) {
    const label = ageBandLabel(patient.dob, asOf);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return { total: list.length, rows: rowsFromCounts(labels, counts, list.length) };
}

/** G.O.A.T. links here. Opening it reveals these Statistics sections. */
export const PATIENTS_BY_LOCATION_HASH = "#patients-by-location";

export const DEMOGRAPHIC_SECTIONS = {
  main: "patientDemographics",
  location: "demographicsLocation",
  sex: "demographicsSex",
  age: "demographicsAge",
} as const;

export function sectionsOpenedByLocationHash(hash: string): string[] {
  if (hash === PATIENTS_BY_LOCATION_HASH) return [DEMOGRAPHIC_SECTIONS.main, DEMOGRAPHIC_SECTIONS.location];
  return [];
}

/**
 * Compliance — an optional per-patient field (like Case Status) that tracks
 * how well a patient is following their care plan.
 *
 * Opt-in: the office turns the "Compliance column" on in Settings → Case
 * Status Categories (stored with the case-status settings in the cloud, off
 * by default). Each patient's value lives on the patient row
 * (patients.compliance), so it syncs the same way Case Status does.
 */

import { unionMerge } from "@/lib/kv-merge";

/** Default option labels. A default's stable id IS its original label, so values already saved on patients keep working. */
export const COMPLIANCE_OPTIONS = ["New Patient", "Yes", "No", "DNS ATM", "Non-Compliant"] as const;

/**
 * A patient's stored value: an option id. Defaults use their original label as the id
 * ("Yes", "DNS ATM"…); options the office adds get a generated id, so renaming an
 * option never orphans what's already saved on patients.
 */
export type ComplianceValue = string;

/** "" = explicitly cleared (so a clear can be written to the cloud); undefined = never set. */
export type ComplianceField = string;

const DEFAULT_COLORS: Record<string, string> = {
  "New Patient": "#0d79bf",
  Yes: "#1f9d60",
  No: "#c9423a",
  "DNS ATM": "#f0a43f",
  "Non-Compliant": "#8e3b8f",
};

/** Pill colors of the built-in options (kept for callers that only need the defaults). */
export const COMPLIANCE_COLORS: Record<string, string> = DEFAULT_COLORS;

/**
 * One editable option (Settings → Case Status Categories → Compliance Categories).
 * Stored in the cloud as a list of these; the boot merge (UNION_MERGE_KEYS) keeps both
 * sides per id, newest `updatedAt` wins, and a remove is a tombstone (`deleted`).
 */
export interface ComplianceOption {
  id: string;
  label: string;
  color: string;
  /** "Show" toggle: offered when picking a value / filtering. A hidden option still displays on patients that have it. */
  show: boolean;
  /** Display order. */
  sort: number;
  updatedAt: string;
  deleted?: boolean;
}

export const COMPLIANCE_OPTIONS_KEY = "casemate.compliance-options.v1";

const HEX = /^#[0-9a-fA-F]{6}$/;
const NEW_OPTION_COLORS = ["#5f75ff", "#80e74b", "#f4e526", "#0d79bf", "#1f9d60", "#f0a43f", "#c9423a"];

export function getDefaultComplianceOptions(): ComplianceOption[] {
  return COMPLIANCE_OPTIONS.map((label, i) => ({
    id: label,
    label,
    color: DEFAULT_COLORS[label],
    show: true,
    sort: i,
    updatedAt: "",
  }));
}

/**
 * Cleans a stored/cloud list. Anything missing falls back to the defaults, and a
 * built-in option that isn't in the list yet is added back (so it can never vanish
 * from a stale or partial copy). Sorted by `sort`.
 */
export function normalizeComplianceOptions(value: unknown): ComplianceOption[] {
  const defaults = getDefaultComplianceOptions();
  if (!Array.isArray(value)) return defaults;
  const seen = new Set<string>();
  const out: ComplianceOption[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<ComplianceOption>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || id.length > 100 || seen.has(id)) continue;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const def = defaults.find((d) => d.id === id);
    if (!label && !r.deleted) continue;
    seen.add(id);
    out.push({
      id,
      label: label || def?.label || id,
      color: typeof r.color === "string" && HEX.test(r.color.trim()) ? r.color.trim().toLowerCase() : (def?.color ?? NEW_OPTION_COLORS[out.length % NEW_OPTION_COLORS.length]),
      show: r.show !== false,
      sort: typeof r.sort === "number" && Number.isFinite(r.sort) ? r.sort : out.length,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      ...(r.deleted === true ? { deleted: true } : {}),
    });
  }
  if (out.length === 0) return defaults;
  for (const d of defaults) if (!seen.has(d.id)) out.push({ ...d, sort: out.length });
  return out.sort((a, b) => a.sort - b.sort);
}

/** Options that aren't removed. */
export const liveComplianceOptions = (options: ComplianceOption[]) => options.filter((o) => !o.deleted);
/** Options to offer in a picker / filter: live and switched on. */
export const shownComplianceOptions = (options: ComplianceOption[]) => options.filter((o) => !o.deleted && o.show);

export function loadComplianceOptions(): ComplianceOption[] {
  if (typeof window === "undefined") return getDefaultComplianceOptions();
  try {
    const raw = window.localStorage.getItem(COMPLIANCE_OPTIONS_KEY);
    return raw ? normalizeComplianceOptions(JSON.parse(raw)) : getDefaultComplianceOptions();
  } catch {
    return getDefaultComplianceOptions();
  }
}

export function mergeComplianceOptions(local: ComplianceOption[], cloud: unknown): ComplianceOption[] {
  return normalizeComplianceOptions(unionMerge(local, Array.isArray(cloud) ? normalizeComplianceOptions(cloud) : local));
}

/** Save locally, then merge with the cloud copy before writing it (never drops another device's edits). */
export async function saveComplianceOptions(options: ComplianceOption[]): Promise<void> {
  if (typeof window === "undefined") return;
  const clean = normalizeComplianceOptions(options);
  try {
    window.localStorage.setItem(COMPLIANCE_OPTIONS_KEY, JSON.stringify(clean));
  } catch {
    // cache only; the cloud write below is the record
  }
  const kv = await import("@/lib/kv-cloud");
  const remote = await kv.fetchKvValue<unknown>(COMPLIANCE_OPTIONS_KEY).catch(() => null);
  const merged = remote == null ? clean : mergeComplianceOptions(clean, remote);
  try {
    window.localStorage.setItem(COMPLIANCE_OPTIONS_KEY, JSON.stringify(merged));
  } catch {
    // cache only
  }
  await kv.dualWriteKv(COMPLIANCE_OPTIONS_KEY, "tasks", merged);
}

// ---- pure edits (each returns a new list with the touched option stamped `now`) ----

const clean = (label: string) => label.trim().replace(/\s+/g, " ").slice(0, 60);
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function newComplianceOptionId(now: number = Date.now(), rand: number = Math.random()): string {
  return `c-${now.toString(36)}${Math.floor(rand * 1679616).toString(36).padStart(4, "0")}`;
}

function touch(options: ComplianceOption[], id: string, patch: Partial<ComplianceOption>, now: string): ComplianceOption[] {
  return options.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now } : o));
}

/** Add (or bring back a removed option with that name). Returns the list unchanged for a blank/duplicate name. */
export function addComplianceOption(options: ComplianceOption[], label: string, color: string, now: string, id: string = newComplianceOptionId()): ComplianceOption[] {
  const name = clean(label);
  if (!name || liveComplianceOptions(options).some((o) => sameLabel(o.label, name))) return options;
  const col = HEX.test(color) ? color.toLowerCase() : NEW_OPTION_COLORS[options.length % NEW_OPTION_COLORS.length];
  const dead = options.find((o) => o.deleted && sameLabel(o.label, name));
  if (dead) return touch(options, dead.id, { deleted: undefined, show: true, color: col, sort: options.length }, now);
  return [...options, { id, label: name, color: col, show: true, sort: options.length, updatedAt: now }];
}

/** Rename keeps the id, so patients that have this option keep it. Blank/duplicate = unchanged. */
export function renameComplianceOption(options: ComplianceOption[], id: string, label: string, now: string): ComplianceOption[] {
  const name = clean(label);
  if (!name || liveComplianceOptions(options).some((o) => o.id !== id && sameLabel(o.label, name))) return options;
  return touch(options, id, { label: name }, now);
}

export const setComplianceOptionColor = (options: ComplianceOption[], id: string, color: string, now: string) =>
  HEX.test(color) ? touch(options, id, { color: color.toLowerCase() }, now) : options;

export const setComplianceOptionShown = (options: ComplianceOption[], id: string, show: boolean, now: string) =>
  touch(options, id, { show }, now);

/** Remove = tombstone (so the removal survives the cloud merge). Patient values are NOT rewritten. */
export const removeComplianceOption = (options: ComplianceOption[], id: string, now: string) =>
  touch(options, id, { deleted: true }, now);

/** Back to the five built-ins (original names/colors/order); every custom option is removed. */
export function resetComplianceOptions(options: ComplianceOption[], now: string): ComplianceOption[] {
  const defaults = getDefaultComplianceOptions().map((d) => ({ ...d, updatedAt: now }));
  const defaultIds = new Set(defaults.map((d) => d.id));
  const customs = options.filter((o) => !defaultIds.has(o.id)).map((o) => ({ ...o, deleted: true as const, updatedAt: now }));
  return [...defaults, ...customs.map((o, i) => ({ ...o, sort: defaults.length + i }))];
}

/** How many of these patient values use each option id (for the "in use" warning). */
export function complianceUsage(values: Array<string | undefined>, options: ComplianceOption[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const o = resolveComplianceOption(v, options);
    if (o) counts.set(o.id, (counts.get(o.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Cleans a stored patient value: any non-empty text is kept (it may be a custom option's
 * id); a built-in label typed in a different case is mapped to the canonical one.
 */
export function normalizeCompliance(value: unknown): ComplianceValue | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > 100) return undefined;
  const key = v.toLowerCase();
  return COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === key) ?? v;
}

/** The option a stored value refers to (by id, else by label), or undefined if not set / removed. */
export function resolveComplianceOption(value: string | undefined, options: ComplianceOption[] = getDefaultComplianceOptions()): ComplianceOption | undefined {
  const v = normalizeCompliance(value);
  if (!v) return undefined;
  const live = liveComplianceOptions(options);
  return live.find((o) => o.id === v) ?? live.find((o) => sameLabel(o.label, v));
}

/** Pill/label text for a stored value ("" when not set). */
export const complianceLabel = (value: string | undefined, options?: ComplianceOption[]) =>
  resolveComplianceOption(value, options)?.label ?? "";

export function complianceColor(value: string | undefined, options?: ComplianceOption[]): string | null {
  return resolveComplianceOption(value, options)?.color ?? null;
}

/** Filter value meaning "no compliance chosen yet". */
export const COMPLIANCE_NOT_SET = "__not_set__";
export const COMPLIANCE_NOT_SET_LABEL = "Not set";

/** Does a patient pass the Compliance filter? "ALL" passes everyone; otherwise the filter is an option id. */
export function matchesComplianceFilter(value: string | undefined, filter: string, options?: ComplianceOption[]): boolean {
  if (filter === "ALL") return true;
  const o = resolveComplianceOption(value, options);
  if (filter === COMPLIANCE_NOT_SET) return !o;
  return o?.id === filter;
}

/** Sort rank: the option order, with "not set" last. */
export function complianceRank(value: string | undefined, options: ComplianceOption[] = getDefaultComplianceOptions()): number {
  const live = liveComplianceOptions(options);
  const o = resolveComplianceOption(value, options);
  return o ? live.indexOf(o) : live.length;
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

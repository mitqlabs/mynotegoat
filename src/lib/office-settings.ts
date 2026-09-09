import { formatUsPhoneInput } from "@/lib/phone-format";
import {
  getDefaultScheduleSettings,
  type DailyOfficeHours,
} from "@/lib/schedule-settings";

/** A provider the office schedules under. May be a team member (login) or
 *  a name-only doctor added in Office Information. */
export interface OfficeDoctor {
  id: string;
  name: string;
  /** Set when this doctor is a team member; absent for a name-only doctor. */
  memberUserId?: string;
}

/** A physical office location (used when Multi-Location is on). */
export interface OfficeLocation {
  id: string;
  name: string;
  /** Short label (street / city / number) shown on pills and selectors. */
  nickname: string;
  address: string;
  phone: string;
  /** Doctor ids (OfficeDoctor.id) that work at this location. */
  doctorIds: string[];
  /** This office's weekly hours. Absent = inherit the global schedule hours. */
  officeHours?: DailyOfficeHours[];
}

function normalizeOfficeHours(value: unknown): DailyOfficeHours[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const defaults = getDefaultScheduleSettings().officeHours;
  const byDay = new Map<number, DailyOfficeHours>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<DailyOfficeHours>;
    if (typeof row.dayOfWeek !== "number") continue;
    const dayOfWeek = Math.max(0, Math.min(6, Math.round(row.dayOfWeek)));
    const fb = defaults[dayOfWeek];
    byDay.set(dayOfWeek, {
      dayOfWeek,
      enabled: typeof row.enabled === "boolean" ? row.enabled : fb.enabled,
      start: typeof row.start === "string" ? row.start : fb.start,
      end: typeof row.end === "string" ? row.end : fb.end,
    });
  }
  if (byDay.size === 0) return undefined;
  return defaults.map((fb) => byDay.get(fb.dayOfWeek) ?? fb);
}

/** The label to show for a location on pills/selectors — nickname wins. */
export function locationLabel(loc: Pick<OfficeLocation, "name" | "nickname">): string {
  return (loc.nickname || "").trim() || (loc.name || "").trim() || "Location";
}

export interface OfficeSettings {
  officeName: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  doctorName: string;
  logoDataUrl: string;
  deletePassword: string;
  /** When on, the office runs multiple locations, each with its own schedule. */
  multiLocation: boolean;
  locations: OfficeLocation[];
  /** All providers the office schedules under (name-only + team-member doctors). */
  doctors: OfficeDoctor[];
}

const STORAGE_KEY = "casemate.office-settings.v1";
export const STORAGE_KEY_OFFICE_SETTINGS = STORAGE_KEY;

// NOTE: these defaults MUST be completely empty strings, not real
// office information. Every brand-new user starts with a truly blank
// slate and is walked through filling in their own office info via
// the onboarding flow. Hardcoding anyone's real office name/phone/
// address/doctor here would leak across tenants on any path that
// falls through to defaults (new browser, fresh signup, post-wipe
// empty localStorage, etc.). This was an active cross-tenant PII
// leak incident reported on 2026-04-17 — do not re-introduce.
const defaultOfficeSettings: OfficeSettings = {
  officeName: "",
  phone: "",
  fax: "",
  email: "",
  address: "",
  doctorName: "",
  logoDataUrl: "",
  deletePassword: "",
  multiLocation: false,
  locations: [],
  doctors: [],
};

function normalizeDoctors(value: unknown): OfficeDoctor[] {
  if (!Array.isArray(value)) return [];
  const out: OfficeDoctor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = normalizeString(row.name);
    const id = normalizeString(row.id);
    if (!name || !id) continue;
    const doctor: OfficeDoctor = { id, name };
    const memberUserId = normalizeString(row.memberUserId);
    if (memberUserId) doctor.memberUserId = memberUserId;
    out.push(doctor);
  }
  return out;
}

function normalizeLocations(value: unknown): OfficeLocation[] {
  if (!Array.isArray(value)) return [];
  const out: OfficeLocation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = normalizeString(row.id);
    const name = normalizeString(row.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      nickname: normalizeString(row.nickname),
      address: normalizeString(row.address),
      phone: formatUsPhoneInput(normalizeString(row.phone)),
      doctorIds: Array.isArray(row.doctorIds)
        ? row.doctorIds.filter((x): x is string => typeof x === "string")
        : [],
      officeHours: normalizeOfficeHours(row.officeHours),
    });
  }
  return out;
}

function normalizeString(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeLogoDataUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const next = value.trim();
  if (!next) {
    return "";
  }
  if (next.startsWith("data:image/")) {
    return next;
  }
  return "";
}

export function getDefaultOfficeSettings() {
  return { ...defaultOfficeSettings };
}

export function normalizeOfficeSettings(value: unknown): OfficeSettings {
  if (!value || typeof value !== "object") {
    return getDefaultOfficeSettings();
  }
  const row = value as Partial<OfficeSettings>;
  return {
    officeName: normalizeString(row.officeName, defaultOfficeSettings.officeName),
    phone: formatUsPhoneInput(normalizeString(row.phone, defaultOfficeSettings.phone)),
    fax: formatUsPhoneInput(normalizeString(row.fax, defaultOfficeSettings.fax)),
    email: normalizeString(row.email, defaultOfficeSettings.email),
    address: normalizeString(row.address, defaultOfficeSettings.address),
    doctorName: normalizeString(row.doctorName, defaultOfficeSettings.doctorName),
    logoDataUrl: normalizeLogoDataUrl(row.logoDataUrl),
    deletePassword: normalizeString(row.deletePassword),
    multiLocation: row.multiLocation === true,
    locations: normalizeLocations(row.locations),
    doctors: normalizeDoctors(row.doctors),
  };
}

export function loadOfficeSettings(): OfficeSettings {
  if (typeof window === "undefined") {
    return getDefaultOfficeSettings();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultOfficeSettings();
    }
    return normalizeOfficeSettings(JSON.parse(raw));
  } catch {
    return getDefaultOfficeSettings();
  }
}

export function saveOfficeSettings(settings: OfficeSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

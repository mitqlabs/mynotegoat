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
  /** Short distinguishing label (Hulen, Saginaw…) — the practice name lives
   *  once in OfficeSettings.officeName; this is what tells offices apart. */
  nickname: string;
  /** Composed one-line address (for display / back-compat). */
  address: string;
  /** Structured address parts — the editable source of truth (no parsing). */
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
  email: string;
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
    const hasSecond =
      typeof row.start2 === "string" && row.start2 && typeof row.end2 === "string" && row.end2;
    byDay.set(dayOfWeek, {
      dayOfWeek,
      enabled: typeof row.enabled === "boolean" ? row.enabled : fb.enabled,
      start: typeof row.start === "string" ? row.start : fb.start,
      end: typeof row.end === "string" ? row.end : fb.end,
      ...(hasSecond ? { start2: row.start2 as string, end2: row.end2 as string } : {}),
    });
  }
  if (byDay.size === 0) return undefined;
  return defaults.map((fb) => byDay.get(fb.dayOfWeek) ?? fb);
}

/** The label to show for a location on pills/selectors — nickname wins. */
export function locationLabel(loc: Pick<OfficeLocation, "name" | "nickname">): string {
  return (loc.nickname || "").trim() || (loc.name || "").trim() || "Location";
}

/** One-line address composed from the structured parts (for display). */
export function composeLocationAddress(
  loc: Pick<OfficeLocation, "addr1" | "addr2" | "city" | "state" | "zip" | "address">,
): string {
  const lines = [loc.addr1, loc.addr2].map((s) => (s || "").trim()).filter(Boolean);
  const cityStateZip = [
    (loc.city || "").trim(),
    [(loc.state || "").trim(), (loc.zip || "").trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const composed = [...lines, cityStateZip].filter(Boolean).join(", ");
  return composed || (loc.address || "").trim();
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
  /** When this copy was last edited (ms). Used to pick the newer of the
   *  local and cloud copies; absent on copies saved before it existed. */
  savedAt?: number;
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
    // Offices added in Settings carry only a nickname (name ""). Dropping
    // nameless rows here made every reload lose them, and the "seed a first
    // office" step then saved a lone office over the cloud copy.
    if (!id) continue;
    const nickname = normalizeString(row.nickname);
    const name = normalizeString(row.name) || nickname;
    out.push({
      id,
      name,
      nickname,
      address: normalizeString(row.address),
      addr1: normalizeString(row.addr1),
      addr2: normalizeString(row.addr2),
      city: normalizeString(row.city),
      state: normalizeString(row.state),
      zip: normalizeString(row.zip),
      phone: formatUsPhoneInput(normalizeString(row.phone)),
      fax: formatUsPhoneInput(normalizeString(row.fax)),
      email: normalizeString(row.email),
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
    ...(typeof row.savedAt === "number" && Number.isFinite(row.savedAt) ? { savedAt: row.savedAt } : {}),
  };
}

/**
 * Decide whether the local or the cloud copy of office settings should win
 * on load. Newer `savedAt` wins. For older copies without `savedAt`, local
 * wins only when it has offices the cloud lacks (compared by id, so the
 * logo, which is most of the bytes, can't decide it). Otherwise cloud wins.
 */
export function pickOfficeSettingsSource(localValue: unknown, cloudValue: unknown): "local" | "cloud" {
  if (!localValue || typeof localValue !== "object") return "cloud";
  if (!cloudValue || typeof cloudValue !== "object") return "local";
  const local = normalizeOfficeSettings(localValue);
  const cloud = normalizeOfficeSettings(cloudValue);
  if (typeof local.savedAt === "number" && typeof cloud.savedAt === "number") {
    return local.savedAt > cloud.savedAt ? "local" : "cloud";
  }
  if (typeof local.savedAt === "number" && typeof cloud.savedAt !== "number") {
    // Local was edited with the new code; cloud is a legacy copy.
    return "local";
  }
  if (typeof cloud.savedAt === "number") return "cloud";
  const cloudIds = new Set(cloud.locations.map((l) => l.id));
  const localHasMissing = local.locations.some((l) => !cloudIds.has(l.id));
  return localHasMissing && local.locations.length > cloud.locations.length ? "local" : "cloud";
}

/** True when every office id in `local` is present in `cloud`. */
export function cloudHasAllOffices(local: OfficeSettings, cloudValue: unknown): boolean {
  const cloud = normalizeOfficeSettings(cloudValue);
  const ids = new Set(cloud.locations.map((l) => l.id));
  return local.locations.every((l) => ids.has(l.id));
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

/** Fast synchronous local write — safe to call on every keystroke. */
export function writeOfficeSettingsLocal(settings: OfficeSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    // Storage full (a big logo can do it). The cloud save still runs.
    console.warn("[office-settings] local write failed:", err);
  }
}

/** Heavier cloud dual-write — debounce this; don't call it per keystroke. */
export function pushOfficeSettingsCloud(settings: OfficeSettings) {
  if (typeof window === "undefined") return;
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

export function saveOfficeSettings(settings: OfficeSettings) {
  writeOfficeSettingsLocal(settings);
  pushOfficeSettingsCloud(settings);
}

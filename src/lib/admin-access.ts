"use client";

/**
 * Admin Access — who can do what.
 *
 * Roles:
 *   owner   the initial account. Identical to admin, except ONLY the owner
 *           can add or remove admins.
 *   admin   everything: every section, Settings, Team, all deletes.
 *   manager configurable here: which Dashboard sections they see, and which
 *           deletes they may perform (optionally behind the delete password).
 *   staff   per-section access only; never deletes.
 *
 * Honest limitation: these checks run in the app, so they stop mistakes and
 * casual snooping, not a determined technical user. Enforcing roles in the
 * database (RLS) is the airtight version and is a separate piece of work.
 */

export type RoleTier = "owner" | "admin" | "manager" | "staff";

export const DELETABLE_KINDS = [
  { key: "patients", label: "Patients" },
  { key: "files", label: "Files" },
  { key: "notes", label: "Encounter notes" },
  { key: "appointments", label: "Appointments" },
  { key: "tasks", label: "To-dos & tasks" },
] as const;

export type DeletableKind = (typeof DELETABLE_KINDS)[number]["key"];

/** What a manager may do for one kind of delete. */
export type DeleteRule = "never" | "password" | "allowed";

export const MANAGER_DASHBOARD_SECTIONS = [
  { key: "weeklySummary", label: "Weekly Summary" },
  { key: "reviews", label: "Reviews" },
  { key: "activityLog", label: "Activity Log" },
  { key: "statistics", label: "Statistics (business numbers)" },
] as const;

export type ManagerDashboardSection = (typeof MANAGER_DASHBOARD_SECTIONS)[number]["key"];

export interface AdminAccessSettings {
  /** Dashboard sections a manager can see. */
  managerDashboard: Record<ManagerDashboardSection, boolean>;
  /** Per-kind delete rules for managers. */
  managerDeletes: Record<DeletableKind, DeleteRule>;
  /** Admins are asked for the delete password too when true. */
  passwordAppliesToAdmins: boolean;
  /** SHA-256 of salt + password. Empty = no password set yet. */
  deletePasswordHash: string;
  deletePasswordSalt: string;
}

export const ADMIN_ACCESS_KEY = "casemate.admin-access.v1";

export function defaultAdminAccess(): AdminAccessSettings {
  return {
    // Managers run the office day to day; the business numbers stay private.
    managerDashboard: {
      weeklySummary: true,
      reviews: true,
      activityLog: false,
      statistics: false,
    },
    managerDeletes: {
      patients: "password",
      files: "password",
      notes: "never",
      appointments: "never",
      tasks: "allowed",
    },
    passwordAppliesToAdmins: false,
    deletePasswordHash: "",
    deletePasswordSalt: "",
  };
}

export function normalizeAdminAccess(value: unknown): AdminAccessSettings {
  const base = defaultAdminAccess();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;
  const dash = (raw.managerDashboard ?? {}) as Record<string, unknown>;
  const dels = (raw.managerDeletes ?? {}) as Record<string, unknown>;
  for (const section of MANAGER_DASHBOARD_SECTIONS) {
    if (typeof dash[section.key] === "boolean") base.managerDashboard[section.key] = dash[section.key] as boolean;
  }
  for (const kind of DELETABLE_KINDS) {
    const rule = dels[kind.key];
    if (rule === "never" || rule === "password" || rule === "allowed") base.managerDeletes[kind.key] = rule;
  }
  if (typeof raw.passwordAppliesToAdmins === "boolean") base.passwordAppliesToAdmins = raw.passwordAppliesToAdmins;
  if (typeof raw.deletePasswordHash === "string") base.deletePasswordHash = raw.deletePasswordHash;
  if (typeof raw.deletePasswordSalt === "string") base.deletePasswordSalt = raw.deletePasswordSalt;
  return base;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash a new delete password. Returns the salt + hash to store. */
export async function hashDeletePassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { salt, hash: await sha256Hex(`${salt}:${password}`) };
}

export async function verifyDeletePassword(
  settings: AdminAccessSettings,
  attempt: string,
): Promise<boolean> {
  if (!settings.deletePasswordHash) return false;
  return (await sha256Hex(`${settings.deletePasswordSalt}:${attempt}`)) === settings.deletePasswordHash;
}

/** The role tier for a membership. Owners and non-members are "owner". */
export function roleTierOf(membership: {
  isMember: boolean;
  officeAdmin: boolean;
  permissions?: { roleTier?: string };
} | null): RoleTier {
  if (!membership || !membership.isMember) return "owner";
  const stored = membership.permissions?.roleTier;
  if (stored === "admin" || stored === "manager" || stored === "staff") return stored;
  // Before roles existed, "office admin" was the only elevated flag.
  return membership.officeAdmin ? "admin" : "staff";
}

export function isAdminTier(tier: RoleTier): boolean {
  return tier === "owner" || tier === "admin";
}

/** How this role may delete `kind`: "allowed", "password" or "never". */
export function deleteRuleFor(
  tier: RoleTier,
  kind: DeletableKind,
  settings: AdminAccessSettings,
): DeleteRule {
  if (isAdminTier(tier)) return settings.passwordAppliesToAdmins ? "password" : "allowed";
  if (tier === "manager") return settings.managerDeletes[kind];
  return "never";
}

/** Can this role open the given Dashboard section? */
export function canSeeDashboardSection(
  tier: RoleTier,
  section: ManagerDashboardSection,
  settings: AdminAccessSettings,
): boolean {
  if (isAdminTier(tier)) return true;
  if (tier === "manager") return settings.managerDashboard[section];
  return false;
}

"use client";

/**
 * Admin Access — who can do what.
 *
 * Roles:
 *   owner   the account the office was created under. Not a role anyone is
 *           given: the system just recognises the first account. Identical
 *           to admin in every way except that only the owner can make
 *           someone an admin (or take it away).
 *   admin   everything: every page, Settings, Team, all deletes.
 *   manager runs the office. Pages and deletes are set on this page;
 *           Statistics (the business numbers) is admin-only, always.
 *   staff   the day-to-day pages; deletes are off by default.
 *
 * Honest limitation: these checks run in the app, so they stop mistakes and
 * casual snooping, not a determined technical user. Enforcing roles in the
 * database (RLS) is the airtight version and is a separate piece of work.
 */

import type { PortalFeature } from "@/lib/plan-access";
import type { AccessLevel } from "@/lib/team-permissions";

export type RoleTier = "owner" | "admin" | "manager" | "staff";

/** The roles whose access is configurable here (admins always have it all). */
export type ConfigurableRole = "manager" | "staff";

export const CONFIGURABLE_ROLES: { key: ConfigurableRole; label: string }[] = [
  { key: "manager", label: "Manager" },
  { key: "staff", label: "Staff" },
];

export const DELETABLE_KINDS = [
  { key: "patients", label: "Patients" },
  { key: "files", label: "Files" },
  { key: "notes", label: "Encounters" },
  { key: "appointments", label: "Appointments" },
  { key: "keyDates", label: "Key dates" },
  { key: "contacts", label: "Contacts" },
  { key: "marketing", label: "Marketing events" },
  { key: "messages", label: "Message threads" },
  { key: "tasks", label: "To-dos & tasks" },
] as const;

export type DeletableKind = (typeof DELETABLE_KINDS)[number]["key"];

/** What a role may do for one kind of delete. */
export type DeleteRule = "never" | "password" | "allowed";

/** Pages whose access is set per role. Settings is admin-only, never here. */
export const ROLE_PAGES: { feature: PortalFeature; label: string }[] = [
  { feature: "patients", label: "Patients" },
  { feature: "statistics", label: "Dashboard" },
  { feature: "contacts", label: "Contacts" },
  { feature: "appointments", label: "Schedule" },
  { feature: "encounters", label: "Encounters" },
  { feature: "keyDates", label: "Key Dates" },
  { feature: "myFiles", label: "My Files" },
  { feature: "billing", label: "Billing" },
  { feature: "timers", label: "Timers" },
  { feature: "marketing", label: "Marketing" },
  { feature: "messages", label: "Messages" },
];

/** Dashboard sections a manager can be given. Statistics is never here. */
export const MANAGER_DASHBOARD_SECTIONS = [
  { key: "weeklySummary", label: "Weekly Summary" },
  { key: "reviews", label: "Reviews" },
  { key: "activityLog", label: "Activity Log" },
] as const;

export type ManagerDashboardSection = (typeof MANAGER_DASHBOARD_SECTIONS)[number]["key"];
/** Every Dashboard section, including the admin-only one. */
export type DashboardSection = ManagerDashboardSection | "statistics";

export interface AdminAccessSettings {
  /** Dashboard sections a manager can see. */
  managerDashboard: Record<ManagerDashboardSection, boolean>;
  /** Page access per role. */
  rolePages: Record<ConfigurableRole, Partial<Record<PortalFeature, AccessLevel>>>;
  /** Per-kind delete rules per role. */
  roleDeletes: Record<ConfigurableRole, Record<DeletableKind, DeleteRule>>;
  /** Admins are asked for the delete password too when true. */
  passwordAppliesToAdmins: boolean;
  /** SHA-256 of salt + password. Empty = fall back to the office password. */
  deletePasswordHash: string;
  deletePasswordSalt: string;
}

export const ADMIN_ACCESS_KEY = "casemate.admin-access.v1";

export function defaultAdminAccess(): AdminAccessSettings {
  return {
    // Managers run the office; the business numbers stay admin-only.
    managerDashboard: {
      weeklySummary: true,
      reviews: true,
      activityLog: true,
    },
    rolePages: {
      manager: {
        patients: "edit",
        statistics: "view",
        contacts: "edit",
        appointments: "edit",
        encounters: "edit",
        keyDates: "edit",
        myFiles: "edit",
        billing: "none",
        timers: "edit",
        marketing: "edit",
        messages: "edit",
      },
      staff: {
        patients: "edit",
        statistics: "none",
        contacts: "edit",
        appointments: "edit",
        encounters: "edit",
        keyDates: "edit",
        myFiles: "edit",
        billing: "none",
        timers: "edit",
        marketing: "none",
        messages: "edit",
      },
    },
    roleDeletes: {
      manager: {
        patients: "password",
        files: "never",
        notes: "allowed",
        appointments: "allowed",
        keyDates: "allowed",
        contacts: "never",
        marketing: "never",
        messages: "allowed",
        tasks: "allowed",
      },
      staff: {
        patients: "never",
        files: "never",
        notes: "never",
        appointments: "never",
        keyDates: "never",
        contacts: "never",
        marketing: "never",
        messages: "never",
        tasks: "allowed",
      },
    },
    passwordAppliesToAdmins: false,
    deletePasswordHash: "",
    deletePasswordSalt: "",
  };
}

function isAccessLevel(value: unknown): value is AccessLevel {
  return value === "none" || value === "view" || value === "edit";
}

export function normalizeAdminAccess(value: unknown): AdminAccessSettings {
  const base = defaultAdminAccess();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;

  const dash = (raw.managerDashboard ?? {}) as Record<string, unknown>;
  for (const section of MANAGER_DASHBOARD_SECTIONS) {
    if (typeof dash[section.key] === "boolean") base.managerDashboard[section.key] = dash[section.key] as boolean;
  }

  const pages = (raw.rolePages ?? {}) as Record<string, unknown>;
  for (const role of CONFIGURABLE_ROLES) {
    const stored = (pages[role.key] ?? {}) as Record<string, unknown>;
    for (const page of ROLE_PAGES) {
      const level = stored[page.feature];
      if (isAccessLevel(level)) base.rolePages[role.key][page.feature] = level;
    }
  }

  const deletes = (raw.roleDeletes ?? {}) as Record<string, unknown>;
  for (const role of CONFIGURABLE_ROLES) {
    const stored = (deletes[role.key] ?? {}) as Record<string, unknown>;
    for (const kind of DELETABLE_KINDS) {
      const rule = stored[kind.key];
      if (rule === "never" || rule === "password" || rule === "allowed") {
        base.roleDeletes[role.key][kind.key] = rule;
      }
    }
  }
  // The first version of this page stored one manager-only delete map.
  const legacyDeletes = (raw.managerDeletes ?? {}) as Record<string, unknown>;
  for (const kind of DELETABLE_KINDS) {
    const rule = legacyDeletes[kind.key];
    if (rule === "never" || rule === "password" || rule === "allowed") {
      base.roleDeletes.manager[kind.key] = rule;
    }
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

/** Page access for a role: admins get everything, others get the matrix. */
export function pageAccessFor(
  tier: RoleTier,
  feature: PortalFeature,
  settings: AdminAccessSettings,
): AccessLevel {
  if (isAdminTier(tier)) return "edit";
  // Settings is admin-only and not configurable.
  if (feature === "settings") return "none";
  if (tier !== "manager" && tier !== "staff") return "none";
  return settings.rolePages[tier][feature] ?? "none";
}

/** How this role may delete `kind`: "allowed", "password" or "never". */
export function deleteRuleFor(
  tier: RoleTier,
  kind: DeletableKind,
  settings: AdminAccessSettings,
): DeleteRule {
  if (isAdminTier(tier)) return settings.passwordAppliesToAdmins ? "password" : "allowed";
  if (tier !== "manager" && tier !== "staff") return "never";
  return settings.roleDeletes[tier][kind];
}

/** Can this role open the given Dashboard section? */
export function canSeeDashboardSection(
  tier: RoleTier,
  section: DashboardSection,
  settings: AdminAccessSettings,
): boolean {
  if (isAdminTier(tier)) return true;
  // The business numbers are for admins only, whatever else is switched on.
  if (section === "statistics") return false;
  if (tier === "manager") return settings.managerDashboard[section];
  return false;
}

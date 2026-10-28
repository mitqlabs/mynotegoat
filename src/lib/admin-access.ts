"use client";

/**
 * Roles & Permissions (formerly Admin Access) — who can do what.
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
 * Settings → Roles & Permissions edits all of this. The role definitions
 * (pages, actions, deletes, dashboard sections) live in their OWN cloud row
 * (ROLE_SETTINGS_KEY) so the database can lock who may change them; the delete
 * password stays in ADMIN_ACCESS_KEY, which Admins may keep editing.
 *
 * Honest limitation: what each role may DO with office data is checked in the
 * app, so it stops mistakes and casual snooping, not a determined technical
 * user (every member can read and write the office's data rows in the
 * database). What IS enforced in the database is who may change the role
 * definitions themselves — see the role-settings migration.
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

/**
 * One-off actions inside a page that a role can be given or denied
 * (separate from page access and deletes). Admins and the owner always may.
 */
export const ROLE_ACTIONS = [
  { key: "contacts.create", feature: "contacts", group: "Contacts", label: "Add contacts" },
  { key: "contacts.edit", feature: "contacts", group: "Contacts", label: "Edit contacts" },
] as const;

export type RoleActionKey = (typeof ROLE_ACTIONS)[number]["key"];

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
  { feature: "patients", label: "Patient List" },
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
  /** In-page actions (add / edit contacts…) per role. */
  roleActions: Record<ConfigurableRole, Record<RoleActionKey, boolean>>;
  /** When true, Admins may change the role definitions too. Owner-only switch; off by default. */
  adminsCanEditRoles: boolean;
  /** Admins are asked for the delete password too when true. */
  passwordAppliesToAdmins: boolean;
  /** SHA-256 of salt + password. Empty = fall back to the office password. */
  deletePasswordHash: string;
  deletePasswordSalt: string;
}

/** Delete password + "ask admins too". Admins may edit this. */
export const ADMIN_ACCESS_KEY = "casemate.admin-access.v1";
/** The role definitions. Only the owner (or Admins, if the owner allows it) may write this row. */
export const ROLE_SETTINGS_KEY = "casemate.role-settings.v1";

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
    // Everyone can add a contact; editing existing ones is for managers (and admins).
    roleActions: {
      manager: { "contacts.create": true, "contacts.edit": true },
      staff: { "contacts.create": true, "contacts.edit": false },
    },
    adminsCanEditRoles: false,
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

  const actions = (raw.roleActions ?? {}) as Record<string, unknown>;
  for (const role of CONFIGURABLE_ROLES) {
    const stored = (actions[role.key] ?? {}) as Record<string, unknown>;
    for (const action of ROLE_ACTIONS) {
      if (typeof stored[action.key] === "boolean") base.roleActions[role.key][action.key] = stored[action.key] as boolean;
    }
  }
  if (typeof raw.adminsCanEditRoles === "boolean") base.adminsCanEditRoles = raw.adminsCanEditRoles;

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

export type DeletePasswordCheck = "none" | "wrong" | "ok";

/**
 * One delete password for the whole office. New passwords are stored as a
 * salted hash in Admin Access (cloud, shared by every device and team member).
 * Older offices still have the first-generation plaintext copy in Office
 * settings; it keeps working until a new password is saved.
 */
export async function checkDeletePassword(
  settings: AdminAccessSettings,
  legacyOfficePassword: string,
  attempt: string,
): Promise<DeletePasswordCheck> {
  const legacy = (legacyOfficePassword ?? "").trim();
  if (!settings.deletePasswordHash && !legacy) return "none";
  if (!attempt) return "wrong";
  if (settings.deletePasswordHash && (await verifyDeletePassword(settings, attempt))) return "ok";
  if (legacy && attempt === legacy) return "ok";
  return "wrong";
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

/** Can this role do `action`? Admins and the owner always can; manager/staff follow the role grid. */
export function actionAllowedFor(
  tier: RoleTier,
  action: RoleActionKey,
  settings: AdminAccessSettings,
): boolean {
  if (isAdminTier(tier)) return true;
  if (tier !== "manager" && tier !== "staff") return false;
  return settings.roleActions[tier][action] === true;
}

/**
 * Who may change the role definitions: the owner always; an Admin only when the
 * owner switched "Admins can change roles" on. Managers and staff never.
 * (The database enforces the same rule on the role-settings row.)
 */
export function canEditRoleSettings(tier: RoleTier, settings: AdminAccessSettings): boolean {
  if (tier === "owner") return true;
  return tier === "admin" && settings.adminsCanEditRoles;
}

/** The part of the settings stored in ROLE_SETTINGS_KEY (everything but the delete password). */
export function roleDefinitionsOf(settings: AdminAccessSettings) {
  return {
    managerDashboard: settings.managerDashboard,
    rolePages: settings.rolePages,
    roleDeletes: settings.roleDeletes,
    roleActions: settings.roleActions,
    adminsCanEditRoles: settings.adminsCanEditRoles,
  };
}

/**
 * Combine the two cloud rows into one settings object. The role definitions
 * come from the role row when it exists, else from the older Admin Access row
 * (so nothing an office already set is lost); the delete password always
 * comes from the Admin Access row.
 */
export function mergeStoredAccess(adminAccessRaw: unknown, roleRaw: unknown): AdminAccessSettings {
  const legacy = adminAccessRaw && typeof adminAccessRaw === "object" ? (adminAccessRaw as Record<string, unknown>) : {};
  const roles = roleRaw && typeof roleRaw === "object" ? (roleRaw as Record<string, unknown>) : null;
  const security = {
    passwordAppliesToAdmins: legacy.passwordAppliesToAdmins,
    deletePasswordHash: legacy.deletePasswordHash,
    deletePasswordSalt: legacy.deletePasswordSalt,
  };
  if (!roles) return normalizeAdminAccess({ ...legacy, ...security });
  // Role row wins for every role field; the old row's legacy delete map is ignored once a role row exists.
  return normalizeAdminAccess({ ...roles, ...security });
}

/** What a manager/staff member's access to `feature` actually is, in plain words (for the Roles grid and G.O.A.T.). */
export function accessLabel(level: AccessLevel): string {
  return level === "edit" ? "Full" : level === "view" ? "View only" : "No access";
}

/**
 * Per-person overrides on top of the role: patient-page sections hidden for
 * that member, plus old per-page grants from before roles existed (these no
 * longer do anything; clearing them is harmless).
 */
export function memberOverrideSummary(permissions: Record<string, unknown> | null | undefined): string[] {
  if (!permissions) return [];
  const out: string[] = [];
  const hidden = Array.isArray(permissions.hiddenSections) ? permissions.hiddenSections.length : 0;
  if (hidden > 0) out.push(`${hidden} patient-page section${hidden === 1 ? "" : "s"} hidden`);
  const legacy = LEGACY_GRANT_KEYS.filter((k) => permissions[k] === "view" || permissions[k] === "edit").length;
  if (legacy > 0) out.push(`${legacy} old page grant${legacy === 1 ? "" : "s"} (no longer used)`);
  return out;
}

const LEGACY_GRANT_KEYS = ROLE_PAGES.map((p) => p.feature as string);

/** The member's permissions with every override removed — role, identity, location and on/off are kept. */
export function permissionsWithoutOverrides<T extends Record<string, unknown>>(permissions: T): T {
  const next: Record<string, unknown> = { ...permissions };
  delete next.hiddenSections;
  for (const key of LEGACY_GRANT_KEYS) delete next[key];
  return next as T;
}

import type { PortalFeature } from "@/lib/plan-access";

/**
 * Team permissions model.
 *
 * The account OWNER always has full access to everything. Each team
 * member the owner creates gets a per-section access level:
 *   - "none" → the section is hidden and its routes are blocked
 *   - "view" → read-only (can open + look, cannot create/edit/delete/
 *              rename)
 *   - "edit" → full control within that section
 *
 * Permissions live on the workspace_members row (jsonb). Enforcement is
 * layered on top of the existing nav / route gating.
 */

export type AccessLevel = "none" | "view" | "edit";

export type MemberPermissions = Partial<Record<PortalFeature, AccessLevel>>;

/**
 * Sections a member can be granted. "settings" is intentionally excluded
 * — office/system configuration and team management stay owner-only.
 */
export const PERMISSIONABLE_FEATURES: { feature: PortalFeature; label: string }[] = [
  { feature: "patients", label: "Patients" },
  { feature: "statistics", label: "Statistics" },
  { feature: "contacts", label: "Contacts" },
  { feature: "appointments", label: "Schedule" },
  { feature: "encounters", label: "Encounters" },
  { feature: "keyDates", label: "Key Dates" },
  { feature: "myFiles", label: "My Files" },
  { feature: "billing", label: "Billing" },
  { feature: "timers", label: "Timers" },
  { feature: "marketing", label: "Marketing" },
];

export const ACCESS_LEVELS: AccessLevel[] = ["none", "view", "edit"];

export function accessLevelFor(
  perms: MemberPermissions | null | undefined,
  feature: PortalFeature,
): AccessLevel {
  if (!perms) return "none";
  return perms[feature] ?? "none";
}

/** Can the member open / read this section at all? */
export function canView(
  perms: MemberPermissions | null | undefined,
  feature: PortalFeature,
): boolean {
  const level = accessLevelFor(perms, feature);
  return level === "view" || level === "edit";
}

/** Can the member create / modify / delete / rename within this section? */
export function canEdit(
  perms: MemberPermissions | null | undefined,
  feature: PortalFeature,
): boolean {
  return accessLevelFor(perms, feature) === "edit";
}

export function normalizeAccessLevel(value: unknown): AccessLevel {
  return value === "view" || value === "edit" ? value : "none";
}

export function normalizePermissions(value: unknown): MemberPermissions {
  if (!value || typeof value !== "object") return {};
  const out: MemberPermissions = {};
  for (const { feature } of PERMISSIONABLE_FEATURES) {
    const level = normalizeAccessLevel((value as Record<string, unknown>)[feature]);
    if (level !== "none") out[feature] = level;
  }
  return out;
}

// ---------------------------------------------------------------------
// Audit log — who did what. Written best-effort from the client on the
// actions that matter for accountability (deletes, renames, reschedules,
// sign-offs, etc.). The owner reads the log; members can only append.
// ---------------------------------------------------------------------

export type AuditAction =
  | "file.delete"
  | "file.rename"
  | "file.upload"
  | "patient.delete"
  | "patient.create"
  | "appointment.create"
  | "appointment.reschedule"
  | "appointment.delete"
  | "encounter.delete"
  | "encounter.sign"
  | "member.add"
  | "member.remove"
  | "member.update";

export interface AuditEntryInput {
  action: AuditAction;
  target?: string;
  details?: Record<string, unknown>;
}

/** Short human labels for the audit action, for the owner's log view. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "file.delete": "Deleted file",
  "file.rename": "Renamed file",
  "file.upload": "Uploaded file",
  "patient.delete": "Deleted patient",
  "patient.create": "Created patient",
  "appointment.create": "Created appointment",
  "appointment.reschedule": "Rescheduled appointment",
  "appointment.delete": "Deleted appointment",
  "encounter.delete": "Deleted encounter",
  "encounter.sign": "Signed encounter",
  "member.add": "Added team member",
  "member.remove": "Removed team member",
  "member.update": "Updated team member",
};

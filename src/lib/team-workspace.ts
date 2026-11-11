import { normalizePermissions } from "@/lib/team-permissions";

export type TeamMembershipRow = {
  workspace_owner_id?: string | null;
  permissions?: unknown;
};

/**
 * Who the team change belongs to.
 * A caller with no membership row is the office owner.
 * A caller who is a member may manage the team only as an office admin,
 * and the new member is attached to that row's owner, not to the caller.
 */
export function resolveTeamWorkspace(
  callerId: string,
  membership: TeamMembershipRow | null,
): { ownerId: string } | { error: string; status: number } {
  if (!membership?.workspace_owner_id) return { ownerId: callerId };
  const perms = normalizePermissions(membership.permissions);
  const officeAdmin = perms.officeAdmin === true || perms.roleTier === "admin";
  if (!officeAdmin) {
    return { error: "Only the office owner or an office admin can manage the team.", status: 403 };
  }
  return { ownerId: String(membership.workspace_owner_id) };
}

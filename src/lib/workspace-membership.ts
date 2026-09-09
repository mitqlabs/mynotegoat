"use client";

/**
 * Workspace membership resolution.
 *
 * A logged-in user is either:
 *   - the OWNER of their own workspace (`<their uid>:main-office`), or
 *   - a MEMBER the owner invited, who works INSIDE the owner's workspace
 *     (`<owner uid>:main-office`) with a limited set of permissions.
 *
 * At bootstrap we look up the user's row in `workspace_members`. If found,
 * they're a member: their working workspace is the OWNER's, and their
 * permissions gate what they can see/do. If not found, they're the owner.
 *
 * The result is cached at module level so the write-path guard
 * (resolveValidatedWorkspaceId) and the React access context can read it
 * synchronously without re-querying.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { normalizePermissions, type MemberPermissions } from "@/lib/team-permissions";

export interface WorkspaceMembership {
  /** The logged-in user's own auth uid. */
  userId: string;
  /** True when this user is a member of someone else's workspace. */
  isMember: boolean;
  /** The workspace OWNER's uid — equals `userId` for an owner. */
  ownerId: string;
  /** Member's granted permissions (empty for an owner, who has full access). */
  permissions: MemberPermissions;
  /** Member's role label ("Front Desk", …); "" for an owner. */
  label: string;
  /** Whether this member is elevated to office-admin (can manage settings/team). */
  officeAdmin: boolean;
  /** Member deactivated by the owner — must be blocked from logging in. */
  disabled: boolean;
}

let cached: WorkspaceMembership | null = null;

/** The membership resolved at bootstrap — read synchronously by guards. */
export function getCurrentMembershipSync(): WorkspaceMembership | null {
  return cached;
}

export function clearMembershipCache() {
  cached = null;
}

/**
 * Resolve the membership for `userId`. Queries `workspace_members`; a hit
 * means the user is a member of that row's owner. Falls back to owner-of-self
 * on any error (fail-safe: never strand a real owner out of their own data).
 */
export async function resolveWorkspaceMembership(
  userId: string,
): Promise<WorkspaceMembership> {
  const ownerFallback: WorkspaceMembership = {
    userId,
    isMember: false,
    ownerId: userId,
    permissions: {},
    label: "",
    officeAdmin: false,
    disabled: false,
  };
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    cached = ownerFallback;
    return ownerFallback;
  }
  try {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_owner_id, permissions, label")
      .eq("member_user_id", userId)
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      // Diagnostic: distinguish "query blocked/errored" from "no membership
      // row" — a member who lands here is silently treated as an owner of
      // their own (empty) workspace, which looks exactly like data loss.
      console.info(
        "[membership] no member row for",
        userId,
        error ? `— query ERROR: ${error.message} (code ${error.code ?? "?"})` : "— no row matched (this account is not a team member of anyone)",
      );
      cached = ownerFallback;
      return ownerFallback;
    }
    console.info("[membership] linked as member of owner", String(data.workspace_owner_id));
    const perms = normalizePermissions(data.permissions);
    const membership: WorkspaceMembership = {
      userId,
      isMember: true,
      ownerId: String(data.workspace_owner_id),
      permissions: perms,
      label: typeof data.label === "string" ? data.label : "Team Member",
      // Office-admin is stored as an "officeAdmin" flag inside permissions.
      officeAdmin: Boolean((data.permissions as Record<string, unknown> | null)?.officeAdmin),
      disabled: Boolean((data.permissions as Record<string, unknown> | null)?.disabled),
    };
    cached = membership;
    return membership;
  } catch {
    cached = ownerFallback;
    return ownerFallback;
  }
}

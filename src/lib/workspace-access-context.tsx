"use client";

/**
 * Workspace access context — the single place the app asks
 * "can the logged-in user reach feature X, and can they edit it?"
 *
 * Combines the member's granted permissions with the office-wide module
 * visibility (a hard ceiling) via effectiveAccessLevel(). Owners and
 * office-admin members get full access; regular members get their grants,
 * capped by what the office has turned on.
 *
 * Fail-open to OWNER when no membership is loaded (e.g. outside the portal
 * provider, or before bootstrap resolves) — a real owner must never be
 * locked out of their own data. Members are only ever restricted once their
 * membership is resolved and provided, which the portal layout always does.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  effectiveAccessLevel,
  type AccessLevel,
} from "@/lib/team-permissions";
import { useModuleVisibility } from "@/hooks/use-module-visibility";
import type { PortalFeature } from "@/lib/plan-access";
import type { WorkspaceMembership } from "@/lib/workspace-membership";
import {
  ROLE_ACTIONS,
  actionAllowedFor,
  deleteRuleFor,
  isAdminTier,
  pageAccessFor,
  roleTierOf,
  type AdminAccessSettings,
  type DeletableKind,
  type RoleActionKey,
  type DeleteRule,
  type RoleTier,
} from "@/lib/admin-access";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { defaultAdminAccess } from "@/lib/admin-access";

export interface WorkspaceAccessValue {
  isOwner: boolean;
  isMember: boolean;
  officeAdmin: boolean;
  /** owner | admin | manager | staff — see src/lib/admin-access.ts. */
  roleTier: RoleTier;
  /** False while the membership is still loading (or no provider). Features
   *  that must fail closed (G.O.A.T. admin stats) treat unknown as non-admin. */
  roleKnown: boolean;
  /** Effective access level for a feature (module cap + member grant). */
  access: (feature: PortalFeature) => AccessLevel;
  /** Can the user open/read this feature at all? */
  canView: (feature: PortalFeature) => boolean;
  /** Can the user create/modify within this feature? */
  canEdit: (feature: PortalFeature) => boolean;
  /** Is this patient-page sub-panel hidden for this member? (never for owner) */
  sectionHidden: (sectionKey: string) => boolean;
  /** Can this role do this in-page action (add / edit contacts…)? Needs Full access to the page too. */
  can: (action: RoleActionKey) => boolean;
  /** "allowed" | "password" | "never" for this role, from Roles & Permissions. */
  deleteRule: (kind: DeletableKind) => DeleteRule;
  /** The Roles & Permissions settings behind the checks above. */
  adminAccess: AdminAccessSettings;
}

const OWNER_FULL: Omit<
  WorkspaceAccessValue,
  "access" | "canView" | "canEdit" | "can" | "sectionHidden" | "deleteRule" | "adminAccess"
> = {
  isOwner: true,
  isMember: false,
  officeAdmin: false,
  roleTier: "owner",
  roleKnown: false,
};

const Ctx = createContext<WorkspaceAccessValue | null>(null);

export function WorkspaceAccessProvider({
  membership,
  children,
}: {
  membership: WorkspaceMembership | null;
  children: ReactNode;
}) {
  const { visibility } = useModuleVisibility();
  const { adminAccess } = useAdminAccess();
  const value = useMemo<WorkspaceAccessValue>(() => {
    const isMember = membership?.isMember ?? false;
    const officeAdmin = membership?.officeAdmin ?? false;
    const roleTier = roleTierOf(membership);
    // Owner OR admin = full access. Manager/staff get their grants.
    const fullAccess = isAdminTier(roleTier);
    const perms = membership?.permissions ?? {};
    const hidden = new Set(perms.hiddenSections ?? []);
    // Access comes from the ROLE now (Settings → Roles & Permissions), capped by
    // what the office has switched on office-wide. The old per-member
    // grants are still read for members who have them and haven't been
    // given a role yet, so nobody's access changes until the role is set.
    const access = (feature: PortalFeature): AccessLevel => {
      const cap = effectiveAccessLevel(visibility, perms, true, feature);
      if (cap === "none") return "none";
      if (fullAccess) return cap;
      const byRole = pageAccessFor(roleTier, feature, adminAccess);
      return cap === "view" && byRole === "edit" ? "view" : byRole;
    };
    return {
      isOwner: !isMember,
      isMember,
      officeAdmin,
      roleTier,
      roleKnown: membership !== null,
      access,
      canView: (f) => access(f) !== "none",
      canEdit: (f) => access(f) === "edit",
      // Owners/office-admins see every section; a regular member hides the
      // panels the owner switched off for them.
      // An action also needs Full access to the page it lives on (View only = no adding or editing).
      can: (action) =>
        actionAllowedFor(roleTier, action, adminAccess) &&
        access(ROLE_ACTIONS.find((a) => a.key === action)!.feature) === "edit",
      sectionHidden: (sectionKey) => (fullAccess ? false : hidden.has(sectionKey)),
      deleteRule: (kind) => deleteRuleFor(roleTier, kind, adminAccess),
      adminAccess,
    };
  }, [membership, visibility, adminAccess]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaceAccess(): WorkspaceAccessValue {
  const v = useContext(Ctx);
  if (v) return v;
  // No provider → fail open to owner-full (never lock out the owner).
  return {
    ...OWNER_FULL,
    access: () => "edit",
    canView: () => true,
    canEdit: () => true,
    can: () => true,
    sectionHidden: () => false,
    deleteRule: () => "allowed",
    adminAccess: defaultAdminAccess(),
  };
}

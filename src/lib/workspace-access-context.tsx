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

export interface WorkspaceAccessValue {
  isOwner: boolean;
  isMember: boolean;
  officeAdmin: boolean;
  /** Effective access level for a feature (module cap + member grant). */
  access: (feature: PortalFeature) => AccessLevel;
  /** Can the user open/read this feature at all? */
  canView: (feature: PortalFeature) => boolean;
  /** Can the user create/modify within this feature? */
  canEdit: (feature: PortalFeature) => boolean;
}

const OWNER_FULL: Omit<WorkspaceAccessValue, "access" | "canView" | "canEdit"> = {
  isOwner: true,
  isMember: false,
  officeAdmin: false,
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
  const value = useMemo<WorkspaceAccessValue>(() => {
    const isMember = membership?.isMember ?? false;
    const officeAdmin = membership?.officeAdmin ?? false;
    // Owner OR office-admin = full access. Regular member = their grants.
    const fullAccess = !isMember || officeAdmin;
    const perms = membership?.permissions ?? {};
    const access = (feature: PortalFeature): AccessLevel =>
      effectiveAccessLevel(visibility, perms, fullAccess, feature);
    return {
      isOwner: !isMember,
      isMember,
      officeAdmin,
      access,
      canView: (f) => access(f) !== "none",
      canEdit: (f) => access(f) === "edit",
    };
  }, [membership, visibility]);
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
  };
}

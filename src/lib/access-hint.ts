"use client";

import type { AuthAccessState } from "@/lib/auth-access";
import type { WorkspaceMembership } from "@/lib/workspace-membership";

/**
 * Speed hint for the portal bootstrap: the last access + team-membership
 * answer for this signed-in user. NOT user data and never synced (it is
 * deliberately outside the casemate.* namespace). It only lets the app skip
 * two network round trips on open; both are still re-checked in the
 * background and any difference reloads the page (or redirects) at once.
 */
const KEY = "notegoat.access-hint.v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface AccessHint {
  userId: string;
  at: number;
  access: AuthAccessState;
  membership: WorkspaceMembership;
}

export function readAccessHint(userId: string): AccessHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const hint = JSON.parse(raw) as AccessHint;
    if (!hint || hint.userId !== userId || Date.now() - hint.at > MAX_AGE_MS) return null;
    if (hint.access?.state !== "access-granted" || hint.access.isAdmin) return null;
    if (!hint.membership || hint.membership.userId !== userId || hint.membership.disabled) return null;
    return hint;
  } catch {
    return null;
  }
}

export function writeAccessHint(userId: string, access: AuthAccessState, membership: WorkspaceMembership) {
  if (typeof window === "undefined") return;
  try {
    if (access.state !== "access-granted" || access.isAdmin || membership.disabled) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(KEY, JSON.stringify({ userId, at: Date.now(), access, membership }));
  } catch {
    // storage blocked: just no speed-up next time
  }
}

export function clearAccessHint() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** True when a fresh check disagrees with the hint in any way that matters. */
export function accessHintDiffers(hint: AccessHint, access: AuthAccessState, membership: WorkspaceMembership) {
  return (
    access.state !== hint.access.state ||
    access.userId !== hint.access.userId ||
    Boolean(access.isAdmin) !== Boolean(hint.access.isAdmin) ||
    access.planTier !== hint.access.planTier ||
    JSON.stringify(membership) !== JSON.stringify(hint.membership)
  );
}

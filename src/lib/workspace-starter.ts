/**
 * Which starting defaults a workspace gets.
 *
 * Most settings (appointment types, office hours, SOAP macros, CPT charges,
 * Dx folders, letter/report templates) are NOT saved per workspace until
 * someone edits them. Until then the app shows defaults that live in code.
 *
 *  - "legacy": the original personal-injury chiro defaults. EVERY workspace
 *    that existed before this change is legacy, forever, with no data
 *    written. A workspace without a marker is legacy, so nothing an existing
 *    office sees can change.
 *  - "blank":  a practice that signed up after BLANK_STARTER_CUTOFF_ISO
 *    starts clean (no one else's templates, texts, macros, prices or Dx
 *    folders). Recorded once, in the cloud, as the workspace_kv row
 *    "casemate.workspace-starter.v1" = { starter: "blank" }, so every
 *    device and team member of that practice agrees.
 *
 * Fail-safe direction: any doubt (no marker, unreadable marker, cloud not
 * reachable, team member, old account) means legacy.
 */

import { REFERRAL_TICKS_LEGACY_KEY } from "@/lib/referral-ticks";

export const WORKSPACE_STARTER_KEY = "casemate.workspace-starter.v1";

/**
 * Accounts created at or after this moment can get the blank starter
 * (Oct 19 2026, 8:00 AM Pacific). The newest account that existed when this
 * was written was created Oct 5 2026, so every existing practice is older and
 * keeps the legacy defaults. An account created between this cutoff and the
 * day this ships is still protected: blank is only chosen while the
 * workspace has no saved settings at all (see shouldMarkBlankStarter).
 */
export const BLANK_STARTER_CUTOFF_ISO = "2026-10-19T15:00:00.000Z";

export type WorkspaceStarter = "legacy" | "blank";

export interface WorkspaceStarterMarker {
  starter: "blank";
  decidedAt: string;
  version: 1;
}

export function makeBlankStarterMarker(now = new Date()): WorkspaceStarterMarker {
  return { starter: "blank", decidedAt: now.toISOString(), version: 1 };
}

/** Parse a stored marker. Anything that isn't exactly a blank marker is legacy. */
export function parseWorkspaceStarter(value: unknown): WorkspaceStarter {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return "legacy";
    }
  }
  if (v && typeof v === "object" && (v as { starter?: unknown }).starter === "blank") return "blank";
  return "legacy";
}

let cachedRaw: string | null | undefined;
let cachedStarter: WorkspaceStarter = "legacy";

/** Synchronous check used by every default getter. Server / no window = legacy. */
export function getWorkspaceStarter(): WorkspaceStarter {
  if (typeof window === "undefined" || !window.localStorage) return "legacy";
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORKSPACE_STARTER_KEY);
  } catch {
    return "legacy";
  }
  if (raw === cachedRaw) return cachedStarter;
  cachedRaw = raw;
  cachedStarter = raw ? parseWorkspaceStarter(raw) : "legacy";
  return cachedStarter;
}

export function isBlankStarterWorkspace(): boolean {
  return getWorkspaceStarter() === "blank";
}

/** Keys that count as "this workspace already has saved settings/data". */
function isWorkspaceDataKey(key: string): boolean {
  if (key === WORKSPACE_STARTER_KEY) return false;
  // Per-user mirrored prefs / tick rows live in the same table but say
  // nothing about the practice's settings.
  if (key.startsWith("casemate.user-prefs.v1.u.")) return false;
  if (key.startsWith(REFERRAL_TICKS_LEGACY_KEY.replace(/\.v1$/, "."))) return false;
  return key.startsWith("casemate.") || key.startsWith("notegoat.");
}

export interface StarterDecisionInput {
  /** True when the signed-in user owns this workspace (not a team member). */
  isOwner: boolean;
  /** auth user created_at (ISO). */
  userCreatedAt: string | null | undefined;
  /** Keys already saved in the cloud for this workspace, or null when the cloud read failed. */
  cloudKeys: string[] | null;
  /** The marker value saved in the cloud, if any. */
  cloudMarker: unknown;
  /** The marker this browser holds (set by an earlier session whose cloud write may have failed). */
  localMarker: unknown;
  cutoffIso?: string;
}

/**
 * Should this boot write the blank marker? Only for a workspace OWNER whose
 * account is newer than the cutoff, whose workspace has no marker yet, and
 * whose workspace has no saved settings yet (or this browser already decided
 * "blank" in an earlier session). Everything else: no, stay legacy.
 */
export function shouldMarkBlankStarter(input: StarterDecisionInput): boolean {
  if (!input.isOwner) return false;
  if (parseWorkspaceStarter(input.cloudMarker) === "blank") return false; // already marked
  if (input.cloudMarker !== undefined && input.cloudMarker !== null) return false; // some other explicit marker
  if (!input.cloudKeys) return false; // cloud unreadable: never guess
  const created = Date.parse(input.userCreatedAt ?? "");
  const cutoff = Date.parse(input.cutoffIso ?? BLANK_STARTER_CUTOFF_ISO);
  if (!Number.isFinite(created) || !Number.isFinite(cutoff) || created < cutoff) return false;
  const hasSavedData = input.cloudKeys.some(isWorkspaceDataKey);
  if (!hasSavedData) return true;
  return parseWorkspaceStarter(input.localMarker) === "blank";
}

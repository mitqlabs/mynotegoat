/**
 * Team feature master switch.
 *
 * A single per-workspace toggle for the whole team-members system:
 *   - ON  → team members can log in and work inside the workspace with
 *           their granted permissions; the account holder is the ADMIN.
 *   - OFF → solo mode. Member logins are blocked (they see an "access
 *           disabled" screen) and the owner works alone.
 *
 * Stored per workspace and dual-written to the "tasks" KV namespace, so a
 * member's device reads the owner's value after the bootstrap cloud pull
 * (same mechanism as module visibility).
 *
 * DEFAULT IS ON. An unset flag must never lock existing members out — the
 * owner has to deliberately turn the team off.
 */

const STORAGE_KEY = "casemate.team-settings.v1";
export const STORAGE_KEY_TEAM_SETTINGS = STORAGE_KEY;

export interface TeamSettings {
  /** Master on/off for the team-members feature. */
  enabled: boolean;
}

export const defaultTeamSettings: TeamSettings = { enabled: true };

export function normalizeTeamSettings(value: unknown): TeamSettings {
  if (!value || typeof value !== "object") return { ...defaultTeamSettings };
  const raw = value as Record<string, unknown>;
  return { enabled: typeof raw.enabled === "boolean" ? raw.enabled : true };
}

export function loadTeamSettings(): TeamSettings {
  if (typeof window === "undefined") return { ...defaultTeamSettings };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultTeamSettings };
    return normalizeTeamSettings(JSON.parse(raw));
  } catch {
    return { ...defaultTeamSettings };
  }
}

export function saveTeamSettings(settings: TeamSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

/** True when the team-members feature is switched on for this workspace. */
export function isTeamEnabled(): boolean {
  return loadTeamSettings().enabled;
}

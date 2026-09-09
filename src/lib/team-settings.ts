/**
 * Team feature master switch (per workspace).
 *
 *   ON  → the team roster is active; the logged-in account holder shows as
 *         the ADMIN automatically (no self sign-up), and staff members the
 *         owner creates appear alongside them.
 *   OFF → solo mode; the roster UI is tucked away.
 *
 * This is a presentation/organization switch — it does NOT revoke a
 * member's granted permissions, so flipping it can never strand anyone.
 * Stored per workspace, dual-written to the "tasks" KV namespace so it
 * rides the normal cloud sync.
 *
 * load returns `null` when the flag was never set, so callers can fall
 * back to "on if any members exist" rather than forcing a default.
 */

const STORAGE_KEY = "casemate.team-settings.v1";
export const STORAGE_KEY_TEAM_SETTINGS = STORAGE_KEY;

export function loadTeamEnabled(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as { enabled?: unknown }).enabled === "boolean") {
      return (parsed as { enabled: boolean }).enabled;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTeamEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", { enabled }));
}

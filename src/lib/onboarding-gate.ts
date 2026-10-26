/**
 * Onboarding wizard gate (incident 2026-10-26).
 *
 * The "Setup · Step 1 of 5" wizard is ONLY for a brand-new, empty office.
 * The local onboarding flag / local settings can be cleared at any time
 * (sign-out, the workspace cache guard discarding a cache, a new browser),
 * so they are never enough on their own to show the wizard. Before showing
 * it we ask the cloud whether this office already has anything in it.
 * Any doubt (offline, error, no workspace) => do NOT show it.
 */

export type CloudOfficeProbe = {
  /** Probe completed without errors. */
  ok: boolean;
  patients: number;
  appointments: number;
  /** workspace_kv keys present in the cloud for this workspace. */
  kvKeys: string[];
};

/** Cloud keys whose presence proves the office was already set up. */
export const SETUP_PROOF_KV_KEYS = [
  "casemate.onboarding.v1",
  "casemate.office-settings.v1",
  "casemate.schedule-appointment-types.v1",
  "casemate.macro-library.v1",
  "casemate.billing-macros.v1",
];

/** Pure decision: may the wizard be shown for this office? */
export function mayShowSetupWizard(input: {
  isTeamMember: boolean;
  localCompleted: boolean;
  probe: CloudOfficeProbe | null;
}): boolean {
  if (input.isTeamMember) return false;
  if (input.localCompleted) return false;
  const p = input.probe;
  if (!p || !p.ok) return false; // unknown => never interrupt someone working
  if (p.patients > 0 || p.appointments > 0) return false;
  if (p.kvKeys.some((k) => SETUP_PROOF_KV_KEYS.includes(k))) return false;
  return true;
}

/** Read-only cloud check. Never writes. */
export async function probeCloudOffice(): Promise<CloudOfficeProbe | null> {
  if (typeof window === "undefined") return null;
  try {
    const [{ getSupabaseBrowserClient }, { getActiveWorkspaceIdSync }] = await Promise.all([
      import("@/lib/supabase-browser"),
      import("@/lib/workspace-storage"),
    ]);
    const supabase = getSupabaseBrowserClient();
    const workspaceId = getActiveWorkspaceIdSync();
    if (!supabase || !workspaceId) return null;
    const [pRes, aRes, kRes] = await Promise.all([
      supabase.from("patients").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      supabase.from("schedule_appointments").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      supabase.from("workspace_kv").select("key").eq("workspace_id", workspaceId).in("key", SETUP_PROOF_KV_KEYS),
    ]);
    if (pRes.error || aRes.error || kRes.error) return { ok: false, patients: 0, appointments: 0, kvKeys: [] };
    return {
      ok: true,
      patients: pRes.count ?? 0,
      appointments: aRes.count ?? 0,
      kvKeys: ((kRes.data ?? []) as Array<{ key: string }>).map((r) => r.key),
    };
  } catch {
    return null;
  }
}

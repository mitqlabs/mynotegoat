"use client";

/**
 * Feature Flags
 *
 * Phase-0 of the cloud-as-truth migration. Every flag here defaults to FALSE
 * so Phase 0 ships zero user-visible behavior changes — the new code paths
 * exist but no entity is wired through them yet.
 *
 * Each subsequent phase flips ONE flag to true after its entity has been
 * verified end-to-end (read, write, realtime, multi-tab, sign-out wipe,
 * cross-account isolation). If a phase regresses, flip the flag back to
 * false and the app returns to legacy behavior with no code rollback.
 *
 * NEVER read these flags from inside a render-time branch that switches
 * between two storage shapes — always pick at module load. Toggling at
 * runtime would tear caches in half.
 */

export const cloudEntityFlags: Record<CloudEntityFlag, boolean> = {
  /** Phase 1: patients table-backed cloud entity. */
  patients: true,
  /** Phase 2: schedule appointments. */
  scheduleAppointments: true,
  /** Phase 3: encounter notes. */
  encounterNotes: true,
  /** Phase 4: patient billing, diagnoses, follow-up overrides. */
  billing: true,
  /** Phase 5: macros + templates. */
  macros: true,
  /** Phase 6: scheduling settings. */
  schedulingSettings: true,
  /** Phase 7: contacts. */
  contacts: true,
  /** Phase 8: tasks, dashboard, settings. */
  tasks: true,
  /** Phase 9: patient files index — one row per file (kills the orphan-prone
   *  single blob). OFF by default; flip per-browser to test, then globally. */
  patientFiles: false,
};

export type CloudEntityFlag =
  | "patients"
  | "scheduleAppointments"
  | "encounterNotes"
  | "billing"
  | "macros"
  | "schedulingSettings"
  | "contacts"
  | "tasks"
  | "patientFiles";

/**
 * Per-browser override key. Setting `casemate.feature-flag.<name>` to "on"
 * in localStorage flips the flag in this browser only — useful for testing
 * a phase rollout end-to-end on your own session before flipping the
 * compile-time default for everyone. Set to "off" to force-disable.
 */
const OVERRIDE_PREFIX = "casemate.feature-flag.";

export function isCloudEntityEnabled(flag: CloudEntityFlag): boolean {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(`${OVERRIDE_PREFIX}${flag}`);
      if (override === "on") return true;
      if (override === "off") return false;
    } catch {
      // localStorage may be unavailable in private mode — fall through
    }
  }
  return cloudEntityFlags[flag] === true;
}

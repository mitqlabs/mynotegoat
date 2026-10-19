"use client";

/**
 * Setup guide (the welcome popup) state + progress.
 *
 * State lives in the workspace_kv row "casemate.onboarding.v1" so closing
 * the guide on one computer closes it everywhere. Progress is DERIVED from
 * the real settings (office info, doctors, appointment types, team,
 * patients) plus two "confirmed" ticks for steps that have no data of their
 * own (office hours look right; working without a team).
 */

export interface OnboardingState {
  /** Steps the user explicitly skipped (kept for old saved copies). */
  skippedSteps: string[];
  /** Steps the user confirmed by hand ("Hours look right", "I work alone"). */
  confirmedSteps: string[];
  /** When the guide was finished from its last screen. */
  completedAt?: string;
  /** When the guide was closed with ×. It reopens from Settings or the Dashboard. */
  dismissedAt?: string;
}

const STORAGE_KEY = "casemate.onboarding.v1";

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeOnboardingState(value: unknown): OnboardingState {
  const parsed = value && typeof value === "object" ? (value as Partial<OnboardingState>) : {};
  return {
    skippedSteps: stringList(parsed.skippedSteps),
    confirmedSteps: stringList(parsed.confirmedSteps),
    completedAt: isoOrUndefined(parsed.completedAt),
    dismissedAt: isoOrUndefined(parsed.dismissedAt),
  };
}

export function loadOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return normalizeOnboardingState(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeOnboardingState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeOnboardingState(null);
  }
}

export function saveOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", state));
}

export const onboardingStorageKey = STORAGE_KEY;

// ── Progress ────────────────────────────────────────────────────────────

export type SetupStepId = "practice" | "offices" | "doctors" | "appointmentTypes" | "team" | "firstPatient";

export const SETUP_STEPS: { id: SetupStepId; title: string }[] = [
  { id: "practice", title: "Practice info" },
  { id: "offices", title: "Offices & hours" },
  { id: "doctors", title: "Doctors" },
  { id: "appointmentTypes", title: "Appointment types" },
  { id: "team", title: "Team members" },
  { id: "firstPatient", title: "First patient" },
];

export interface SetupProgressInput {
  office: {
    officeName: string;
    phone: string;
    address: string;
    doctorName: string;
    multiLocation: boolean;
    locations: { addr1?: string; address?: string; phone?: string }[];
    doctors: { id: string; name: string }[];
  };
  appointmentTypeCount: number;
  /** Team members other than the owner. */
  teamMemberCount: number;
  patientCount: number;
  confirmedSteps: string[];
}

export interface SetupProgress {
  steps: { id: SetupStepId; title: string; done: boolean }[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** First step that isn't done yet (or the last step). */
  nextStepId: SetupStepId;
}

/** Practice info counts only when name, phone AND an address are filled in. */
export function isPracticeInfoDone(office: SetupProgressInput["office"]): boolean {
  if (!office.officeName.trim()) return false;
  if (office.multiLocation && office.locations.length > 0) {
    // With several offices, phone and address live per office.
    return office.locations.some(
      (l) => (l.addr1 ?? l.address ?? "").trim() && (l.phone ?? "").trim(),
    );
  }
  return Boolean(office.phone.trim() && office.address.trim());
}

export function computeSetupProgress(input: SetupProgressInput): SetupProgress {
  const confirmed = new Set(input.confirmedSteps);
  const doneById: Record<SetupStepId, boolean> = {
    practice: isPracticeInfoDone(input.office),
    offices: confirmed.has("offices"),
    doctors: input.office.doctors.some((d) => d.name.trim()) || Boolean(input.office.doctorName.trim()),
    appointmentTypes: input.appointmentTypeCount > 0,
    team: input.teamMemberCount > 0 || confirmed.has("team"),
    firstPatient: input.patientCount > 0,
  };
  const steps = SETUP_STEPS.map((s) => ({ ...s, done: doneById[s.id] }));
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) ?? steps[steps.length - 1];
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, nextStepId: next.id };
}

/**
 * Should the guide pop up by itself? Only for a brand-new practice (blank
 * starter) that hasn't finished or closed it. Existing practices can still
 * open it from Settings, it just never pops up on them.
 */
export function shouldAutoOpenSetupGuide(input: {
  isBlankStarter: boolean;
  isMember: boolean;
  state: OnboardingState;
}): boolean {
  if (input.isMember || !input.isBlankStarter) return false;
  return !input.state.completedAt && !input.state.dismissedAt;
}

// ── Open from anywhere ──────────────────────────────────────────────────

export const OPEN_SETUP_GUIDE_EVENT = "notegoat:open-setup-guide";

/** Open the setup guide (Settings button, Dashboard card). */
export function openSetupGuide(step?: SetupStepId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SETUP_GUIDE_EVENT, { detail: step ?? null }));
}

export const OPEN_SETTINGS_SECTION_EVENT = "notegoat:open-settings-section";

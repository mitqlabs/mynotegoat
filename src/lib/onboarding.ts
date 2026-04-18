"use client";

import type { AppointmentTypeConfig } from "@/lib/schedule-appointment-types";
import type { BillingMacroLibraryConfig } from "@/lib/billing-macros";
import type { MacroTemplate } from "@/lib/macro-templates";
import type { OfficeSettings } from "@/lib/office-settings";

export interface OnboardingState {
  /** Steps the user explicitly skipped in this session. */
  skippedSteps: string[];
  /** ISO timestamp of the moment the onboarding modal was dismissed as complete. */
  completedAt?: string;
}

const STORAGE_KEY = "casemate.onboarding.v1";

export function loadOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return { skippedSteps: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { skippedSteps: [] };
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      skippedSteps: Array.isArray(parsed.skippedSteps)
        ? parsed.skippedSteps.filter((s): s is string => typeof s === "string")
        : [],
      completedAt:
        typeof parsed.completedAt === "string" && parsed.completedAt.trim()
          ? parsed.completedAt
          : undefined,
    };
  } catch {
    return { skippedSteps: [] };
  }
}

export function saveOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(STORAGE_KEY, "tasks", state),
  );
}

export function markOnboardingComplete() {
  const current = loadOnboardingState();
  saveOnboardingState({
    ...current,
    completedAt: new Date().toISOString(),
  });
}

export function addSkippedStep(stepId: string) {
  const current = loadOnboardingState();
  if (current.skippedSteps.includes(stepId)) return;
  saveOnboardingState({
    ...current,
    skippedSteps: [...current.skippedSteps, stepId],
  });
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return Boolean(state.completedAt);
}

/**
 * Derived check: does the workspace have enough data for us to assume
 * the user has configured the basics? Used to detect a first-time user
 * who hasn't touched the override flag yet.
 */
export function isWorkspaceBootstrapped(input: {
  office: Pick<OfficeSettings, "officeName">;
  appointmentTypes: AppointmentTypeConfig[];
  macroTemplates: MacroTemplate[];
  billingMacros: BillingMacroLibraryConfig;
}): boolean {
  if (!input.office.officeName.trim()) return false;
  if (input.appointmentTypes.length === 0) return false;
  if (input.macroTemplates.length < 4) return false;
  if (input.billingMacros.treatments.length === 0) return false;
  return true;
}

/**
 * SOAP coverage — returns true when every S/O/A/P section has at least one
 * macro. Used by the onboarding Step 4 gate and the persistent Setup
 * Checklist on the dashboard.
 */
export function hasMacroInEverySection(templates: MacroTemplate[]): boolean {
  const sections = new Set(templates.map((t) => t.section));
  return (
    sections.has("subjective") &&
    sections.has("objective") &&
    sections.has("assessment") &&
    sections.has("plan")
  );
}

/**
 * Starter pack of 7 generic SOAP macros — written per the handoff brief.
 * Bodies use double-bracket prompt slots (`[[name]]`) which the macro
 * template system already knows how to render. No hardcoded PII.
 *
 * Stored as a simplified shape so we can lazily import the full
 * `MacroTemplate` factory when the user commits to importing.
 */
export interface StarterMacroPackEntry {
  section: MacroTemplate["section"];
  buttonName: string;
  body: string;
}

export const starterMacroPack: StarterMacroPackEntry[] = [
  {
    section: "subjective",
    buttonName: "Pain Intake",
    body: "{{MR_MRS_MS_LAST_NAME}} reports pain in the [[region]] at [[pain_scale]]/10, frequency [[frequency]], aggravating factors [[aggravating]].",
  },
  {
    section: "subjective",
    buttonName: "Cervical Pain",
    body: "Patient reports neck pain rated [[pain_scale]]/10, with [[character]] quality. Radiating to [[radiation]].",
  },
  {
    section: "objective",
    buttonName: "Vitals",
    body: "BP [[bp]] · HR [[hr]] · Weight [[weight]] · Posture: [[posture]].",
  },
  {
    section: "objective",
    buttonName: "Cervical Exam",
    body: "ROM cervical: flexion [[flex]], extension [[ext]]. Palpation: [[findings]]. Ortho tests: [[tests]].",
  },
  {
    section: "assessment",
    buttonName: "Progress",
    body: "Patient demonstrates [[progress]] progress. Continue care plan.",
  },
  {
    section: "plan",
    buttonName: "Standard Visit",
    body: "Treatment today: [[treatment]]. Frequency: [[frequency]] visits/week for [[duration]] weeks. Next visit: [[next]].",
  },
  {
    section: "plan",
    buttonName: "Referral",
    body: "Refer to [[specialist]] for [[reason]]. Patient advised of next steps.",
  },
];

export const onboardingStorageKey = STORAGE_KEY;

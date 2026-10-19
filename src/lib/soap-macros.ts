import { isBlankStarterWorkspace } from "@/lib/workspace-starter";
import { soapMacroButtons } from "@/lib/mock-data";

export const soapSections = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;

export type SoapSection = (typeof soapSections)[number];

export type SoapMacroConfig = Record<SoapSection, string[]>;

export const soapSectionLabels: Record<SoapSection, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

const STORAGE_KEY = "casemate.soap-macros.v1";

function normalizeMacroList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const macros: string[] = [];

  value.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }

    const trimmed = item.trim();
    if (!trimmed) {
      return;
    }

    const lowered = trimmed.toLowerCase();
    if (seen.has(lowered)) {
      return;
    }

    seen.add(lowered);
    macros.push(trimmed);
  });

  return macros;
}

export function getDefaultSoapMacros(): SoapMacroConfig {
  if (isBlankStarterWorkspace()) {
    return { subjective: [], objective: [], assessment: [], plan: [] };
  }
  return {
    subjective: [...soapMacroButtons.subjective],
    objective: [...soapMacroButtons.objective],
    assessment: [...soapMacroButtons.assessment],
    plan: [...soapMacroButtons.plan],
  };
}

export function normalizeSoapMacros(value: unknown): SoapMacroConfig {
  const defaults = getDefaultSoapMacros();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const data = value as Partial<Record<SoapSection, unknown>>;
  const subjective = normalizeMacroList(data.subjective);
  const objective = normalizeMacroList(data.objective);
  const assessment = normalizeMacroList(data.assessment);
  const plan = normalizeMacroList(data.plan);

  return {
    subjective: subjective.length ? subjective : defaults.subjective,
    objective: objective.length ? objective : defaults.objective,
    assessment: assessment.length ? assessment : defaults.assessment,
    plan: plan.length ? plan : defaults.plan,
  };
}

export function loadSoapMacros(): SoapMacroConfig {
  if (typeof window === "undefined") {
    return getDefaultSoapMacros();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultSoapMacros();
    }

    return normalizeSoapMacros(JSON.parse(raw));
  } catch {
    return getDefaultSoapMacros();
  }
}

export function saveSoapMacros(config: SoapMacroConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", config));
}

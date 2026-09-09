import { statusOptions } from "@/lib/mock-data";

export interface CaseStatusConfig {
  name: string;
  showOnDashboard: boolean;
  color: string;
  isCaseClosed: boolean;
  /** When true, patient folders with this status are moved to a status-named folder in My Files. */
  autoFolder: boolean;
}

export type LienLabel = "Lien" | "LOP";

export interface CaseStatusSettings {
  statuses: CaseStatusConfig[];
  lienLabel: LienLabel;
  lienOptions: string[];
  /** User-managed list of "Review?" choices on the patient page.
   *  Same UX pattern as lienOptions — a small ordered list of labels
   *  that the patient page renders as a dropdown. Used so the office
   *  can later filter "patients I haven't asked for review yet". */
  reviewOptions: string[];
}

const STORAGE_KEY = "casemate.case-statuses.v1";
const fallbackColors = [
  "#1f9d60",
  "#5f75ff",
  "#f0a43f",
  "#f4e526",
  "#c9423a",
  "#80e74b",
  "#0d79bf",
];

const defaultStatusColorByName: Record<string, string> = {
  active: "#1f9d60",
  discharged: "#5f75ff",
  "ready to submit": "#f0a43f",
  submitted: "#f4e526",
  dropped: "#c9423a",
  paid: "#80e74b",
};
const defaultClosedStatusNames = new Set(["dropped", "paid"]);
const defaultLienLabel: LienLabel = "Lien";
const defaultLienOptions = ["Not Set", "Not Sent", "Requested", "Received"];
const defaultReviewOptions = ["Not Requested", "Requested", "Received"];

function normalizeStatusName(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeLienLabel(value: unknown): LienLabel {
  if (typeof value !== "string") {
    return defaultLienLabel;
  }
  return value.trim().toUpperCase() === "LOP" ? "LOP" : "Lien";
}

function normalizeLienOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...defaultLienOptions];
  }

  const seen = new Set<string>();
  const options = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return options.length ? options : [...defaultLienOptions];
}

function normalizeReviewOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...defaultReviewOptions];
  }
  const seen = new Set<string>();
  const options = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  return options.length ? options : [...defaultReviewOptions];
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return candidate.toLowerCase();
  }
  return fallback;
}

function getDefaultColorForStatus(name: string, index: number) {
  const mapped = defaultStatusColorByName[name.toLowerCase()];
  if (mapped) {
    return mapped;
  }
  return fallbackColors[index % fallbackColors.length];
}

const defaultAutoFolderNames = new Set(["dropped", "paid"]);

export function getDefaultCaseStatuses(): CaseStatusConfig[] {
  return statusOptions.map((name, index) => ({
    name,
    showOnDashboard: true,
    color: getDefaultColorForStatus(name, index),
    isCaseClosed: defaultClosedStatusNames.has(name.toLowerCase()),
    autoFolder: defaultAutoFolderNames.has(name.toLowerCase()),
  }));
}

export function getDefaultLienOptions() {
  return [...defaultLienOptions];
}

export function getDefaultReviewOptions() {
  return [...defaultReviewOptions];
}

export function getDefaultCaseStatusSettings(): CaseStatusSettings {
  return {
    statuses: getDefaultCaseStatuses(),
    lienLabel: defaultLienLabel,
    lienOptions: getDefaultLienOptions(),
    reviewOptions: getDefaultReviewOptions(),
  };
}

export function normalizeCaseStatuses(value: unknown): CaseStatusConfig[] {
  const defaults = getDefaultCaseStatuses();
  if (!Array.isArray(value)) {
    return defaults;
  }

  const seen = new Set<string>();
  const statuses: CaseStatusConfig[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const row = item as Partial<CaseStatusConfig>;
    const name = normalizeStatusName(row.name);
    if (!name) {
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    const fallbackColor = getDefaultColorForStatus(name, statuses.length);
    statuses.push({
      name,
      showOnDashboard: Boolean(row.showOnDashboard),
      color: normalizeColor((row as { color?: string }).color, fallbackColor),
      isCaseClosed:
        typeof (row as { isCaseClosed?: unknown }).isCaseClosed === "boolean"
          ? Boolean((row as { isCaseClosed?: unknown }).isCaseClosed)
          : defaultClosedStatusNames.has(name.toLowerCase()),
      autoFolder:
        typeof (row as { autoFolder?: unknown }).autoFolder === "boolean"
          ? Boolean((row as { autoFolder?: unknown }).autoFolder)
          : defaultAutoFolderNames.has(name.toLowerCase()),
    });
  });

  return statuses.length ? statuses : defaults;
}

export function normalizeCaseStatusSettings(value: unknown): CaseStatusSettings {
  const defaults = getDefaultCaseStatusSettings();

  if (Array.isArray(value)) {
    return {
      ...defaults,
      statuses: normalizeCaseStatuses(value),
    };
  }

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const payload = value as {
    statuses?: unknown;
    caseStatuses?: unknown;
    lienLabel?: unknown;
    lienOptions?: unknown;
    lien?: unknown;
    reviewOptions?: unknown;
  };

  const nestedLien = payload.lien && typeof payload.lien === "object"
    ? (payload.lien as { label?: unknown; options?: unknown })
    : undefined;
  const statusesSource = payload.statuses ?? payload.caseStatuses;
  const normalizedStatuses =
    typeof statusesSource === "undefined"
      ? defaults.statuses
      : normalizeCaseStatuses(statusesSource);

  return {
    statuses: normalizedStatuses,
    lienLabel: normalizeLienLabel(payload.lienLabel ?? nestedLien?.label),
    lienOptions: normalizeLienOptions(payload.lienOptions ?? nestedLien?.options),
    reviewOptions: normalizeReviewOptions(payload.reviewOptions),
  };
}

export function loadCaseStatusSettings(): CaseStatusSettings {
  if (typeof window === "undefined") {
    return getDefaultCaseStatusSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultCaseStatusSettings();
    }
    return normalizeCaseStatusSettings(JSON.parse(raw));
  } catch {
    return getDefaultCaseStatusSettings();
  }
}

export function saveCaseStatusSettings(settings: CaseStatusSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCaseStatusSettings(settings)));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "tasks", settings));
}

export function loadCaseStatuses(): CaseStatusConfig[] {
  return loadCaseStatusSettings().statuses;
}

export function saveCaseStatuses(statuses: CaseStatusConfig[]) {
  const current = loadCaseStatusSettings();
  saveCaseStatusSettings({
    ...current,
    statuses: normalizeCaseStatuses(statuses),
  });
}

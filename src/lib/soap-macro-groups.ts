/**
 * SOAP macro chips. Ungrouped Subjective is one "Complaints" group
 * (Headaches, then the body regions, then any chips the office added).
 * Other sections split the other chips from body-part chips. The other
 * group's name follows the section (Exam, Plan, …) or the office's folder
 * name when the macros sit in one. Body-part chips stay "Body regions".
 * Every chip uses the same button style.
 */

/** Subjective chip order. Anything else the office adds follows these. */
export const COMPLAINT_CHIP_ORDER = [
  "Headaches",
  "Cervical",
  "Thoracic",
  "Lumbar",
  "Chest",
  "Shoulder",
  "Arm/Forearm",
  "Elbow",
  "Wrist/Hand",
  "Hip",
  "Thigh",
  "Knee",
  "Lower Leg",
  "Ankle/Foot",
];

function complaintKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const COMPLAINT_RANK = new Map(COMPLAINT_CHIP_ORDER.map((name, index) => [complaintKey(name), index]));

/** Headaches and the body-region chips first; office-added chips keep their order after that. */
export function orderComplaintMacros<T extends { buttonName: string }>(macros: T[]): T[] {
  return macros
    .map((macro, index) => ({ macro, index, rank: COMPLAINT_RANK.get(complaintKey(macro.buttonName)) ?? 1000 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.macro);
}

const BODY_REGION_WORDS = new Set([
  "head",
  "tmj",
  "jaw",
  "neck",
  "cervical",
  "thoracic",
  "lumbar",
  "sacral",
  "sacroiliac",
  "si",
  "coccyx",
  "pelvis",
  "chest",
  "rib",
  "ribs",
  "shoulder",
  "arm",
  "elbow",
  "forearm",
  "wrist",
  "hand",
  "finger",
  "hip",
  "thigh",
  "knee",
  "leg",
  "ankle",
  "foot",
  "toe",
  "extremity",
  "spine",
]);

export function isBodyRegionMacroName(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  return words.some((word) => BODY_REGION_WORDS.has(word));
}

export type SoapMacroGroup<T> = {
  label: string;
  /** Kept so callers can still tell the groups apart. Unused chips are never muted. */
  quiet: boolean;
  macros: T[];
};

/**
 * Label for the chips that are not body regions. A folder the office named
 * wins (Plan → Treatments). Otherwise the section supplies one, so Objective
 * is not stuck under "History".
 */
const SECTION_NON_REGION_LABEL: Record<string, string> = {
  subjective: "History",
  objective: "Exam",
  assessment: "Assessment",
  plan: "Plan",
};

export function soapNonRegionLabel(section: string, folder?: string): string {
  const category = folder?.trim();
  if (category) return category;
  return SECTION_NON_REGION_LABEL[section] ?? "History";
}

export function groupSoapMacros<T extends { buttonName: string }>(
  macros: T[],
  nonRegionLabel = "History",
): SoapMacroGroup<T>[] {
  const history = macros.filter((macro) => !isBodyRegionMacroName(macro.buttonName));
  const regions = macros.filter((macro) => isBodyRegionMacroName(macro.buttonName));
  const groups: SoapMacroGroup<T>[] = [];
  if (history.length > 0) groups.push({ label: nonRegionLabel, quiet: false, macros: history });
  if (regions.length > 0) groups.push({ label: "Body regions", quiet: false, macros: regions });
  return groups;
}

/** Shared chip chrome. History and body regions look equally clickable. */
export function soapMacroChipClass(_quiet: boolean, dragging: boolean): string {
  return [
    "rounded-full border border-[var(--line-soft)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition-opacity",
    dragging ? "opacity-40" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

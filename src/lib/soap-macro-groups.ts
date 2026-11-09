/**
 * SOAP macro chips, option A: question-style chips (MVC HX, Vitals…) sit
 * under "History", body-part chips under "Body regions". History stays
 * visually quieter so the region the doctor reaches for reads first.
 */

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
  label: "History" | "Body regions";
  /** History chips are lighter so they don't compete with the region row. */
  quiet: boolean;
  macros: T[];
};

export function groupSoapMacros<T extends { buttonName: string }>(macros: T[]): SoapMacroGroup<T>[] {
  const history = macros.filter((macro) => !isBodyRegionMacroName(macro.buttonName));
  const regions = macros.filter((macro) => isBodyRegionMacroName(macro.buttonName));
  const groups: SoapMacroGroup<T>[] = [];
  if (history.length > 0) groups.push({ label: "History", quiet: true, macros: history });
  if (regions.length > 0) groups.push({ label: "Body regions", quiet: false, macros: regions });
  return groups;
}

/** Shared chip chrome. Quiet = history. */
export function soapMacroChipClass(quiet: boolean, dragging: boolean): string {
  return [
    "rounded-full border px-2.5 py-1 text-xs transition-opacity",
    quiet
      ? "border-[var(--line-soft)] bg-[#f7f9fb] font-medium text-[var(--text-muted)]"
      : "border-[#b7c9d6] bg-white font-semibold text-[var(--text-primary)]",
    dragging ? "opacity-40" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

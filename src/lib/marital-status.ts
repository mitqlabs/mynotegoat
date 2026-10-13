/** Marital status choices, in form order ("" = – / not set). "Other" is kept only for older records. */
export const maritalStatusOptions = ["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic Partner"] as const;
export type MaritalStatus = (typeof maritalStatusOptions)[number] | "Other";

/** Any stored / imported value → a known status, or undefined (blank). Never throws. */
export function normalizeMaritalStatus(value: unknown): MaritalStatus | undefined {
  const n = (typeof value === "string" ? value : "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (n === "single") return "Single";
  if (n === "married") return "Married";
  if (n === "divorced") return "Divorced";
  if (n === "separated") return "Separated";
  if (n === "widowed") return "Widowed";
  if (n === "domestic partner" || n === "domestic partnership") return "Domestic Partner";
  if (n === "other") return "Other";
  return undefined;
}

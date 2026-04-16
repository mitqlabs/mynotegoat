import {
  CONTACT_CATEGORIES,
  type ContactCategory,
} from "@/lib/mock-data";

/** Legacy storage key — still referenced during the one-time migration of
 *  the flat category list into the new sub-category map. */
const LEGACY_FLAT_CATEGORIES_KEY = "casemate.contact-categories.v1";

/** New storage: a map of top-level category → list of sub-category names. */
const SUBCATEGORIES_STORAGE_KEY = "casemate.contact-subcategories.v1";

export type ContactSubCategoryMap = Record<ContactCategory, string[]>;

const DEFAULT_SUBCATEGORIES: ContactSubCategoryMap = {
  Attorney: [],
  "Imaging Center": [],
  Specialist: ["Pain Management", "Orthopedic", "Neurologist", "Mental Health"],
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Legacy → new top-level category mapping. Covers every category string
 * that used to live in the flat list before the Attorney / Imaging Center
 * / Specialist refactor. Returns the normalized { category, subCategory }
 * pair. Anything unrecognized is treated as a Specialist sub-category so
 * no referrals are silently dropped.
 */
export function migrateLegacyCategory(
  raw: string,
): { category: ContactCategory; subCategory?: string } {
  const normalized = normalizeLookup(raw);

  if (!normalized) return { category: "Attorney" };

  if (normalized === "attorney") return { category: "Attorney" };

  if (
    normalized === "imaging" ||
    normalized === "imaging center" ||
    normalized === "radiology" ||
    normalized === "mri" ||
    normalized === "ct" ||
    normalized === "x-ray" ||
    normalized === "xray"
  ) {
    return { category: "Imaging Center" };
  }

  if (normalized === "specialist") return { category: "Specialist" };

  // Everything else goes under Specialist with the original label as
  // sub-category. Covers "Pain Management", "Orthopedic", "Neurologist",
  // "Hospital/ER", "Mental Health", etc.
  const pretty = normalizeText(raw);
  return { category: "Specialist", subCategory: pretty || undefined };
}

export function getDefaultContactSubCategories(): ContactSubCategoryMap {
  return {
    Attorney: [...DEFAULT_SUBCATEGORIES.Attorney],
    "Imaging Center": [...DEFAULT_SUBCATEGORIES["Imaging Center"]],
    Specialist: [...DEFAULT_SUBCATEGORIES.Specialist],
  };
}

function normalizeSubCategoryMap(value: unknown): ContactSubCategoryMap {
  const base = getDefaultContactSubCategories();
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;

  for (const key of CONTACT_CATEGORIES) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const entry of list) {
      const name = normalizeText(entry);
      if (!name) continue;
      const dedupe = name.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      cleaned.push(name);
    }
    base[key] = cleaned.length ? cleaned : base[key];
  }
  return base;
}

export function loadContactSubCategories(): ContactSubCategoryMap {
  if (typeof window === "undefined") return getDefaultContactSubCategories();

  try {
    // New-format read first
    const raw = window.localStorage.getItem(SUBCATEGORIES_STORAGE_KEY);
    if (raw) return normalizeSubCategoryMap(JSON.parse(raw));

    // Migration: if there's a legacy flat category list, promote every
    // non-top-level value into the Specialist sub-category bucket so the
    // user doesn't lose their custom labels on upgrade.
    const legacyRaw = window.localStorage.getItem(LEGACY_FLAT_CATEGORIES_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed)) {
        const migrated = getDefaultContactSubCategories();
        for (const entry of parsed) {
          const str = normalizeText(entry);
          if (!str) continue;
          const result = migrateLegacyCategory(str);
          if (
            result.subCategory &&
            !migrated[result.category].some(
              (existing) => existing.toLowerCase() === result.subCategory!.toLowerCase(),
            )
          ) {
            migrated[result.category].push(result.subCategory);
          }
        }
        saveContactSubCategories(migrated);
        return migrated;
      }
    }

    return getDefaultContactSubCategories();
  } catch {
    return getDefaultContactSubCategories();
  }
}

export function saveContactSubCategories(map: ContactSubCategoryMap): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeSubCategoryMap(map);
  window.localStorage.setItem(
    SUBCATEGORIES_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  void import("@/lib/kv-cloud").then((m) =>
    m.dualWriteKv(SUBCATEGORIES_STORAGE_KEY, "contacts", normalized),
  );
}

/** Coerce any string into one of the 3 fixed top-level categories.
 *  Legacy strings like "Pain Management" collapse to "Specialist". */
export function sanitizeContactCategory(value: unknown): ContactCategory {
  const str = normalizeText(value);
  if (!str) return "Attorney";
  const { category } = migrateLegacyCategory(str);
  return category;
}

/** For the ContactGapPrompt / UI — given a free-form category hint, figure
 *  out the right top-level category and pre-fill sub-category if the hint
 *  was actually a legacy sub-category label. */
export function resolveCategoryHint(hint: string | undefined): {
  category: ContactCategory;
  subCategory?: string;
} {
  if (!hint) return { category: "Attorney" };
  return migrateLegacyCategory(hint);
}

// The old function names some files still reference — kept as thin
// wrappers so touching less code during the refactor still works. The
// exported `CONTACT_CATEGORIES` from mock-data is the authoritative list.
export { CONTACT_CATEGORIES } from "@/lib/mock-data";

/** Kept for backward compat with any lingering imports. Returns the
 *  FIXED three-tier top-level list — not user-editable. */
export function getDefaultContactCategories(): ContactCategory[] {
  return [...CONTACT_CATEGORIES];
}

/** Kept for backward compat. The flat categories list is no longer
 *  editable — this always returns the fixed top-level list. */
export function loadContactCategories(): ContactCategory[] {
  return [...CONTACT_CATEGORIES];
}

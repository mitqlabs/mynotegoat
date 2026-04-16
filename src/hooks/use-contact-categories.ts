"use client";

import { useCallback, useState } from "react";
import {
  CONTACT_CATEGORIES,
  type ContactCategory,
} from "@/lib/mock-data";
import {
  type ContactSubCategoryMap,
  getDefaultContactSubCategories,
  loadContactSubCategories,
  saveContactSubCategories,
} from "@/lib/contact-categories";

type MutateResult = { ok: true } | { ok: false; reason: string };

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Contact categories hook.
 *
 * Top-level categories are FIXED — Attorney, Imaging Center, Specialist —
 * and cannot be added, renamed, or removed. Users can only manage
 * sub-categories under each top-level (e.g. adding "Mental Health" under
 * Specialist).
 *
 * The `categories` field is returned for backward compatibility with code
 * that used to iterate the flat list; it now returns the fixed three.
 */
export function useContactCategories() {
  const [subCategories, setSubCategories] = useState<ContactSubCategoryMap>(
    () => loadContactSubCategories(),
  );

  const persist = useCallback(
    (updater: (current: ContactSubCategoryMap) => ContactSubCategoryMap) => {
      setSubCategories((current) => {
        const next = updater(current);
        saveContactSubCategories(next);
        return next;
      });
    },
    [],
  );

  const addSubCategory = useCallback(
    (category: ContactCategory, label: string): MutateResult => {
      const name = normalizeText(label);
      if (!name) {
        return { ok: false, reason: "Sub-category name is required." };
      }
      let wasAdded = false;
      persist((current) => {
        const list = current[category] ?? [];
        if (list.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
          return current;
        }
        wasAdded = true;
        return { ...current, [category]: [...list, name] };
      });
      return wasAdded
        ? { ok: true }
        : { ok: false, reason: "Sub-category already exists." };
    },
    [persist],
  );

  const removeSubCategory = useCallback(
    (category: ContactCategory, label: string): MutateResult => {
      const target = normalizeText(label).toLowerCase();
      if (!target) {
        return { ok: false, reason: "Sub-category is required." };
      }
      let removed = false;
      persist((current) => {
        const list = current[category] ?? [];
        const filtered = list.filter(
          (entry) => entry.toLowerCase() !== target,
        );
        if (filtered.length === list.length) return current;
        removed = true;
        return { ...current, [category]: filtered };
      });
      return removed
        ? { ok: true }
        : { ok: false, reason: "Sub-category not found." };
    },
    [persist],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultContactSubCategories();
    setSubCategories(defaults);
    saveContactSubCategories(defaults);
  }, []);

  return {
    /** Fixed top-level list (read-only). */
    categories: CONTACT_CATEGORIES,
    /** Sub-category map keyed by top-level category. */
    subCategories,
    addSubCategory,
    removeSubCategory,
    resetToDefaults,
  };
}

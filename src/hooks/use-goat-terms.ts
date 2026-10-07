"use client";

import { useCallback, useEffect, useState } from "react";
import { markLocalWrite, notifyChange, onLocalChange } from "@/lib/local-sync";
import {
  DEFAULT_GOAT_TERM_GROUPS,
  GOAT_TERMS_STORAGE_KEY,
  cleanTerms,
  createGoatTermGroupId,
  loadGoatTermGroups,
  loadStoredGoatTermGroups,
  saveGoatTermGroups,
  type GoatTermGroup,
} from "@/lib/goat-terms";

/** G.O.A.T. words & synonym groups for this office (Settings → G.O.A.T.). */
export function useGoatTerms() {
  const [groups, setGroups] = useState<GoatTermGroup[]>(() => loadGoatTermGroups());

  // Pick up edits from other screens / devices (cloud hydration writes the key).
  useEffect(() => onLocalChange(GOAT_TERMS_STORAGE_KEY, () => setGroups(loadGoatTermGroups())), []);

  const persist = useCallback((next: GoatTermGroup[]) => {
    markLocalWrite(GOAT_TERMS_STORAGE_KEY);
    saveGoatTermGroups(next);
    setGroups(next.filter((g) => !g.deleted));
    notifyChange(GOAT_TERMS_STORAGE_KEY);
  }, []);

  const addGroup = useCallback(
    (terms: string[]) => {
      const clean = cleanTerms(terms);
      if (!clean.length) return false;
      persist([{ id: createGoatTermGroupId(), terms: clean, updatedAt: new Date().toISOString() }, ...loadStoredGoatTermGroups()]);
      return true;
    },
    [persist],
  );

  const updateGroup = useCallback(
    (id: string, terms: string[]) => {
      const clean = cleanTerms(terms);
      if (!clean.length) return false;
      persist(loadStoredGoatTermGroups().map((g) => (g.id === id ? { ...g, terms: clean, updatedAt: new Date().toISOString() } : g)));
      return true;
    },
    [persist],
  );

  const deleteGroup = useCallback(
    (id: string) =>
      persist(loadStoredGoatTermGroups().map((g) => (g.id === id ? { ...g, deleted: true, updatedAt: new Date().toISOString() } : g))),
    [persist],
  );

  // Seeds come back as they were; the office's own groups become tombstones.
  const resetToDefaults = useCallback(() => {
    const now = new Date().toISOString();
    const seedIds = new Set(DEFAULT_GOAT_TERM_GROUPS.map((g) => g.id));
    const own = loadStoredGoatTermGroups()
      .filter((g) => !seedIds.has(g.id))
      .map((g) => ({ ...g, deleted: true, updatedAt: now }));
    persist([...DEFAULT_GOAT_TERM_GROUPS.map((g) => ({ ...g, terms: [...g.terms], updatedAt: now })), ...own]);
  }, [persist]);

  return { groups, addGroup, updateGroup, deleteGroup, resetToDefaults };
}

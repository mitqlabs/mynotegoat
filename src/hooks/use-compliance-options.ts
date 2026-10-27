"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMPLIANCE_OPTIONS_KEY,
  addComplianceOption,
  liveComplianceOptions,
  loadComplianceOptions,
  removeComplianceOption,
  renameComplianceOption,
  resetComplianceOptions,
  saveComplianceOptions,
  setComplianceOptionColor,
  setComplianceOptionShown,
  shownComplianceOptions,
  type ComplianceOption,
} from "@/lib/compliance";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

/**
 * The office's editable Compliance options (Settings → Case Status Categories).
 * Cloud-merged: every edit is stamped and merged with the cloud copy before it is
 * written, so another device's edits are never overwritten by a stale copy.
 */
export function useComplianceOptions() {
  const [options, setOptions] = useState<ComplianceOption[]>(() => loadComplianceOptions());
  useEffect(() => onLocalChange(COMPLIANCE_OPTIONS_KEY, () => setOptions(loadComplianceOptions())), []);

  const apply = useCallback((edit: (current: ComplianceOption[], now: string) => ComplianceOption[]) => {
    const current = loadComplianceOptions();
    const next = edit(current, new Date().toISOString());
    if (next === current) return;
    setOptions(next);
    void saveComplianceOptions(next)
      .then(() => notifyChange(COMPLIANCE_OPTIONS_KEY))
      .catch((err: unknown) => console.error("[compliance] saving options failed:", err));
  }, []);

  return {
    /** Every record, including removed ones (tombstones). */
    allOptions: options,
    /** Options that aren't removed, in order. */
    options: useMemo(() => liveComplianceOptions(options), [options]),
    /** Options to offer in pickers/filters (live and "Show" on). */
    shownOptions: useMemo(() => shownComplianceOptions(options), [options]),
    addOption: useCallback((label: string, color: string) => apply((c, now) => addComplianceOption(c, label, color, now)), [apply]),
    renameOption: useCallback((id: string, label: string) => apply((c, now) => renameComplianceOption(c, id, label, now)), [apply]),
    setOptionColor: useCallback((id: string, color: string) => apply((c, now) => setComplianceOptionColor(c, id, color, now)), [apply]),
    setOptionShown: useCallback((id: string, show: boolean) => apply((c, now) => setComplianceOptionShown(c, id, show, now)), [apply]),
    removeOption: useCallback((id: string) => apply((c, now) => removeComplianceOption(c, id, now)), [apply]),
    resetOptions: useCallback(() => apply((c, now) => resetComplianceOptions(c, now)), [apply]),
  };
}

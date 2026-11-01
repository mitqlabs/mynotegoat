"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MARKETING_REPS_KEY,
  addMarketingRep,
  liveMarketingReps,
  loadMarketingReps,
  moveMarketingRep,
  removeMarketingRep,
  renameMarketingRep,
  saveMarketingReps,
  type MarketingRep,
} from "@/lib/marketing-reps";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

/**
 * The office's "Our Rep" list for Marketing (Settings → Marketing).
 * Cloud-merged: every edit is stamped and merged with the cloud copy before it
 * is written, so another device's edits are never overwritten by a stale copy.
 */
export function useMarketingReps() {
  const [reps, setReps] = useState<MarketingRep[]>(() => loadMarketingReps());
  useEffect(() => onLocalChange(MARKETING_REPS_KEY, () => setReps(loadMarketingReps())), []);

  const apply = useCallback((edit: (current: MarketingRep[], now: string) => MarketingRep[]) => {
    const current = loadMarketingReps();
    const next = edit(current, new Date().toISOString());
    if (next === current) return;
    setReps(next);
    void saveMarketingReps(next)
      .then(() => notifyChange(MARKETING_REPS_KEY))
      .catch((err: unknown) => console.error("[marketing] saving reps failed:", err));
  }, []);

  return {
    allReps: reps,
    reps: useMemo(() => liveMarketingReps(reps), [reps]),
    addRep: useCallback((name: string) => apply((c, now) => addMarketingRep(c, name, now)), [apply]),
    renameRep: useCallback((id: string, name: string) => apply((c, now) => renameMarketingRep(c, id, name, now)), [apply]),
    removeRep: useCallback((id: string) => apply((c, now) => removeMarketingRep(c, id, now)), [apply]),
    moveRep: useCallback((id: string, dir: -1 | 1) => apply((c, now) => moveMarketingRep(c, id, dir, now)), [apply]),
  };
}

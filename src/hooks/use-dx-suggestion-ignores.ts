"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DX_IGNORES_KEY,
  dxIgnoreId,
  loadDxIgnores,
  mergeDxIgnores,
  saveDxIgnores,
  setDxIgnored,
  type DxIgnoreRecord,
  type DxSuggestSource,
} from "@/lib/dx-suggestion-ignores";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { actorLabel } from "@/lib/activity-log";

/** A patient's ignored G.O.A.T. Dx suggestions, cloud-merged. */
export function useDxSuggestionIgnores(patientId: string) {
  const [records, setRecords] = useState<DxIgnoreRecord[]>(() => loadDxIgnores());
  useEffect(() => onLocalChange(DX_IGNORES_KEY, () => setRecords(loadDxIgnores())), []);
  useEffect(() => {
    let off = false;
    void import("@/lib/kv-cloud")
      .then((kv) => kv.fetchKvValue<unknown>(DX_IGNORES_KEY))
      .then((remote) => {
        if (off || remote == null) return;
        const merged = mergeDxIgnores(loadDxIgnores(), remote);
        try {
          window.localStorage.setItem(DX_IGNORES_KEY, JSON.stringify(merged));
        } catch {
          /* cache only */
        }
        setRecords(merged);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);
  const apply = useCallback(
    (source: DxSuggestSource, code: string, ignored: boolean, label?: string) => {
      const next = setDxIgnored(loadDxIgnores(), dxIgnoreId(patientId, source, code), ignored, actorLabel(), new Date().toISOString(), label);
      setRecords(next);
      void saveDxIgnores(next).then(() => notifyChange(DX_IGNORES_KEY));
    },
    [patientId],
  );
  const ignoredIds = useMemo(() => new Set(records.filter((r) => r.ignored).map((r) => r.id)), [records]);
  const isIgnored = useCallback((source: DxSuggestSource, code: string) => ignoredIds.has(dxIgnoreId(patientId, source, code)), [ignoredIds, patientId]);
  return {
    isIgnored,
    ignore: useCallback((source: DxSuggestSource, code: string, label?: string) => apply(source, code, true, label), [apply]),
    restore: useCallback((source: DxSuggestSource, code: string) => apply(source, code, false), [apply]),
  };
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CLEARED_TASKS_KEY, clearedIdSet, loadClearedRecords, mergeClearedRecords, saveClearedRecords, setCleared, type ClearedRecord } from "@/lib/cleared-tasks";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { actorLabel } from "@/lib/activity-log";

/** Case Flow / To-Do "Clear task" records, cloud-merged, with who/when. */
export function useClearedTasks() {
  const [records, setRecords] = useState<ClearedRecord[]>(() => loadClearedRecords());
  useEffect(() => onLocalChange(CLEARED_TASKS_KEY, () => setRecords(loadClearedRecords())), []);
  useEffect(() => {
    let off = false;
    void import("@/lib/kv-cloud")
      .then((kv) => kv.fetchKvValue<unknown>(CLEARED_TASKS_KEY))
      .then((remote) => {
        if (off || remote == null) return;
        const merged = mergeClearedRecords(loadClearedRecords(), remote);
        window.localStorage.setItem(CLEARED_TASKS_KEY, JSON.stringify(merged));
        setRecords(merged);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);
  const apply = useCallback(
    (id: string, cleared: boolean, label?: string) => {
      const next = setCleared(loadClearedRecords(), id, cleared, actorLabel(), new Date().toISOString(), label);
      setRecords(next);
      void saveClearedRecords(next).then(() => notifyChange(CLEARED_TASKS_KEY));
    },
    [],
  );
  const clearedIds = useMemo(() => clearedIdSet(records), [records]);
  return {
    records,
    clearedIds,
    clearedList: useMemo(() => records.filter((r) => r.cleared).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [records]),
    clear: useCallback((id: string, label?: string) => apply(id, true, label), [apply]),
    restore: useCallback((id: string) => apply(id, false), [apply]),
  };
}

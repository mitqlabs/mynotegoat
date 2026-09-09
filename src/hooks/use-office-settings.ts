"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDefaultOfficeSettings,
  loadOfficeSettings,
  pushOfficeSettingsCloud,
  writeOfficeSettingsLocal,
  STORAGE_KEY_OFFICE_SETTINGS,
  type OfficeSettings,
} from "@/lib/office-settings";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useOfficeSettings() {
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(() => loadOfficeSettings());
  const selfWriteCountRef = useRef(0);
  // Debounced persistence. Typing only touches React state (instant); the
  // heavy work — localStorage write, cloud dual-write, and the cross-instance
  // notify that re-renders the (large) settings page — is deferred until the
  // user pauses. Without this, every keystroke re-rendered the whole page and
  // characters/spaces got dropped.
  const pendingRef = useRef<OfficeSettings | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = pendingRef.current;
    if (!next) return;
    pendingRef.current = null;
    writeOfficeSettingsLocal(next);
    pushOfficeSettingsCloud(next);
    selfWriteCountRef.current++;
    notifyChange(STORAGE_KEY_OFFICE_SETTINGS);
  }, []);

  const schedulePersist = useCallback(
    (next: OfficeSettings) => {
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 400);
    },
    [flush],
  );

  // Keep every mounted instance in sync. Without this, two components each
  // holding independent office-settings state would clobber each other's
  // fields on save (each does a full-object {...current, ...patch} write).
  // Flush any pending write on unmount so a fast navigation never loses it.
  useEffect(() => {
    const unsub = onLocalChange(STORAGE_KEY_OFFICE_SETTINGS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      // A foreign change lands; don't clobber it with our stale pending edit.
      pendingRef.current = null;
      setOfficeSettings(loadOfficeSettings());
    });
    return () => {
      unsub();
      flush();
    };
  }, [flush]);

  const updateOfficeSettings = useCallback(
    (patch: Partial<OfficeSettings>) => {
      setOfficeSettings((current) => {
        const next = { ...current, ...patch };
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultOfficeSettings();
    setOfficeSettings(defaults);
    schedulePersist(defaults);
    flush();
  }, [schedulePersist, flush]);

  return {
    officeSettings,
    updateOfficeSettings,
    resetToDefaults,
  };
}

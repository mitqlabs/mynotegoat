"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_ACCESS_KEY,
  defaultAdminAccess,
  normalizeAdminAccess,
  type AdminAccessSettings,
} from "@/lib/admin-access";

/**
 * Admin Access settings (who may see which Dashboard sections, which deletes
 * a manager may do, the delete password hash).
 *
 * Cached in localStorage so checks are instant on first paint, then refreshed
 * from the cloud so a change by an admin reaches every device.
 */
function readCache(): AdminAccessSettings {
  if (typeof window === "undefined") return defaultAdminAccess();
  try {
    const raw = window.localStorage.getItem(ADMIN_ACCESS_KEY);
    return raw ? normalizeAdminAccess(JSON.parse(raw)) : defaultAdminAccess();
  } catch {
    return defaultAdminAccess();
  }
}

export function useAdminAccess() {
  const [settings, setSettings] = useState<AdminAccessSettings>(() => readCache());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { fetchKvValue } = await import("@/lib/kv-cloud");
      const remote = await fetchKvValue<unknown>(ADMIN_ACCESS_KEY);
      if (cancelled || remote === null || remote === undefined) return;
      const next = normalizeAdminAccess(remote);
      setSettings(next);
      try {
        window.localStorage.setItem(ADMIN_ACCESS_KEY, JSON.stringify(next));
      } catch {
        // Cache only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: AdminAccessSettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(ADMIN_ACCESS_KEY, JSON.stringify(next));
    } catch {
      // Cache only.
    }
    const { upsertKvValue } = await import("@/lib/kv-cloud");
    await upsertKvValue(ADMIN_ACCESS_KEY, next);
  }, []);

  return { adminAccess: settings, saveAdminAccess: save };
}

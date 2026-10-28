"use client";

import { useCallback, useEffect, useState } from "react";
import { type AdminAccessSettings } from "@/lib/admin-access";
import {
  fetchAccessFromCloud,
  readCachedAccess,
  saveRoleDefinitions,
  saveSecuritySettings,
  type SaveResult,
} from "@/lib/role-settings-store";

/**
 * Roles & Permissions settings (what each role may open, add, edit and delete, which
 * Dashboard sections a manager sees) plus the delete password.
 *
 * A cached copy gives instant checks on first paint, then the cloud copy replaces it so
 * a change by the owner reaches every device.
 */
export function useAdminAccess() {
  const [settings, setSettings] = useState<AdminAccessSettings>(() => readCachedAccess());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remote = await fetchAccessFromCloud();
      if (cancelled || !remote) return;
      setSettings(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Save the role definitions. Reverts to the cloud copy if the database refused it. */
  const saveRoles = useCallback(async (next: AdminAccessSettings): Promise<SaveResult> => {
    setSettings(next);
    const result = await saveRoleDefinitions(next);
    if (!result.ok) {
      const remote = await fetchAccessFromCloud();
      setSettings(remote ?? readCachedAccess());
    }
    return result;
  }, []);

  /** Save the delete password settings. */
  const saveSecurity = useCallback(async (next: AdminAccessSettings): Promise<SaveResult> => {
    setSettings(next);
    return saveSecuritySettings(next);
  }, []);

  return { adminAccess: settings, saveRoles, saveSecurity };
}

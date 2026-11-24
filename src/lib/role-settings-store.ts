"use client";

/**
 * Cloud storage for Roles & Permissions.
 *
 *  - ROLE_SETTINGS_KEY   the role definitions (pages, actions, deletes, dashboard sections).
 *                        The database only lets the owner (or Admins, if the owner allows)
 *                        change this row.
 *  - ADMIN_ACCESS_KEY    the delete password. Admins may change it.
 *
 * Both are workspace_kv rows (cloud). localStorage only holds a copy of what the cloud
 * returned, so the first paint is instant. We never write a copy of a row that doesn't
 * exist in the cloud yet (a team member must not create the owner's role row).
 */

import {
  ADMIN_ACCESS_KEY,
  ROLE_SETTINGS_KEY,
  defaultAdminAccess,
  mergeStoredAccess,
  roleDefinitionsOf,
  type AdminAccessSettings,
} from "@/lib/admin-access";

function readLocal(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache only.
  }
}

/** The last copy we saw (or the defaults) — never touches the network. */
export function readCachedAccess(): AdminAccessSettings {
  if (typeof window === "undefined") return defaultAdminAccess();
  return mergeStoredAccess(readLocal(ADMIN_ACCESS_KEY), readLocal(ROLE_SETTINGS_KEY));
}

/** Fetch both rows from the cloud. Returns null when the cloud can't be reached. */
export async function fetchAccessFromCloud(): Promise<AdminAccessSettings | null> {
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const [adminRow, roleRow] = await Promise.all([
      fetchKvValue<unknown>(ADMIN_ACCESS_KEY),
      fetchKvValue<unknown>(ROLE_SETTINGS_KEY),
    ]);
    if (adminRow !== null && adminRow !== undefined) writeLocal(ADMIN_ACCESS_KEY, adminRow);
    if (roleRow !== null && roleRow !== undefined) writeLocal(ROLE_SETTINGS_KEY, roleRow);
    return mergeStoredAccess(adminRow, roleRow);
  } catch {
    return null;
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Save the role definitions, then read the row back. The database quietly ignores a write from
 * someone who isn't allowed to change roles, so a save only counts when the cloud now holds it.
 */
export async function saveRoleDefinitions(next: AdminAccessSettings): Promise<SaveResult> {
  const definitions = roleDefinitionsOf(next);
  try {
    const { upsertKvValue, fetchKvValue } = await import("@/lib/kv-cloud");
    await upsertKvValue(ROLE_SETTINGS_KEY, definitions);
    const stored = await fetchKvValue<unknown>(ROLE_SETTINGS_KEY);
    if (!stored || JSON.stringify(roleDefinitionsOf(mergeStoredAccess(null, stored))) !== JSON.stringify(definitions)) {
      return { ok: false, error: "Not saved — only the office owner can change what each role is allowed to do." };
    }
    writeLocal(ROLE_SETTINGS_KEY, stored);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't save." };
  }
}

/** Save the delete password settings (Admins may do this). Role fields ride along so older copies stay in step. */
export async function saveSecuritySettings(next: AdminAccessSettings): Promise<SaveResult> {
  try {
    const { upsertKvValue, fetchKvValue } = await import("@/lib/kv-cloud");
    // Keep whatever else the older Admin Access row holds (role values set before roles had their own row).
    const existing = await fetchKvValue<Record<string, unknown>>(ADMIN_ACCESS_KEY);
    const payload = {
      ...(existing && typeof existing === "object" ? existing : {}),
      passwordAppliesToAdmins: next.passwordAppliesToAdmins,
      deletePasswordHash: next.deletePasswordHash,
      deletePasswordSalt: next.deletePasswordSalt,
    };
    await upsertKvValue(ADMIN_ACCESS_KEY, payload);
    writeLocal(ADMIN_ACCESS_KEY, payload);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't save." };
  }
}

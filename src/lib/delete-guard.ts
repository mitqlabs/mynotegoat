"use client";

/**
 * One gate for "may this person delete this?".
 *
 * Roles come from the member's role (Settings → Team); the rules come from
 * Settings → Roles & Permissions. Returns true when the delete may proceed — call
 * it before your own "are you sure?" confirm.
 *
 * Honest limitation: this runs in the browser, so it prevents mistakes and
 * casual overreach, not a determined technical user. Database-level rules
 * are the airtight version and are a separate piece of work.
 */

import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { loadOfficeSettings, STORAGE_KEY_OFFICE_SETTINGS } from "@/lib/office-settings";
import {
  DELETABLE_KINDS,
  defaultAdminAccess,
  deleteRuleFor,
  roleTierOf,
  checkDeletePassword,
  type DeletePasswordCheck,
  type AdminAccessSettings,
  type DeletableKind,
} from "@/lib/admin-access";
import { appAlert, appPrompt } from "@/components/app-dialog";

/** The first-generation plaintext password in Office settings (cloud copy first, then this device). */
async function officeDeletePassword(): Promise<string> {
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const remote = await fetchKvValue<unknown>(STORAGE_KEY_OFFICE_SETTINGS);
    if (remote && typeof remote === "object") {
      const pw = (remote as { deletePassword?: unknown }).deletePassword;
      if (typeof pw === "string" && pw.trim()) return pw.trim();
    }
  } catch {
    // Fall through to this device's copy.
  }
  try {
    return (loadOfficeSettings().deletePassword ?? "").trim();
  } catch {
    return "";
  }
}

const kindLabel = (kind: DeletableKind) =>
  DELETABLE_KINDS.find((k) => k.key === kind)?.label.toLowerCase() ?? "this";

async function currentSettings(): Promise<AdminAccessSettings> {
  // Cloud first (both rows), then the cached copy, then the defaults.
  const { fetchAccessFromCloud, readCachedAccess } = await import("@/lib/role-settings-store");
  return (await fetchAccessFromCloud()) ?? readCachedAccess() ?? defaultAdminAccess();
}

/**
 * Check a typed delete password against the office's one password (cloud
 * Admin Access hash, or the older Office-settings copy). Used by the patient
 * delete window, which has its own password box.
 */
export async function checkOfficeDeletePassword(attempt: string): Promise<DeletePasswordCheck> {
  const settings = await currentSettings();
  return checkDeletePassword(settings, await officeDeletePassword(), attempt);
}

export async function ensureDeleteAllowed(
  kind: DeletableKind,
  options: { passwordAlreadyAsked?: boolean } = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const tier = roleTierOf(getCurrentMembershipSync());
  const settings = await currentSettings();
  const rule = deleteRuleFor(tier, kind, settings);
  if (rule === "allowed") return true;
  // The caller has its own password box and will check the password itself.
  if (rule === "password" && options.passwordAlreadyAsked) return true;
  if (rule === "never") {
    (await appAlert(`Your role can't delete ${kindLabel(kind)}. Ask an admin.`));
    return false;
  }
  // Falls back to the office delete password (Settings → Office), the one
  // that already guards patient deletes, so there aren't two secrets.
  const officePassword = await officeDeletePassword();
  if (!settings.deletePasswordHash && !officePassword) {
    (await appAlert(`Deleting ${kindLabel(kind)} needs the delete password, and none has been set yet. An admin can set one in Settings → Roles & Permissions.`));
    return false;
  }
  const attempt = (await appPrompt(`Enter the delete password to delete ${kindLabel(kind)}.`, { title: "Delete password", inputType: "password", confirmLabel: "Delete" })) ?? "";
  if (!attempt) return false;
  if ((await checkDeletePassword(settings, officePassword, attempt)) === "ok") return true;
  (await appAlert("That password isn't right."));
  return false;
}

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
import { loadOfficeSettings } from "@/lib/office-settings";
import {
  DELETABLE_KINDS,
  defaultAdminAccess,
  deleteRuleFor,
  roleTierOf,
  verifyDeletePassword,
  type AdminAccessSettings,
  type DeletableKind,
} from "@/lib/admin-access";
import { appAlert, appPrompt } from "@/components/app-dialog";

function officeDeletePassword(): string {
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

export async function ensureDeleteAllowed(kind: DeletableKind): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const tier = roleTierOf(getCurrentMembershipSync());
  const settings = await currentSettings();
  const rule = deleteRuleFor(tier, kind, settings);
  if (rule === "allowed") return true;
  if (rule === "never") {
    (await appAlert(`Your role can't delete ${kindLabel(kind)}. Ask an admin.`));
    return false;
  }
  // Falls back to the office delete password (Settings → Office), the one
  // that already guards patient deletes, so there aren't two secrets.
  const officePassword = officeDeletePassword();
  if (!settings.deletePasswordHash && !officePassword) {
    (await appAlert(`Deleting ${kindLabel(kind)} needs the delete password, and none has been set yet. An admin can set one in Settings → Roles & Permissions.`));
    return false;
  }
  const attempt = (await appPrompt(`Enter the delete password to delete ${kindLabel(kind)}.`, { title: "Delete password", inputType: "password", confirmLabel: "Delete" })) ?? "";
  if (!attempt) return false;
  if (officePassword && attempt === officePassword) return true;
  if (settings.deletePasswordHash && (await verifyDeletePassword(settings, attempt))) return true;
  (await appAlert("That password isn't right."));
  return false;
}

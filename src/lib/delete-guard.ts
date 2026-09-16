"use client";

/**
 * One gate for "may this person delete this?".
 *
 * Roles come from the member's role (Settings → Team); the rules come from
 * Settings → Admin Access. Returns true when the delete may proceed — call
 * it before your own "are you sure?" confirm.
 *
 * Honest limitation: this runs in the browser, so it prevents mistakes and
 * casual overreach, not a determined technical user. Database-level rules
 * are the airtight version and are a separate piece of work.
 */

import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { loadOfficeSettings } from "@/lib/office-settings";
import {
  ADMIN_ACCESS_KEY,
  DELETABLE_KINDS,
  defaultAdminAccess,
  deleteRuleFor,
  normalizeAdminAccess,
  roleTierOf,
  verifyDeletePassword,
  type AdminAccessSettings,
  type DeletableKind,
} from "@/lib/admin-access";

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
  try {
    const { fetchKvValue } = await import("@/lib/kv-cloud");
    const remote = await fetchKvValue<unknown>(ADMIN_ACCESS_KEY);
    if (remote !== null && remote !== undefined) return normalizeAdminAccess(remote);
  } catch {
    // Fall through to the cached copy.
  }
  try {
    const raw = window.localStorage.getItem(ADMIN_ACCESS_KEY);
    if (raw) return normalizeAdminAccess(JSON.parse(raw));
  } catch {
    // Fall through to defaults.
  }
  return defaultAdminAccess();
}

export async function ensureDeleteAllowed(kind: DeletableKind): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const tier = roleTierOf(getCurrentMembershipSync());
  const settings = await currentSettings();
  const rule = deleteRuleFor(tier, kind, settings);
  if (rule === "allowed") return true;
  if (rule === "never") {
    window.alert(`Your role can't delete ${kindLabel(kind)}. Ask an admin.`);
    return false;
  }
  // Falls back to the office delete password (Settings → Office), the one
  // that already guards patient deletes, so there aren't two secrets.
  const officePassword = officeDeletePassword();
  if (!settings.deletePasswordHash && !officePassword) {
    window.alert(
      `Deleting ${kindLabel(kind)} needs the delete password, and none has been set yet. An admin can set one in Settings → Admin Access.`,
    );
    return false;
  }
  const attempt = window.prompt(`Enter the delete password to delete ${kindLabel(kind)}:`) ?? "";
  if (!attempt) return false;
  if (officePassword && attempt === officePassword) return true;
  if (settings.deletePasswordHash && (await verifyDeletePassword(settings, attempt))) return true;
  window.alert("That password isn't right.");
  return false;
}

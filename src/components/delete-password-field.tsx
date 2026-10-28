"use client";

import { useState } from "react";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { logActivity } from "@/lib/activity-log";
import {
  ADMIN_ACCESS_KEY,
  checkDeletePassword,
  hashDeletePassword,
  isAdminTier,
  normalizeAdminAccess,
} from "@/lib/admin-access";

/**
 * The office's ONE delete password (Settings → Office and Settings → Roles
 * & Permissions both show this). It is saved as a salted hash in the cloud so it is
 * the same on every device and for every team member, and the Saved message
 * only appears after the cloud copy has been read back and matches.
 */
export function DeletePasswordField() {
  const { roleTier } = useWorkspaceAccess();
  const { adminAccess, saveSecurity } = useAdminAccess();
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const legacyPassword = (officeSettings.deletePassword ?? "").trim();
  const hasPassword = Boolean(adminAccess.deletePasswordHash) || Boolean(legacyPassword);

  if (!isAdminTier(roleTier)) return null;

  const save = async () => {
    setError("");
    setSaved("");
    if (password.length < 4) {
      setError("Use at least 4 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { fetchKvValue } = await import("@/lib/kv-cloud");
      // Work from the cloud copy so other Admin Access settings are never overwritten with stale ones.
      const remoteRaw = await fetchKvValue<unknown>(ADMIN_ACCESS_KEY);
      const base = remoteRaw ? normalizeAdminAccess(remoteRaw) : adminAccess;
      if (hasPassword) {
        const ok = await checkDeletePassword(base, legacyPassword, current);
        if (ok !== "ok") {
          setError("The current delete password isn't right. Forgot it? Remove it in Settings → Roles & Permissions, then set a new one.");
          return;
        }
      }
      const { salt, hash } = await hashDeletePassword(password);
      const result = await saveSecurity({ ...base, deletePasswordSalt: salt, deletePasswordHash: hash });
      if (!result.ok) throw new Error(result.error);
      const back = normalizeAdminAccess(await fetchKvValue<unknown>(ADMIN_ACCESS_KEY));
      if (back.deletePasswordHash !== hash) {
        throw new Error("cloud read-back did not match");
      }
      // The older plaintext copy must not keep working once there's a new password.
      if (legacyPassword) updateOfficeSettings({ deletePassword: "" });
      logActivity({ category: "team", action: "access.password_set", summary: "Set the delete password" });
      setCurrent("");
      setPassword("");
      setConfirm("");
      setSaved("Saved to the cloud. This password now works on every device and for your whole team.");
    } catch {
      setError("Couldn't confirm the save in the cloud. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError("");
    setSaved("");
    setBusy(true);
    try {
      const { fetchKvValue } = await import("@/lib/kv-cloud");
      const remoteRaw = await fetchKvValue<unknown>(ADMIN_ACCESS_KEY);
      const base = remoteRaw ? normalizeAdminAccess(remoteRaw) : adminAccess;
      const result = await saveSecurity({ ...base, deletePasswordSalt: "", deletePasswordHash: "" });
      if (!result.ok) throw new Error(result.error);
      if (legacyPassword) updateOfficeSettings({ deletePassword: "" });
      logActivity({ category: "team", action: "access.password_cleared", summary: "Removed the delete password" });
      setSaved("Delete password removed. Deleting patients is blocked until you set a new one.");
    } catch {
      setError("Couldn't remove it in the cloud. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const input = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm";
  return (
    <div className="grid gap-2">
      <p className="text-xs text-[var(--text-muted)]">
        {hasPassword
          ? "A delete password is set. It's asked for when deleting a patient. Enter the current one to replace it."
          : "No delete password yet. Set one to be able to delete patients."}
      </p>
      {hasPassword && (
        <input
          autoComplete="off"
          className={input}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current delete password"
          type="password"
          value={current}
        />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          autoComplete="new-password"
          className={input}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={hasPassword ? "New password" : "Choose password"}
          type="password"
          value={password}
        />
        <input
          autoComplete="new-password"
          className={input}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat it"
          type="password"
          value={confirm}
        />
      </div>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {saved && <p className="text-xs font-semibold text-emerald-700">✓ {saved}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">
          {busy ? "Saving…" : hasPassword ? "Update delete password" : "Save delete password"}
        </button>
        {hasPassword && (
          <button className="btn btn-secondary btn-sm disabled:opacity-50" disabled={busy} onClick={() => void remove()} type="button">
            Remove password
          </button>
        )}
      </div>
    </div>
  );
}

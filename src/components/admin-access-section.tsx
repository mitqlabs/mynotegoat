"use client";

import { useState } from "react";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { logActivity } from "@/lib/activity-log";
import { ToggleSwitch } from "@/components/toggle-switch";
import {
  DELETABLE_KINDS,
  MANAGER_DASHBOARD_SECTIONS,
  hashDeletePassword,
  isAdminTier,
  type AdminAccessSettings,
  type DeleteRule,
} from "@/lib/admin-access";

/**
 * Settings → Admin Access. Admins decide what a Manager can see and delete,
 * and set the delete password. Only the OWNER account can add or remove
 * Admins (that happens on the member card in Team).
 */

const RULE_LABEL: Record<DeleteRule, string> = {
  never: "Not allowed",
  password: "With password",
  allowed: "Allowed",
};

export function AdminAccessSection() {
  const { roleTier } = useWorkspaceAccess();
  const { adminAccess, saveAdminAccess } = useAdminAccess();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState("");

  if (!isAdminTier(roleTier)) return null;

  const update = (patch: Partial<AdminAccessSettings>) => {
    void saveAdminAccess({ ...adminAccess, ...patch });
  };

  const savePassword = async () => {
    if (password.length < 4) {
      setNotice("Use at least 4 characters.");
      return;
    }
    if (password !== confirm) {
      setNotice("The two passwords don't match.");
      return;
    }
    const { salt, hash } = await hashDeletePassword(password);
    await saveAdminAccess({ ...adminAccess, deletePasswordSalt: salt, deletePasswordHash: hash });
    setPassword("");
    setConfirm("");
    setNotice("Delete password saved.");
    logActivity({ category: "team", action: "access.password_set", summary: "Set the delete password" });
  };

  const clearPassword = async () => {
    await saveAdminAccess({ ...adminAccess, deletePasswordSalt: "", deletePasswordHash: "" });
    setNotice("Delete password removed. Anything set to “With password” is blocked until you set a new one.");
    logActivity({ category: "team", action: "access.password_cleared", summary: "Removed the delete password" });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <h3 className="text-sm font-semibold">What Managers can see</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Dashboard sections. Admins always see everything.
        </p>
        <div className="mt-3 grid gap-1.5">
          {MANAGER_DASHBOARD_SECTIONS.map((section) => (
            <label
              className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5"
              key={section.key}
            >
              <span className="text-xs font-semibold">{section.label}</span>
              <ToggleSwitch
                ariaLabel={section.label}
                checked={adminAccess.managerDashboard[section.key]}
                onChange={(on) =>
                  update({ managerDashboard: { ...adminAccess.managerDashboard, [section.key]: on } })
                }
              />
            </label>
          ))}
        </div>
      </article>

      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <h3 className="text-sm font-semibold">What Managers can delete</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Staff can never delete. “With password” asks for the delete password below.
        </p>
        <div className="mt-3 grid gap-1.5">
          {DELETABLE_KINDS.map((kind) => (
            <label
              className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5"
              key={kind.key}
            >
              <span className="text-xs font-semibold">{kind.label}</span>
              <select
                className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                onChange={(e) =>
                  update({
                    managerDeletes: { ...adminAccess.managerDeletes, [kind.key]: e.target.value as DeleteRule },
                  })
                }
                value={adminAccess.managerDeletes[kind.key]}
              >
                {(["never", "password", "allowed"] as DeleteRule[]).map((rule) => (
                  <option key={rule} value={rule}>
                    {RULE_LABEL[rule]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </article>

      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <h3 className="text-sm font-semibold">Delete password</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {adminAccess.deletePasswordHash
            ? "A password is set. Enter a new one to replace it."
            : "No password set yet. Anything marked “With password” stays blocked until you set one."}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            autoComplete="new-password"
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            type="password"
            value={password}
          />
          <input
            autoComplete="new-password"
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat it"
            type="password"
            value={confirm}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white"
            onClick={() => void savePassword()}
            type="button"
          >
            Save password
          </button>
          {adminAccess.deletePasswordHash && (
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => void clearPassword()}
              type="button"
            >
              Remove password
            </button>
          )}
        </div>
        <label className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5">
          <span className="text-xs font-semibold">
            Ask Admins for it too{" "}
            <span className="font-normal text-[var(--text-muted)]">— a second pair of eyes on deletes</span>
          </span>
          <ToggleSwitch
            ariaLabel="Ask admins for the delete password"
            checked={adminAccess.passwordAppliesToAdmins}
            onChange={(on) => update({ passwordAppliesToAdmins: on })}
          />
        </label>
        {notice && <p className="mt-2 text-xs font-semibold text-[var(--brand-primary)]">{notice}</p>}
      </article>

      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <h3 className="text-sm font-semibold">Roles</h3>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--text-muted)]">
          <li>
            <span className="font-semibold text-[var(--text-primary)]">Owner</span> — the account the office was
            created under. Same as Admin, plus the only one who can add or remove Admins.
          </li>
          <li>
            <span className="font-semibold text-[var(--text-primary)]">Admin</span> — everything: Settings, Team,
            Dashboard, all deletes.
          </li>
          <li>
            <span className="font-semibold text-[var(--text-primary)]">Manager</span> — runs the office day to day,
            limited by this page.
          </li>
          <li>
            <span className="font-semibold text-[var(--text-primary)]">Staff</span> — their granted sections only,
            no deletes.
          </li>
        </ul>
        <p className="mt-3 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
          Set each person&apos;s role on their card in Settings → Team.
          {roleTier === "owner"
            ? " You're signed in as the owner, so the Admin role is available there."
            : " Only the owner account can hand out or remove the Admin role."}
        </p>
      </article>
    </div>
  );
}

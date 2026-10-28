"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { logActivity } from "@/lib/activity-log";
import { appConfirm } from "@/components/app-dialog";
import { DeletePasswordField } from "@/components/delete-password-field";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { AccessLevel } from "@/lib/team-permissions";
import {
  DELETABLE_KINDS,
  MANAGER_DASHBOARD_SECTIONS,
  ROLE_ACTIONS,
  ROLE_PAGES,
  canEditRoleSettings,
  defaultAdminAccess,
  isAdminTier,
  type AdminAccessSettings,
  type ConfigurableRole,
  type DeleteRule,
} from "@/lib/admin-access";

/**
 * Settings → Office → Roles & Permissions.
 *
 * One grid for every role: rows are things a person might do, columns are Staff, Manager and
 * Admin. Staff and Manager are editable; Admin is always everything (shown locked so the whole
 * picture is in one place). Who may change the grid: the owner, and Admins only when the owner
 * turns "Let Admins change roles" on. Team members inherit their role from here; their own
 * overrides live on their card in Team Members.
 */

const COLUMNS: { key: ConfigurableRole; label: string }[] = [
  { key: "staff", label: "Staff" },
  { key: "manager", label: "Manager" },
];

const RULE_LABEL: Record<DeleteRule, string> = {
  never: "Not allowed",
  password: "With password",
  allowed: "Allowed",
};

const GRID = "grid grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_5.5rem] items-center gap-2";

function Header() {
  return (
    <div className={`${GRID} px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]`}>
      <span />
      {COLUMNS.map((c) => (
        <span className="text-center" key={c.key}>
          {c.label}
        </span>
      ))}
      <span className="text-center">Admin</span>
    </div>
  );
}

function Row({ label, hint, children, admin }: { label: React.ReactNode; hint?: string; children: React.ReactNode; admin: React.ReactNode }) {
  return (
    <div className={`${GRID} rounded-lg bg-[var(--bg-soft)] px-2 py-1.5`}>
      <span className="min-w-0 text-xs font-semibold">
        {label}
        {hint && <span className="block font-normal text-[var(--text-muted)]">{hint}</span>}
      </span>
      {children}
      <span className="text-center text-[11px] font-semibold text-[var(--text-muted)]">{admin}</span>
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <span className="flex justify-center">{children}</span>;

const selectClass = "w-full rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:text-[var(--text-muted)]";

export function AdminAccessSection() {
  const { roleTier } = useWorkspaceAccess();
  const { adminAccess, saveRoles, saveSecurity } = useAdminAccess();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Keeps quick back-to-back toggles from overwriting each other before the first save returns.
  const latest = useRef(adminAccess);
  useEffect(() => {
    latest.current = adminAccess;
  }, [adminAccess]);

  if (!isAdminTier(roleTier)) return null;

  const canEdit = canEditRoleSettings(roleTier, adminAccess);
  const isOwner = roleTier === "owner";

  const update = async (patch: Partial<AdminAccessSettings>, summary?: string) => {
    if (!canEdit) return;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setStatus(null);
    const result = await saveRoles(next);
    if (result.ok) {
      setStatus({ tone: "ok", text: "Saved." });
      if (summary) logActivity({ category: "team", action: "roles.changed", summary });
    } else {
      setStatus({ tone: "error", text: result.error });
    }
  };

  const resetToDefaults = async () => {
    const ok = await appConfirm("Reset every role to the standard defaults? Your delete password and the “Let Admins change roles” switch stay as they are.", {
      confirmLabel: "Reset roles",
      danger: true,
    });
    if (!ok) return;
    const d = defaultAdminAccess();
    await update(
      { managerDashboard: d.managerDashboard, rolePages: d.rolePages, roleDeletes: d.roleDeletes, roleActions: d.roleActions },
      "Reset Roles & Permissions to the defaults",
    );
  };

  const pageLevel = (role: ConfigurableRole, feature: (typeof ROLE_PAGES)[number]["feature"]): AccessLevel =>
    adminAccess.rolePages[role][feature] ?? "none";

  return (
    <div className="grid gap-4">
      {!canEdit && (
        <p className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-xs text-[var(--text-muted)]">
          View only — only the office owner can change what each role is allowed to do. Ask them if something here needs to change.
        </p>
      )}

      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">What each role can do</h3>
            <p className="mt-1 max-w-2xl text-xs text-[var(--text-muted)]">
              Everyone on your team gets the permissions of their role. Set a person&apos;s role on their card in
              Team Members. Admins (and you, the owner) can always do everything, and Settings is always admins only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {status && (
              <span aria-live="polite" className={`text-xs font-semibold ${status.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>
                {status.text}
              </span>
            )}
            {canEdit && (
              <button className="btn btn-secondary btn-sm" onClick={() => void resetToDefaults()} type="button">
                Reset to defaults
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-1.5">
          <Header />
          <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Pages</p>
          {ROLE_PAGES.map((page) => (
            <Row
              admin="Full"
              key={page.feature}
              label={page.label}
              hint={page.feature === "statistics" ? "Statistics inside is admins only" : undefined}
            >
              {COLUMNS.map((role) => (
                <select
                  aria-label={`${role.label} — ${page.label}`}
                  className={selectClass}
                  disabled={!canEdit}
                  key={role.key}
                  onChange={(e) =>
                    void update(
                      { rolePages: { ...adminAccess.rolePages, [role.key]: { ...adminAccess.rolePages[role.key], [page.feature]: e.target.value as AccessLevel } } },
                      `Set ${role.label} access to ${page.label}: ${e.target.value}`,
                    )
                  }
                  value={pageLevel(role.key, page.feature)}
                >
                  <option value="none">No access</option>
                  <option value="view">View only</option>
                  <option value="edit">Full</option>
                </select>
              ))}
            </Row>
          ))}

          <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions inside a page</p>
          {ROLE_ACTIONS.map((action) => (
            <Row admin="Yes" key={action.key} label={`${action.group}: ${action.label}`}>
              {COLUMNS.map((role) => {
                const pageFull = pageLevel(role.key, action.feature) === "edit";
                return (
                  <Center key={role.key}>
                    <ToggleSwitch
                      ariaLabel={`${role.label} — ${action.group}: ${action.label}`}
                      checked={pageFull && adminAccess.roleActions[role.key][action.key]}
                      disabled={!canEdit || !pageFull}
                      onChange={(on) =>
                        void update(
                          { roleActions: { ...adminAccess.roleActions, [role.key]: { ...adminAccess.roleActions[role.key], [action.key]: on } } },
                          `${on ? "Allowed" : "Blocked"} ${role.label} to ${action.label.toLowerCase()}`,
                        )
                      }
                      title={pageFull ? undefined : `${role.label} needs Full access to ${action.group} first`}
                    />
                  </Center>
                );
              })}
            </Row>
          ))}

          <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Deleting</p>
          {DELETABLE_KINDS.map((kind) => (
            <Row admin="Allowed" key={kind.key} label={kind.label}>
              {COLUMNS.map((role) => (
                <select
                  aria-label={`${role.label} — delete ${kind.label}`}
                  className={selectClass}
                  disabled={!canEdit}
                  key={role.key}
                  onChange={(e) =>
                    void update(
                      { roleDeletes: { ...adminAccess.roleDeletes, [role.key]: { ...adminAccess.roleDeletes[role.key], [kind.key]: e.target.value as DeleteRule } } },
                      `Set ${role.label} deleting ${kind.label.toLowerCase()}: ${RULE_LABEL[e.target.value as DeleteRule]}`,
                    )
                  }
                  value={adminAccess.roleDeletes[role.key][kind.key]}
                >
                  {(["never", "password", "allowed"] as DeleteRule[]).map((rule) => (
                    <option key={rule} value={rule}>
                      {RULE_LABEL[rule]}
                    </option>
                  ))}
                </select>
              ))}
            </Row>
          ))}

          <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Dashboard sections</p>
          {MANAGER_DASHBOARD_SECTIONS.map((section) => (
            <Row admin="Yes" key={section.key} label={section.label}>
              <Center>
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Hidden</span>
              </Center>
              <Center>
                <ToggleSwitch
                  ariaLabel={`Manager — ${section.label}`}
                  checked={adminAccess.managerDashboard[section.key]}
                  disabled={!canEdit}
                  onChange={(on) =>
                    void update(
                      { managerDashboard: { ...adminAccess.managerDashboard, [section.key]: on } },
                      `${on ? "Showed" : "Hid"} ${section.label} for Managers`,
                    )
                  }
                />
              </Center>
            </Row>
          ))}
          <Row admin="Yes" hint="The business numbers. Never available below Admin." label="Statistics">
            <Center>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">Hidden</span>
            </Center>
            <Center>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">Hidden</span>
            </Center>
          </Row>
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <h3 className="text-sm font-semibold">Who can change this</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            The office owner can always change roles. Managers and Staff never can. Turn this on to let Admins change them too.
          </p>
          <label className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5">
            <span className="text-xs font-semibold">Let Admins change roles</span>
            <ToggleSwitch
              ariaLabel="Let Admins change roles"
              checked={adminAccess.adminsCanEditRoles}
              disabled={!isOwner}
              onChange={(on) => void update({ adminsCanEditRoles: on }, `${on ? "Let" : "Stopped letting"} Admins change roles`)}
              title={isOwner ? undefined : "Only the owner can change this"}
            />
          </label>
          <ul className="mt-4 grid gap-1.5 text-xs text-[var(--text-muted)]">
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Owner</span> — the account the office was created under. Everything, plus the only one who can add or remove Admins and move people between roles.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Admin</span> — everything: Settings, Team, Dashboard, all deletes.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Manager</span> — runs the office day to day, limited by the grid above.
            </li>
            <li>
              <span className="font-semibold text-[var(--text-primary)]">Staff</span> — the day-to-day pages, limited by the grid above.
            </li>
          </ul>
        </article>

        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
          <h3 className="text-sm font-semibold">Delete password</h3>
          <div className="mt-2">
            <DeletePasswordField />
          </div>
          <label className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5">
            <span className="text-xs font-semibold">
              Ask Admins for it too <span className="font-normal text-[var(--text-muted)]">— a second pair of eyes on deletes</span>
            </span>
            <ToggleSwitch
              ariaLabel="Ask admins for the delete password"
              checked={adminAccess.passwordAppliesToAdmins}
              onChange={(on) => void saveSecurity({ ...adminAccess, passwordAppliesToAdmins: on })}
            />
          </label>
        </article>
      </div>
    </div>
  );
}

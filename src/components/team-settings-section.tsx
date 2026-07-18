"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  ACCESS_LEVELS,
  PERMISSIONABLE_FEATURES,
  normalizePermissions,
  type AccessLevel,
  type MemberPermissions,
} from "@/lib/team-permissions";
import type { PortalFeature } from "@/lib/plan-access";

type Member = {
  member_user_id: string;
  email: string | null;
  label: string;
  permissions: MemberPermissions;
};

const ACCESS_LABEL: Record<AccessLevel, string> = {
  none: "No access",
  view: "View only",
  edit: "Edit",
};

const EMPTY_PERMS: MemberPermissions = {};

export function TeamSettingsSection() {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notReady, setNotReady] = useState(false);

  // Add-member form.
  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("Front Desk");
  const [draftPerms, setDraftPerms] = useState<MemberPermissions>(EMPTY_PERMS);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      setLoading(false);
      return;
    }
    const { data, error: qErr } = await supabase
      .from("workspace_members")
      .select("member_user_id, email, label, permissions")
      .eq("workspace_owner_id", session.user.id);
    setLoading(false);
    if (qErr) {
      // Most likely the migration hasn't been run yet.
      setNotReady(/relation .*workspace_members.* does not exist|schema cache/i.test(qErr.message));
      setError(qErr.message);
      return;
    }
    setNotReady(false);
    setMembers(
      (data ?? []).map((row) => ({
        member_user_id: String(row.member_user_id),
        email: (row.email as string | null) ?? null,
        label: String(row.label ?? "Team Member"),
        permissions: normalizePermissions(row.permissions),
      })),
    );
  }, []);

  useEffect(() => {
    if (open) void loadMembers();
  }, [open, loadMembers]);

  const authHeader = async (): Promise<Record<string, string> | null> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  };

  const addMember = async () => {
    setError("");
    setBusy(true);
    const headers = await authHeader();
    if (!headers) {
      setBusy(false);
      setError("Not signed in.");
      return;
    }
    const res = await fetch("/api/team/create-member", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, label, permissions: draftPerms }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Could not add the member.");
      return;
    }
    setShowAdd(false);
    setEmail("");
    setPassword("");
    setLabel("Front Desk");
    setDraftPerms(EMPTY_PERMS);
    void loadMembers();
  };

  const removeMember = async (member: Member) => {
    if (!window.confirm(`Remove ${member.email || member.label}? Their login will be deleted.`)) {
      return;
    }
    const headers = await authHeader();
    if (!headers) return;
    setBusy(true);
    const res = await fetch("/api/team/remove-member", {
      method: "POST",
      headers,
      body: JSON.stringify({ memberId: member.member_user_id }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Could not remove the member.");
      return;
    }
    void loadMembers();
  };

  const setMemberAccess = async (member: Member, feature: PortalFeature, level: AccessLevel) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const nextPerms: MemberPermissions = { ...member.permissions };
    if (level === "none") delete nextPerms[feature];
    else nextPerms[feature] = level;
    // Optimistic.
    setMembers((cur) =>
      cur.map((m) => (m.member_user_id === member.member_user_id ? { ...m, permissions: nextPerms } : m)),
    );
    const { error: uErr } = await supabase
      .from("workspace_members")
      .update({ permissions: nextPerms, updated_at: new Date().toISOString() })
      .eq("member_user_id", member.member_user_id);
    if (uErr) {
      setError(uErr.message);
      void loadMembers();
    }
  };

  return (
    <section className="panel-card p-4">
      <button
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div>
          <h3 className="text-xl font-semibold">Team Members</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Add staff logins (front desk, office manager…) and choose what each can access.
          </p>
        </div>
        <span
          aria-hidden
          className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {notReady && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Team features need a one-time database setup. Run{" "}
              <code>supabase/team_members_and_audit.sql</code> in your Supabase SQL editor, then
              reload.
            </div>
          )}
          {error && !notReady && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : (
            <div className="space-y-3">
              {members.length === 0 && !notReady && (
                <p className="text-sm text-[var(--text-muted)]">No team members yet.</p>
              )}
              {members.map((member) => (
                <div
                  key={member.member_user_id}
                  className="rounded-xl border border-[var(--line-soft)] bg-white p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{member.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{member.email}</p>
                    </div>
                    <button
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                      disabled={busy}
                      onClick={() => removeMember(member)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {PERMISSIONABLE_FEATURES.map(({ feature, label: fLabel }) => (
                      <div
                        key={feature}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1"
                      >
                        <span className="text-xs">{fLabel}</span>
                        <select
                          className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                          onChange={(e) => setMemberAccess(member, feature, e.target.value as AccessLevel)}
                          value={member.permissions[feature] ?? "none"}
                        >
                          {ACCESS_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {ACCESS_LABEL[lvl]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAdd ? (
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Staff email</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="frontdesk@clinic.com"
                    type="email"
                    value={email}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Temporary password</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="min. 6 characters"
                    value={password}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Role label</span>
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Front Desk"
                    value={label}
                  />
                </label>
              </div>
              <p className="mt-3 text-xs font-semibold text-[var(--text-muted)]">Access</p>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {PERMISSIONABLE_FEATURES.map(({ feature, label: fLabel }) => (
                  <div
                    key={feature}
                    className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1"
                  >
                    <span className="text-xs">{fLabel}</span>
                    <select
                      className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                      onChange={(e) => {
                        const level = e.target.value as AccessLevel;
                        setDraftPerms((cur) => {
                          const next = { ...cur };
                          if (level === "none") delete next[feature];
                          else next[feature] = level;
                          return next;
                        });
                      }}
                      value={draftPerms[feature] ?? "none"}
                    >
                      {ACCESS_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {ACCESS_LABEL[lvl]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
                  disabled={busy || !email.trim() || password.length < 6}
                  onClick={addMember}
                  type="button"
                >
                  {busy ? "Creating…" : "Create Member"}
                </button>
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold"
                  onClick={() => setShowAdd(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
              disabled={notReady}
              onClick={() => setShowAdd(true)}
              type="button"
            >
              + Add Team Member
            </button>
          )}
        </div>
      )}
    </section>
  );
}

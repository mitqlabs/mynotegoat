"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  accessLevelsForFeature,
  PERMISSIONABLE_FEATURES,
  MEMBER_LOCKABLE_SECTIONS,
  normalizePermissions,
  type AccessLevel,
  type MemberPermissions,
} from "@/lib/team-permissions";
import type { PortalFeature } from "@/lib/plan-access";
import { useModuleVisibility } from "@/hooks/use-module-visibility";
import { loadPatientPagePrefs } from "@/lib/patient-page-prefs";
import { loadOfficeSettings } from "@/lib/office-settings";
import { loadTeamEnabled, saveTeamEnabled } from "@/lib/team-settings";
import { ToggleSwitch } from "@/components/toggle-switch";

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

// Manual display order for member cards (drag-to-reorder). Stored as an
// ordered list of member ids, KV-synced like other office prefs.
const ORDER_KEY = "casemate.team-member-order.v1";

function loadMemberOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveMemberOrder(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(ORDER_KEY, "tasks", ids));
}

/** Sort members by the saved order; unknown (new) members fall to the end. */
function applyMemberOrder(list: Member[], order: string[]): Member[] {
  if (!order.length) return list;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ra = rank.has(a.member_user_id) ? rank.get(a.member_user_id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.member_user_id) ? rank.get(b.member_user_id)! : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

export function TeamSettingsSection() {
  // Owner's module visibility — a feature the office has turned off can't be
  // granted to anyone, so those rows show "Off" instead of an access picker.
  const { isFeatureEnabled } = useModuleVisibility();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notReady, setNotReady] = useState(false);
  // Inline label (role/name) editing per member.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  // Which members have their permission grid expanded (default collapsed).
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  // Drag-to-reorder.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Master switch. null = not yet resolved; once members load we fall back to
  // "on when any members exist" so an existing team is never hidden.
  const [teamEnabled, setTeamEnabled] = useState<boolean | null>(() => loadTeamEnabled());
  // The logged-in account holder — shown as the Admin card (no self sign-up).
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string }>({ id: "", email: "" });
  const doctorName = useMemo(() => (loadOfficeSettings().doctorName ?? "").trim(), []);
  // Office-wide patient-section hide state — a section hidden office-wide can't
  // be individually toggled (it's off for everyone).
  const officeSectionModes = useMemo(() => loadPatientPagePrefs().mode, []);

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
    setCurrentUser({ id: session.user.id, email: session.user.email ?? "" });
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
    const list: Member[] = (data ?? []).map((row) => ({
      member_user_id: String(row.member_user_id),
      email: (row.email as string | null) ?? null,
      label: String(row.label ?? "Team Member"),
      permissions: normalizePermissions(row.permissions),
    }));
    setMembers(applyMemberOrder(list, loadMemberOrder()));
    // Resolve the master switch default once we know whether a team exists.
    setTeamEnabled((cur) => (cur === null ? loadTeamEnabled() ?? list.length > 0 : cur));
  }, []);

  const setTeam = useCallback((on: boolean) => {
    setTeamEnabled(on);
    saveTeamEnabled(on);
  }, []);

  // Move `sourceId` to just before `targetId` and persist the new order.
  const reorderMembers = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setMembers((cur) => {
      const from = cur.findIndex((m) => m.member_user_id === sourceId);
      const to = cur.findIndex((m) => m.member_user_id === targetId);
      if (from === -1 || to === -1) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      saveMemberOrder(next.map((m) => m.member_user_id));
      return next;
    });
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

  const saveLabel = async (member: Member) => {
    const next = editLabel.trim();
    setEditingId(null);
    if (!next || next === member.label) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setMembers((cur) =>
      cur.map((m) => (m.member_user_id === member.member_user_id ? { ...m, label: next } : m)),
    );
    const { error: uErr } = await supabase
      .from("workspace_members")
      .update({ label: next, updated_at: new Date().toISOString() })
      .eq("member_user_id", member.member_user_id);
    if (uErr) {
      setError(uErr.message);
      void loadMembers();
    }
  };

  const saveMemberPerms = async (member: Member, nextPerms: MemberPermissions) => {
    setMembers((cur) =>
      cur.map((m) => (m.member_user_id === member.member_user_id ? { ...m, permissions: nextPerms } : m)),
    );
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error: uErr } = await supabase
      .from("workspace_members")
      .update({ permissions: nextPerms, updated_at: new Date().toISOString() })
      .eq("member_user_id", member.member_user_id);
    if (uErr) {
      setError(uErr.message);
      void loadMembers();
    }
  };

  const setMemberOfficeAdmin = (member: Member, on: boolean) => {
    const next = { ...member.permissions };
    if (on) next.officeAdmin = true;
    else delete next.officeAdmin;
    void saveMemberPerms(member, next);
  };

  const setMemberSectionHidden = (member: Member, key: string, hidden: boolean) => {
    const set = new Set(member.permissions.hiddenSections ?? []);
    if (hidden) set.add(key);
    else set.delete(key);
    const next = { ...member.permissions };
    if (set.size) next.hiddenSections = [...set];
    else delete next.hiddenSections;
    void saveMemberPerms(member, next);
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

          {!notReady && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2.5">
              <span className="text-sm font-semibold">
                Team Members{" "}
                <span className="font-normal text-[var(--text-muted)]">
                  — activate staff logins and the shared roster
                </span>
              </span>
              <ToggleSwitch
                checked={Boolean(teamEnabled)}
                onChange={setTeam}
                ariaLabel="Enable team members"
              />
            </label>
          )}

          {!notReady && !teamEnabled && (
            <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3 text-sm text-[var(--text-muted)]">
              Team Members is off — you&apos;re working solo. Turn it on to add staff logins and choose
              what each person can access.
            </p>
          )}

          {teamEnabled && (loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : (
            <div className="grid items-start gap-3 sm:grid-cols-2">
              {/* The logged-in account holder, shown automatically as Admin —
                  no self sign-up. Non-removable, not draggable. */}
              <div className="rounded-xl border border-[rgba(13,121,191,0.35)] bg-[rgba(13,121,191,0.06)] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {doctorName || "Admin"}
                      <span className="rounded-full bg-[var(--brand-primary)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        ADMIN
                      </span>
                      <span className="text-[10px] font-semibold text-[var(--text-muted)]">You</span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{currentUser.email}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-[var(--text-muted)]">Full access</span>
                </div>
              </div>
              {members.map((member) => (
                <div
                  key={member.member_user_id}
                  className={`rounded-xl border bg-white p-2.5 transition-colors ${
                    draggingId === member.member_user_id
                      ? "border-[var(--brand-primary)] opacity-60"
                      : "border-[var(--line-soft)]"
                  }`}
                  draggable={editingId !== member.member_user_id}
                  onDragStart={(e) => {
                    setDraggingId(member.member_user_id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (draggingId && draggingId !== member.member_user_id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId) reorderMembers(draggingId, member.member_user_id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="cursor-grab select-none text-[var(--text-muted)] active:cursor-grabbing"
                        title="Drag to reorder"
                        aria-hidden
                      >
                        ⠿
                      </span>
                      <div className="min-w-0">
                      {editingId === member.member_user_id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-0.5 text-sm"
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveLabel(member);
                              else if (e.key === "Escape") setEditingId(null);
                            }}
                            placeholder="Role / name (e.g. Front Desk)"
                            value={editLabel}
                          />
                          <button
                            className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--brand-primary)]"
                            onClick={() => void saveLabel(member)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--text-muted)]"
                            onClick={() => setEditingId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          {member.label}
                          <button
                            className="rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
                            onClick={() => {
                              setEditLabel(member.label);
                              setEditingId(member.member_user_id);
                            }}
                            title="Rename this member's role/name"
                            type="button"
                          >
                            Edit
                          </button>
                        </p>
                      )}
                      <p className="text-xs text-[var(--text-muted)]">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold"
                        onClick={() =>
                          setExpandedMembers((prev) => {
                            const next = new Set(prev);
                            if (next.has(member.member_user_id)) next.delete(member.member_user_id);
                            else next.add(member.member_user_id);
                            return next;
                          })
                        }
                        type="button"
                      >
                        {expandedMembers.has(member.member_user_id)
                          ? "▾ Access"
                          : `▸ Access (${Object.keys(member.permissions).length})`}
                      </button>
                      <button
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                        disabled={busy}
                        onClick={() => removeMember(member)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {expandedMembers.has(member.member_user_id) && (
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(13,121,191,0.35)] bg-[rgba(13,121,191,0.06)] px-2 py-1.5">
                      <span className="text-xs font-semibold">
                        Office Admin{" "}
                        <span className="font-normal text-[var(--text-muted)]">
                          — full access incl. Settings &amp; Team
                        </span>
                      </span>
                      <ToggleSwitch
                        checked={Boolean(member.permissions.officeAdmin)}
                        onChange={(on) => setMemberOfficeAdmin(member, on)}
                        ariaLabel="Office Admin"
                      />
                    </label>
                    {member.permissions.officeAdmin ? (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Full owner-level access. Turn off Office Admin to set specific permissions.
                      </p>
                    ) : (
                      <>
                        <div className="grid gap-1.5">
                          {PERMISSIONABLE_FEATURES.map(({ feature, label: fLabel, viewOnly }) => {
                            const featureOn = isFeatureEnabled(feature);
                            return (
                              <div
                                key={feature}
                                className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1"
                              >
                                <span className={`text-xs ${featureOn ? "" : "text-[var(--text-muted)]"}`}>
                                  {fLabel}
                                </span>
                                {featureOn ? (
                                  <select
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-xs"
                                    onChange={(e) => setMemberAccess(member, feature, e.target.value as AccessLevel)}
                                    value={member.permissions[feature] ?? "none"}
                                  >
                                    {accessLevelsForFeature(viewOnly).map((lvl) => (
                                      <option key={lvl} value={lvl}>
                                        {ACCESS_LABEL[lvl]}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span
                                    className="rounded-md border border-[var(--line-soft)] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]"
                                    title="This module is turned off for the whole office (Settings → Module Visibility)."
                                  >
                                    Off · office-wide
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Patient-page sections — flip OFF to hide from this member
                          </p>
                          <div className="mt-1 grid gap-1">
                            {MEMBER_LOCKABLE_SECTIONS.map(({ key, label }) => {
                              const officeHidden =
                                officeSectionModes[key as keyof typeof officeSectionModes] === "hide";
                              const memberVisible = !(member.permissions.hiddenSections ?? []).includes(key);
                              return (
                                <div
                                  key={key}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1"
                                >
                                  <span className={`text-xs ${officeHidden ? "text-[var(--text-muted)]" : ""}`}>
                                    {label}
                                  </span>
                                  {officeHidden ? (
                                    <span
                                      className="rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]"
                                      title="Hidden for the whole office (Settings → Patient Page Sections)."
                                    >
                                      Off · office-wide
                                    </span>
                                  ) : (
                                    <ToggleSwitch
                                      checked={memberVisible}
                                      onChange={(on) => setMemberSectionHidden(member, key, !on)}
                                      title={memberVisible ? "Visible — flip off to hide" : "Hidden from this member"}
                                      ariaLabel={`${label} visible`}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {teamEnabled && (showAdd ? (
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
                {PERMISSIONABLE_FEATURES.map(({ feature, label: fLabel, viewOnly }) => {
                  const featureOn = isFeatureEnabled(feature);
                  return (
                    <div
                      key={feature}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1"
                    >
                      <span className={`text-xs ${featureOn ? "" : "text-[var(--text-muted)]"}`}>
                        {fLabel}
                      </span>
                      {featureOn ? (
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
                          {accessLevelsForFeature(viewOnly).map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {ACCESS_LABEL[lvl]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]"
                          title="This module is turned off for the whole office (Settings → Module Visibility)."
                        >
                          Off · office-wide
                        </span>
                      )}
                    </div>
                  );
                })}
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
              + Team Member
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

/**
 * Workspace people — the roster available to @mention in Messages.
 * Owner + every team member. The owner isn't a row in workspace_members,
 * so we synthesize an "Owner" entry from the resolved membership.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";

export interface WorkspacePerson {
  userId: string;
  /** Display name — the member's role label ("Front Desk", "Owner", …). */
  label: string;
  /** Secondary line (email), shown under the name in the @ picker. */
  email: string;
}

export function useWorkspacePeople(ownerName?: string) {
  const [people, setPeople] = useState<WorkspacePerson[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const membership = getCurrentMembershipSync();
      let ownerId = membership?.ownerId ?? "";
      // The roster comes from a server function that only returns the caller's
      // own workspace (names + emails, no permissions), so every login, owner,
      // doctor or front desk, gets recipients. A member can't read other
      // members' rows directly (RLS), which is why messaging had no one to pick.
      type Row = { member_user_id: string; label: string | null; email: string | null };
      let data: Row[] | null = null;
      const rpc = await supabase.rpc("workspace_team_roster");
      if (!rpc.error && Array.isArray(rpc.data)) {
        data = rpc.data as Row[];
        const o = (rpc.data as Array<{ owner_id?: string }>)[0]?.owner_id;
        if (o) ownerId = String(o);
      } else {
        // Before the SQL is installed: the old direct read (owner sees all).
        const res = await supabase.from("workspace_members").select("member_user_id, label, email").eq("workspace_owner_id", ownerId);
        data = res.data ?? null;
      }
      if (cancelled) return;
      const roster: WorkspacePerson[] = (data ?? []).map((row) => ({
        userId: String(row.member_user_id),
        label: String(row.label ?? "Team Member"),
        email: String(row.email ?? ""),
      }));
      // The owner never appears in workspace_members — add them so staff can
      // @mention the doctor and vice-versa. The account holder is the office
      // ADMIN (shown by name when Office Settings has a doctor name).
      if (ownerId && !roster.some((p) => p.userId === ownerId)) {
        const name = (ownerName ?? "").trim();
        roster.unshift({ userId: ownerId, label: name || "Admin", email: name ? "Admin" : "" });
      }
      setPeople(roster);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ownerName]);

  return people;
}

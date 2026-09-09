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
      const ownerId = membership?.ownerId ?? "";
      const { data } = await supabase
        .from("workspace_members")
        .select("member_user_id, label, email")
        .eq("workspace_owner_id", ownerId);
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

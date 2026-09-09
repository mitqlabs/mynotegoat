"use client";

/**
 * Unread Messages counter for the nav badge. Counts workspace_messages
 * newer than this viewer's "last seen" mark that weren't posted by them.
 * Live: bumps on realtime INSERT, resets when the Messages tab marks seen.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { getLastSeen, MESSAGES_SEEN_EVENT } from "@/lib/messages-read";

export function useUnreadMessages(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Resolve the workspace id INSIDE the effect so deps can stay `[]` —
    // registering a window listener + realtime channel with a changing dep
    // is the listener-leak pattern the app guards against.
    const workspaceId = getActiveWorkspaceIdSync();
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !workspaceId) return;
    let active = true;
    let myId = "";

    const recount = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      myId = session?.user?.id ?? "";
      const lastSeen = getLastSeen();
      let query = supabase
        .from("workspace_messages")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .neq("author_user_id", myId);
      if (lastSeen) query = query.gt("created_at", lastSeen);
      const { count: c, error } = await query;
      if (!active || error) return;
      setCount(c ?? 0);
    };

    void recount();

    const channel = supabase
      .channel(`unread_messages:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workspace_messages", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (String(row.author_user_id ?? "") === myId) return;
          setCount((c) => c + 1);
        },
      )
      .subscribe();

    const onSeen = () => setCount(0);
    window.addEventListener(MESSAGES_SEEN_EVENT, onSeen);

    return () => {
      active = false;
      window.removeEventListener(MESSAGES_SEEN_EVENT, onSeen);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return count;
}

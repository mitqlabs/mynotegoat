"use client";

/**
 * Team Messages — a shared, realtime workspace feed (Slack-style).
 * Reads/writes the `workspace_messages` table; subscribes to realtime so new
 * posts appear live for everyone in the workspace. Requires
 * supabase/workspace_messages_table.sql to have been run.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { logActivity } from "@/lib/activity-log";

export interface MessageMention {
  userId: string;
  label: string;
}

export interface WorkspaceMessage {
  id: string;
  authorUserId: string;
  authorLabel: string;
  body: string;
  patientId: string;
  patientName: string;
  mentions: MessageMention[];
  createdAt: string;
  /** Quote-reply: the message this one replies to (empty when not a reply). */
  replyToId: string;
  replyToAuthor: string;
  replyToExcerpt: string;
  /** Root message of this reply chain ('' on rows from before threads). */
  threadRootId: string;
  /** Eyes Only: visible only to `visibleTo` (user ids, author included). */
  isPrivate: boolean;
  visibleTo: string[];
}

function rowToMessage(row: Record<string, unknown>): WorkspaceMessage {
  const rawMentions = row.mentions;
  const mentions: MessageMention[] = Array.isArray(rawMentions)
    ? (rawMentions as unknown[])
        .map((m) =>
          m && typeof m === "object"
            ? {
                userId: String((m as Record<string, unknown>).userId ?? ""),
                label: String((m as Record<string, unknown>).label ?? ""),
              }
            : null,
        )
        .filter((m): m is MessageMention => Boolean(m))
    : [];
  return {
    id: String(row.id),
    authorUserId: String(row.author_user_id ?? ""),
    authorLabel: String(row.author_label ?? ""),
    body: String(row.body ?? ""),
    patientId: String(row.patient_id ?? ""),
    patientName: String(row.patient_name ?? ""),
    mentions,
    createdAt: String(row.created_at ?? ""),
    replyToId: String(row.reply_to_id ?? ""),
    replyToAuthor: String(row.reply_to_author ?? ""),
    replyToExcerpt: String(row.reply_to_excerpt ?? ""),
    threadRootId: String(row.thread_root_id ?? ""),
    isPrivate: row.is_private === true,
    visibleTo: Array.isArray(row.visible_to) ? (row.visible_to as unknown[]).map(String) : [],
  };
}

export function useWorkspaceMessages() {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  // True once supabase/workspace_messages_private_threads.sql has been run.
  // Eyes Only and whole-thread delete stay off until then, so posting never
  // sends columns the table doesn't have.
  const [supportsPrivateThreads, setSupportsPrivateThreads] = useState(false);
  const workspaceId = getActiveWorkspaceIdSync();
  // Guard so realtime handlers don't append a message we already have.
  const idsRef = useRef<Set<string>>(new Set());
  // Current list, so a delete can log what it removed.
  const messagesRef = useRef<WorkspaceMessage[]>([]);
  messagesRef.current = messages;

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !workspaceId) {
      setLoading(false);
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setCurrentUserId(session?.user?.id ?? "");
    const { data, error } = await supabase
      .from("workspace_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      setNotReady(/relation .*workspace_messages.* does not exist|schema cache/i.test(error.message));
      setLoading(false);
      return;
    }
    const list = (data ?? []).map(rowToMessage);
    // Detect the private-threads columns without depending on there being
    // any messages: an empty feed can't show us a row to inspect.
    const probe = await supabase.from("workspace_messages").select("is_private, visible_to, thread_root_id").limit(1);
    setSupportsPrivateThreads(!probe.error);
    idsRef.current = new Set(list.map((m) => m.id));
    setMessages(list);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void load();
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !workspaceId) return;
    const channel = supabase
      .channel(`workspace_messages:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workspace_messages", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const msg = rowToMessage(payload.new as Record<string, unknown>);
          if (idsRef.current.has(msg.id)) return;
          idsRef.current.add(msg.id);
          setMessages((cur) => [...cur, msg].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "workspace_messages", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const id = String((payload.old as Record<string, unknown>)?.id ?? "");
          if (!id) return;
          idsRef.current.delete(id);
          setMessages((cur) => cur.filter((m) => m.id !== id));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, load]);

  const postMessage = useCallback(
    async (input: {
      body: string;
      authorLabel: string;
      patientId?: string;
      patientName?: string;
      mentions?: MessageMention[];
      replyTo?: { id: string; author: string; excerpt: string };
      /** Root of the thread being replied to (falls back to replyTo.id). */
      threadRootId?: string;
      /** Eyes Only recipients (user ids). Author is added automatically. */
      privateTo?: string[];
    }) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !workspaceId) return false;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return false;
      const id = `MSG-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const row = {
        id,
        workspace_id: workspaceId,
        author_user_id: uid,
        author_label: input.authorLabel || "You",
        body: input.body,
        patient_id: input.patientId ?? "",
        patient_name: input.patientName ?? "",
        mentions: input.mentions ?? [],
        reply_to_id: input.replyTo?.id ?? "",
        reply_to_author: input.replyTo?.author ?? "",
        reply_to_excerpt: input.replyTo?.excerpt ?? "",
        ...(supportsPrivateThreads
          ? {
              thread_root_id: input.replyTo ? input.threadRootId || input.replyTo.id : id,
              is_private: Boolean(input.privateTo && input.privateTo.length > 0),
              visible_to: input.privateTo && input.privateTo.length > 0
                ? Array.from(new Set([uid, ...input.privateTo]))
                : [],
            }
          : {}),
      };
      // Optimistic insert.
      const optimistic = rowToMessage({ ...row, created_at: new Date().toISOString() });
      idsRef.current.add(id);
      setMessages((cur) => [...cur, optimistic]);
      const { error } = await supabase.from("workspace_messages").insert(row);
      if (error) {
        idsRef.current.delete(id);
        setMessages((cur) => cur.filter((m) => m.id !== id));
        return false;
      }
      return true;
    },
    [workspaceId, supportsPrivateThreads],
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !workspaceId) return;
      const doomed = messagesRef.current.find((m) => m.id === id);
      idsRef.current.delete(id);
      setMessages((cur) => cur.filter((m) => m.id !== id));
      const { error } = await supabase.from("workspace_messages").delete().eq("workspace_id", workspaceId).eq("id", id);
      if (!error && doomed) {
        // Eyes Only messages are logged without their text: the log is read
        // by admins, and those messages were deliberately hidden from them.
        logActivity({
          category: "messages",
          action: "message.deleted",
          summary: `Deleted a message by ${doomed.authorLabel}${doomed.isPrivate ? " (Eyes Only)" : ""}`,
          patientId: doomed.patientId || undefined,
          patientName: doomed.patientName || undefined,
          details: doomed.isPrivate ? { messageId: id } : { messageId: id, copy: doomed.body },
        });
      }
    },
    [workspaceId],
  );

  /** Delete a thread: its root message and every reply in it. */
  const deleteThread = useCallback(
    async (rootId: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !workspaceId || !rootId) return false;
      const doomed = new Set(
        messages.filter((m) => m.id === rootId || m.threadRootId === rootId).map((m) => m.id),
      );
      doomed.forEach((id) => idsRef.current.delete(id));
      setMessages((cur) => cur.filter((m) => !doomed.has(m.id)));
      const { error } = await supabase
        .from("workspace_messages")
        .delete()
        .eq("workspace_id", workspaceId)
        .or(`id.eq.${rootId},thread_root_id.eq.${rootId}`);
      if (error) {
        await load(); // restore what's really there
        return false;
      }
      const root = messages.find((m) => m.id === rootId);
      if (root) {
        const replies = doomed.size - 1;
        logActivity({
          category: "messages",
          action: "message.thread_deleted",
          summary: `Deleted a thread by ${root.authorLabel} with ${replies} repl${replies === 1 ? "y" : "ies"}${root.isPrivate ? " (Eyes Only)" : ""}`,
          patientId: root.patientId || undefined,
          patientName: root.patientName || undefined,
          details: root.isPrivate
            ? { rootId }
            : {
                rootId,
                copy: messages
                  .filter((m) => doomed.has(m.id))
                  .map((m) => `${m.authorLabel}: ${m.body}`)
                  .join("\n"),
              },
        });
      }
      return true;
    },
    [workspaceId, messages, load],
  );

  return {
    messages,
    loading,
    notReady,
    currentUserId,
    supportsPrivateThreads,
    postMessage,
    deleteMessage,
    deleteThread,
    reload: load,
  };
}

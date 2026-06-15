"use client";

/**
 * Shared helpers for subscribing React hooks to Supabase Realtime
 * postgres_changes events. Cuts ~30 lines of boilerplate per hook
 * that needs cross-device sync.
 *
 * One pattern is in use across every hook that wants realtime:
 *
 *   useEffect mount → resolve workspaceId from auth.getUser() →
 *   open a Supabase channel filtered to the right table and (when
 *   applicable) workspace_kv key → on postgres_changes event,
 *   fire the supplied callback → on unmount, unsubscribe.
 *
 * Both helpers below encode that pattern. The hook's responsibility
 * is just to provide a callback that knows how to bring its React
 * state in sync after a remote change.
 *
 * Requires Supabase Realtime enabled on the relevant table — see
 * supabase/workspace_kv_realtime.sql for the one-time setup.
 */

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Unsubscribe = () => void;

async function resolveWorkspaceId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Subscribe to changes on a specific workspace_kv row.
 *
 * Use case: any hook backed by a localStorage key that's mirrored to
 * workspace_kv (use-patient-follow-up-overrides, use-cash-payments,
 * use-case-statuses, etc.). The hook gets notified the moment another
 * device upserts the row and can refetch the canonical value.
 *
 * The callback receives the raw new `value` JSON straight from the
 * realtime payload. Hooks should still validate / normalize that value
 * because realtime payloads aren't RLS-filtered through the same
 * normalize path that a SELECT would be.
 */
export function useWorkspaceKvRealtime(
  storageKey: string,
  onChange: (newValue: unknown) => void,
) {
  useEffect(() => {
    let cancelled = false;
    let cleanup: Unsubscribe | null = null;
    const setup = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const workspaceId = await resolveWorkspaceId();
      if (!workspaceId || cancelled) return;
      const channel = supabase
        .channel(`kv-realtime:${workspaceId}:${storageKey}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_kv",
            filter: `key=eq.${storageKey}`,
          },
          (payload) => {
            if (cancelled) return;
            // payload.new is the upserted row. For DELETE events
            // payload.new is empty — fall back to "no value" so the
            // hook clears its state.
            const newRow = payload.new as { value?: unknown } | undefined;
            onChange(newRow?.value ?? null);
          },
        )
        .subscribe();
      cleanup = () => {
        void channel.unsubscribe();
      };
    };
    void setup();
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // storageKey is stable per hook (compile-time constant). onChange
    // is intentionally NOT in deps — the closure captures the latest
    // handler at subscribe time, which is fine for this use case.
    // Putting it in deps causes a resubscribe per render which thrashes
    // the Supabase channel pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
}

/**
 * Subscribe to changes on a per-record table (encounter_notes,
 * schedule_appointments, patients, etc.). The callback fires for any
 * INSERT / UPDATE / DELETE on the table for this workspace.
 *
 * For per-record tables, the hook usually wants to refetch the full
 * set rather than trying to reconcile from the single-row payload —
 * the realtime payload doesn't include the RLS-validated row shape
 * the hook normalizes from a SELECT, and edge cases (workspace
 * filtering, soft deletes, etc.) are easier to get right with a full
 * refetch than with surgical row patching.
 */
export function useTableRealtime(
  tableName: string,
  onChange: () => void,
) {
  useEffect(() => {
    let cancelled = false;
    let cleanup: Unsubscribe | null = null;
    const setup = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const workspaceId = await resolveWorkspaceId();
      if (!workspaceId || cancelled) return;
      const channel = supabase
        .channel(`table-realtime:${workspaceId}:${tableName}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: tableName,
          },
          () => {
            if (cancelled) return;
            onChange();
          },
        )
        .subscribe();
      cleanup = () => {
        void channel.unsubscribe();
      };
    };
    void setup();
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);
}

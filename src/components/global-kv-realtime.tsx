"use client";

/**
 * Global Workspace KV Realtime listener.
 *
 * Mounts once in the portal layout (after bootstrap) and subscribes
 * to EVERY change on the workspace_kv table for the active user. On
 * any insert/update/delete, the new value is written into localStorage
 * under the matching key AND notifyChange() is fired for that key.
 *
 * Why this exists:
 *
 *   Every entity hook in the app (use-cash-payments,
 *   use-patient-billing, use-office-settings, use-case-statuses,
 *   use-tasks, ...22 more) follows the same pattern:
 *
 *     - useState(() => loadXFromLocalStorage())
 *     - onLocalChange listener that re-reads localStorage on change
 *     - saveX writes localStorage + dual-writes cloud
 *
 *   The cross-device sync gap is that nothing in those hooks listens
 *   to the cloud-side. A change made on Device A reaches Device B's
 *   cloud table, but Device B's localStorage doesn't know about it
 *   until the next bootstrap (page refresh).
 *
 *   This global listener closes that gap for the entire family of
 *   KV-backed hooks in one place. When realtime fires for any
 *   workspace_kv row:
 *     - Write the new value to localStorage under the matching key
 *     - notifyChange(key) so any mounted hook with an onLocalChange
 *       listener picks it up immediately
 *
 *   Hooks don't need to import anything new. The behavior is
 *   automatic: open the patient page on the laptop and the tablet,
 *   toggle "No MRI" on the laptop, the tablet's React tree updates
 *   within a second because:
 *
 *     1. Laptop write goes to workspace_kv (cloud)
 *     2. Realtime publishes the change
 *     3. Tablet's GlobalKvRealtime listener receives the event,
 *        updates the tablet's localStorage, and fires notifyChange()
 *     4. The tablet's usePatientFollowUpOverrides hook (which has
 *        an existing onLocalChange listener) re-reads localStorage
 *     5. React re-renders with the new value
 *
 * Last-write-wins: if Device A and Device B both edit the same KV
 * blob at the same instant, whichever upsert hits the table last
 * wins, and the loser's value gets quietly overwritten on the
 * loser's device via this same listener. For KV blobs (settings,
 * macros, overrides) this is acceptable. Per-record tables
 * (encounters, appointments) don't have this problem because each
 * record is its own row.
 *
 * Requires Supabase Realtime enabled on workspace_kv — see
 * supabase/workspace_kv_realtime.sql.
 */

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { notifyChange } from "@/lib/local-sync";

export function GlobalKvRealtime() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const setup = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      const workspaceId = userData.user?.id;
      if (!workspaceId || cancelled) return;
      const channel = supabase
        .channel(`global-kv-realtime:${workspaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_kv",
          },
          (payload) => {
            if (cancelled) return;
            const newRow = payload.new as { key?: string; value?: unknown } | undefined;
            const oldRow = payload.old as { key?: string } | undefined;
            const key = newRow?.key ?? oldRow?.key;
            if (!key || !key.startsWith("casemate.")) return;

            try {
              if (payload.eventType === "DELETE") {
                window.localStorage.removeItem(key);
              } else {
                const value = newRow?.value;
                if (value === undefined || value === null) {
                  window.localStorage.removeItem(key);
                } else {
                  window.localStorage.setItem(key, JSON.stringify(value));
                }
              }
            } catch (err) {
              console.warn(
                `[global-kv-realtime] localStorage write failed for "${key}":`,
                err,
              );
              return;
            }

            // Wake any mounted hook listening on this key. selfWriteCountRef
            // counters in those hooks won't decrement because this isn't a
            // self-write — they'll re-read and update React state. Perfect.
            notifyChange(key);
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
  }, []);

  return null;
}

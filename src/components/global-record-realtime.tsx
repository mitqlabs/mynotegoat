"use client";

/**
 * Global per-record table realtime listener.
 *
 * Subscribes to changes on the `patients` table for the active user
 * and reloads the in-memory patient list when another device makes a
 * change. Same shape as GlobalKvRealtime but for the per-record
 * table that doesn't fit the KV pattern.
 *
 * Encounter notes and schedule appointments already have their own
 * per-hook realtime subscriptions (see use-encounter-notes.ts and
 * use-schedule-appointments.ts). Patients are different — there's
 * no dedicated React hook for the patient LIST; components import
 * the module-level `patients` array from mock-data and read from it
 * directly. So we wire realtime at the global mount layer instead
 * of inside a hook.
 *
 * On any insert/update/delete in the patients table, we re-fetch
 * the canonical cloud list and replace the module-level array
 * (via replacePatientsFromCloud, which is the existing path the
 * bootstrap uses). React components that read from `patients`
 * automatically render the new data on next re-render.
 *
 * Requires Supabase Realtime enabled on patients — see
 * supabase/workspace_kv_realtime.sql.
 */

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function GlobalRecordRealtime() {
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
        .channel(`global-patients-realtime:${workspaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "patients",
          },
          async () => {
            if (cancelled) return;
            try {
              const [{ fetchAllPatientsFromTable }, { replacePatientsFromCloud }] = await Promise.all([
                import("@/lib/patients-cloud"),
                import("@/lib/mock-data"),
              ]);
              const fresh = await fetchAllPatientsFromTable();
              if (!fresh || cancelled) return;
              replacePatientsFromCloud(fresh);
              // The patients array is mutated in place by
              // replacePatientsFromCloud. Components that read it on
              // their next render see the new state. There's no
              // hook-level setState to fire here.
            } catch (err) {
              console.warn("[global-record-realtime] patients refresh failed:", err);
            }
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

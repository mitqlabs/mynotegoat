"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadScheduleAppointments,
  saveScheduleAppointments,
  type ScheduleAppointmentRecord,
} from "@/lib/schedule-appointments";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

const SYNC_KEY = "casemate.schedule-appointments.v1";

function compareAppointments(left: ScheduleAppointmentRecord, right: ScheduleAppointmentRecord) {
  const leftKey = `${left.date} ${left.startTime}`;
  const rightKey = `${right.date} ${right.startTime}`;
  return leftKey.localeCompare(rightKey);
}

export function useScheduleAppointments() {
  const [scheduleAppointments, setScheduleAppointments] = useState<ScheduleAppointmentRecord[]>(() =>
    loadScheduleAppointments(),
  );

  const selfWriteCountRef = useRef(0);

  // Listen for changes made by other hook instances on this page
  useEffect(() => {
    return onLocalChange(SYNC_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setScheduleAppointments(loadScheduleAppointments());
    });
  }, []);

  // ── Realtime subscription on schedule_appointments table ──
  //
  // PAYLOAD-BASED UPDATES. The previous handler refetched the full
  // appointment list from cloud on every realtime event, which had
  // two problems:
  //   1. Refetches consumed Supabase Disk IO on a budget that's
  //      already tight, cascading into "Failed to fetch" errors.
  //   2. Rapid local changes (e.g. checking in 5 patients back-to-
  //      back) raced with the refetch — the fetched snapshot might
  //      have one of the recent saves still pending in cloud, and
  //      the full-replace `setScheduleAppointments([...cloud])`
  //      would clobber the in-flight local Check In, making the
  //      row visibly revert to Scheduled.
  //
  // Both gone with payload-based merging: use payload.new directly,
  // patch one record in state, no Supabase round-trip per event.
  // Self-write echoes are idempotent (we'd just patch state with
  // the same value we just set).
  //
  // Requires Supabase Realtime enabled on the table — see
  // supabase/workspace_kv_realtime.sql.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const setupChannel = async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      const workspaceId = userData.user?.id;
      if (!workspaceId || cancelled) return;
      const channel = supabase
        .channel(`appointments-realtime:${workspaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "schedule_appointments",
          },
          (payload) => {
            if (cancelled) return;
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id?: string } | undefined)?.id;
              if (!oldId) return;
              setScheduleAppointments((current) => {
                const idx = current.findIndex((a) => a.id === oldId);
                if (idx < 0) return current;
                const next = [...current];
                next.splice(idx, 1);
                return next;
              });
              return;
            }
            void import("@/lib/appointments-cloud").then(
              ({ realtimePayloadToAppointment }) => {
                if (cancelled) return;
                const incoming = realtimePayloadToAppointment(payload.new);
                if (!incoming) return;
                setScheduleAppointments((current) => {
                  const idx = current.findIndex((a) => a.id === incoming.id);
                  if (idx < 0) {
                    return [...current, incoming].sort(compareAppointments);
                  }
                  // Replace the matching row; no merge-by-updatedAt
                  // because appointments don't track updatedAt and
                  // are typically small atomic updates.
                  const next = [...current];
                  next[idx] = incoming;
                  return next.sort(compareAppointments);
                });
              },
            );
          },
        )
        .subscribe();
      cleanup = () => {
        void channel.unsubscribe();
      };
    };
    void setupChannel();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const updateScheduleAppointments = useCallback(
    (updater: (current: ScheduleAppointmentRecord[]) => ScheduleAppointmentRecord[]) => {
      setScheduleAppointments((current) => {
        const next = updater(current).sort(compareAppointments);
        saveScheduleAppointments(next);
        selfWriteCountRef.current++;
        notifyChange(SYNC_KEY);
        return next;
      });
    },
    [],
  );

  const addAppointments = useCallback(
    (records: ScheduleAppointmentRecord[]) => {
      if (!records.length) {
        return;
      }
      updateScheduleAppointments((current) => [...current, ...records]);
    },
    [updateScheduleAppointments],
  );

  const updateAppointment = useCallback(
    (appointmentId: string, updater: (current: ScheduleAppointmentRecord) => ScheduleAppointmentRecord) => {
      updateScheduleAppointments((current) =>
        current.map((entry) => (entry.id === appointmentId ? updater(entry) : entry)),
      );
    },
    [updateScheduleAppointments],
  );

  const updateManyAppointments = useCallback(
    (
      predicate: (entry: ScheduleAppointmentRecord) => boolean,
      updater: (current: ScheduleAppointmentRecord) => ScheduleAppointmentRecord,
    ) => {
      updateScheduleAppointments((current) =>
        current.map((entry) => (predicate(entry) ? updater(entry) : entry)),
      );
    },
    [updateScheduleAppointments],
  );

  const removeAppointment = useCallback(
    (appointmentId: string) => {
      updateScheduleAppointments((current) =>
        current.filter((entry) => entry.id !== appointmentId),
      );
      // The auto-delete diff inside dualWriteAppointmentsToCloud was
      // removed because it was wiping appointments that were merely
      // absent from a slow / cold React-state initialization (see the
      // long comment in src/lib/schedule-appointments.ts). User-
      // initiated deletes now go through this explicit cloud-delete
      // path instead, mirroring the encounter-notes hook.
      void import("@/lib/appointments-cloud").then(
        ({ deleteAppointmentFromTable }) =>
          deleteAppointmentFromTable(appointmentId).catch((err) => {
            console.error(
              `[use-schedule-appointments] cloud delete(${appointmentId}) failed:`,
              err,
            );
          }),
      );
    },
    [updateScheduleAppointments],
  );

  return {
    scheduleAppointments,
    addAppointments,
    updateAppointment,
    updateManyAppointments,
    removeAppointment,
  };
}

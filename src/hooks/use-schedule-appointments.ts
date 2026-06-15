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
  // Cross-device sync without a refresh. Identical pattern to the
  // one in use-encounter-notes.ts (see that file's comment for full
  // rationale). When any device upserts or deletes an appointment
  // row for this workspace, we refetch from cloud and update React
  // state. Hard requirement: Supabase Realtime must be enabled on
  // this table — see supabase/workspace_kv_realtime.sql.
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
          async () => {
            if (cancelled) return;
            const { fetchAllAppointmentsFromTable } = await import("@/lib/appointments-cloud");
            const cloud = await fetchAllAppointmentsFromTable();
            if (!cloud || cancelled) return;
            // Replace whole list from cloud — appointments are
            // ID-stable and small enough that a full refresh is
            // cheaper than a per-row merge. The cloud IS truth.
            setScheduleAppointments([...cloud].sort(compareAppointments));
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

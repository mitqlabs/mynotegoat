"use client";

/**
 * Appointments Cloud — table-backed CRUD for schedule appointments.
 * Phase-2 of the cloud-as-truth migration. Same pattern as patients-cloud.ts.
 */

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { reportCloudWriteError } from "@/lib/storage-sync-interceptor";
import {
  resolveValidatedWorkspaceId as resolveValidatedWorkspaceIdShared,
  withLockStealRetry,
} from "@/lib/cloud-auth";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";

interface AppointmentRow {
  id: string;
  workspace_id: string;
  patient_id: string;
  patient_name: string;
  provider: string;
  location: string;
  appointment_type: string;
  case_label: string;
  room: string;
  date: string;
  start_time: string;
  duration_min: number;
  status: string;
  note: string;
  override_office_hours: boolean;
  recurring_series_id: string | null;
  created_at?: string;
  updated_at?: string;
}

function appointmentToRow(appt: ScheduleAppointmentRecord, workspaceId: string): AppointmentRow {
  return {
    id: appt.id,
    workspace_id: workspaceId,
    patient_id: appt.patientId ?? "",
    patient_name: appt.patientName ?? "",
    provider: appt.provider ?? "",
    location: appt.location ?? "",
    appointment_type: appt.appointmentType ?? "",
    case_label: appt.caseLabel ?? "",
    room: appt.room ?? "",
    date: appt.date ?? "",
    start_time: appt.startTime ?? "08:00",
    duration_min: appt.durationMin ?? 30,
    status: appt.status ?? "Scheduled",
    note: appt.note ?? "",
    override_office_hours: appt.overrideOfficeHours ?? false,
    recurring_series_id: appt.recurringSeriesId ?? null,
  };
}

function rowToAppointment(row: AppointmentRow): ScheduleAppointmentRecord {
  return {
    id: row.id,
    patientId: row.patient_id ?? "",
    patientName: row.patient_name ?? "",
    provider: row.provider ?? "",
    location: row.location ?? "",
    appointmentType: row.appointment_type ?? "",
    caseLabel: row.case_label ?? "",
    room: row.room ?? "",
    date: row.date ?? "",
    startTime: row.start_time ?? "08:00",
    durationMin: row.duration_min ?? 30,
    status: (row.status as ScheduleAppointmentRecord["status"]) ?? "Scheduled",
    note: row.note ?? "",
    overrideOfficeHours: row.override_office_hours ?? false,
    recurringSeriesId: row.recurring_series_id ?? undefined,
  };
}

function getActiveWorkspaceOrNull(): string | null {
  const id = getActiveWorkspaceIdSync();
  return id || null;
}

/**
 * Validate workspace_id prefix matches auth.uid() BEFORE writing. Uses the
 * shared cloud-auth helper so validations are cached + deduped across every
 * *-cloud module (prevents navigator.locks auth-lock contention during
 * bulk write bursts).
 */
async function resolveValidatedWorkspaceId(source: string): Promise<string> {
  return resolveValidatedWorkspaceIdShared("[appointments-cloud]", source);
}

export async function fetchAllAppointmentsFromTable(): Promise<ScheduleAppointmentRecord[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return null;

  const { data, error } = await supabase
    .from("schedule_appointments")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("[appointments-cloud] fetchAll failed:", error.message);
    return null;
  }
  return ((data ?? []) as AppointmentRow[]).map(rowToAppointment);
}

export async function bulkUpsertAppointmentsToTable(
  appointments: ScheduleAppointmentRecord[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (appointments.length === 0) return { ok: true, count: 0 };

  // Same retry treatment as the per-row upsert path.
  try {
    const result = await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`bulk-upsert(${appointments.length})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error("[appointments-cloud] bulk upsert: supabase client not configured");
      }
      const rows = appointments.map((a) => appointmentToRow(a, workspaceId));
      const { error } = await supabase
        .from("schedule_appointments")
        .upsert(rows, { onConflict: "workspace_id,id" });
      if (error) {
        throw new Error(`[appointments-cloud] bulk upsert failed: ${error.message}`);
      }
      return rows.length;
    });
    return { ok: true, count: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[appointments-cloud] bulk upsert failed:", message);
    return { ok: false, count: 0, error: message };
  }
}

/**
 * Upsert a single appointment. THROWS on failure so callers know. Previous
 * silent-error behavior was the same shape as the encounter-notes bug.
 */
export async function upsertAppointmentToTable(appt: ScheduleAppointmentRecord): Promise<void> {
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`upsert(${appt.id})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error(`[appointments-cloud] upsert(${appt.id}): supabase client not configured`);
      }
      const row = appointmentToRow(appt, workspaceId);
      const { error } = await supabase
        .from("schedule_appointments")
        .upsert(row, { onConflict: "workspace_id,id" });
      if (error) {
        throw new Error(
          `[appointments-cloud] upsert(${appt.id}) failed: ${error.message}`,
        );
      }
    });
  } catch (err) {
    const wrapped =
      err instanceof Error
        ? err
        : new Error(`[appointments-cloud] upsert(${appt.id}) failed: ${String(err)}`);
    reportCloudWriteError("appointments upsert", wrapped);
    throw wrapped;
  }
}

export async function deleteAppointmentFromTable(appointmentId: string): Promise<void> {
  try {
    await withLockStealRetry(async () => {
      const workspaceId = await resolveValidatedWorkspaceId(`delete(${appointmentId})`);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error(`[appointments-cloud] delete(${appointmentId}): supabase client not configured`);
      }
      const { error } = await supabase
        .from("schedule_appointments")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", appointmentId);
      if (error) {
        throw new Error(
          `[appointments-cloud] delete(${appointmentId}) failed: ${error.message}`,
        );
      }
    });
  } catch (err) {
    const wrapped =
      err instanceof Error
        ? err
        : new Error(`[appointments-cloud] delete(${appointmentId}) failed: ${String(err)}`);
    reportCloudWriteError("appointments delete", wrapped);
    throw wrapped;
  }
}

export async function isAppointmentsTableReady(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  const workspaceId = getActiveWorkspaceOrNull();
  if (!workspaceId) return false;

  const { error } = await supabase
    .from("schedule_appointments")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    console.warn("[appointments-cloud] table not ready:", error.message);
    return false;
  }
  return true;
}

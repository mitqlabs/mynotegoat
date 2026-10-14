/**
 * Server-only helpers for the reminder device API. The device token is the
 * only credential; every query below is pinned to the device's workspace.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { hashDeviceToken, type OfficeHoursDay, type ReminderOffice } from "@/lib/reminder-automation";
import { normalizeSmsReminderSettings, type SmsReminderSettings } from "@/lib/sms-reminders";

export interface ReminderDevice {
  id: string;
  workspace_id: string;
  name: string;
  kind: string;
  last_run_at: string | null;
  run_requested_until: string | null;
  is_primary: boolean;
}

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticateDevice(
  admin: SupabaseClient,
  authorization: string | null,
): Promise<ReminderDevice | null> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("ngr_") || token.length < 40) return null;
  const hash = await hashDeviceToken(token);
  const { data, error } = await admin
    .from("reminder_devices")
    .select("id, workspace_id, name, kind, last_run_at, run_requested_until, is_primary, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    name: data.name,
    kind: data.kind ?? "mac",
    last_run_at: data.last_run_at ?? null,
    run_requested_until: data.run_requested_until ?? null,
    is_primary: data.is_primary === true,
  };
}

export interface WorkspaceReminderConfig {
  settings: SmsReminderSettings;
  templateBody: string;
  office: ReminderOffice;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
}

type Kv = Record<string, unknown>;

function closedDates(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const row = raw as { startDate?: string; endDate?: string; officeStatus?: string };
    if (row?.officeStatus && row.officeStatus !== "Closed") continue;
    if (!row?.startDate) continue;
    let iso = row.startDate;
    const end = row.endDate || row.startDate;
    for (let i = 0; i < 400 && iso <= end; i += 1) {
      out.add(iso);
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      iso = d.toISOString().slice(0, 10);
    }
  }
  return out;
}

export async function loadWorkspaceConfig(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceReminderConfig> {
  const keys = [
    "casemate.sms-reminders.v1",
    "casemate.sms-templates.v1",
    "casemate.office-settings.v1",
    "casemate.schedule-settings.v1",
    "casemate.key-dates.v1",
  ];
  const { data } = await admin.from("workspace_kv").select("key, value").eq("workspace_id", workspaceId).in("key", keys);
  const kv: Kv = {};
  for (const row of data ?? []) kv[row.key as string] = row.value;

  const settings = normalizeSmsReminderSettings(kv["casemate.sms-reminders.v1"]);
  const templates = Array.isArray(kv["casemate.sms-templates.v1"])
    ? (kv["casemate.sms-templates.v1"] as { id?: string; name?: string; body?: string }[])
    : [];
  const template =
    templates.find((t) => t.id === settings.templateId) ??
    templates.find((t) => /remind/i.test(t.name ?? "")) ??
    templates[0];
  const officeRaw = (kv["casemate.office-settings.v1"] ?? {}) as Record<string, unknown>;
  const scheduleRaw = (kv["casemate.schedule-settings.v1"] ?? {}) as Record<string, unknown>;
  const officeHours = Array.isArray(scheduleRaw.officeHours)
    ? (scheduleRaw.officeHours as OfficeHoursDay[]).map((d) => ({ dayOfWeek: Number(d.dayOfWeek), enabled: d.enabled === true }))
    : [];
  const locations = Array.isArray(officeRaw.locations)
    ? (officeRaw.locations as { id?: string; phone?: string; name?: string }[])
        .filter((l) => typeof l?.id === "string")
        .map((l) => ({ id: l.id as string, phone: typeof l.phone === "string" ? l.phone : "", name: l.name }))
    : [];
  return {
    settings,
    templateBody: typeof template?.body === "string" ? template.body : "",
    office: {
      officeName: typeof officeRaw.officeName === "string" ? officeRaw.officeName : "",
      doctorName: typeof officeRaw.doctorName === "string" ? officeRaw.doctorName : "",
      phone: typeof officeRaw.phone === "string" ? officeRaw.phone : "",
      locations,
    },
    officeHours,
    closedIsoDates: closedDates(kv["casemate.key-dates.v1"]),
  };
}

export async function loadVisitDay(
  admin: SupabaseClient,
  workspaceId: string,
  visitDate: string,
): Promise<{ appointments: ScheduleAppointmentRecord[]; patientsById: Map<string, PatientRecord> }> {
  const { data: appts } = await admin
    .from("schedule_appointments")
    .select("id, patient_id, patient_name, appointment_type, date, start_time, status")
    .eq("workspace_id", workspaceId)
    .eq("date", visitDate);
  const appointments = (appts ?? []).map(
    (row) =>
      ({
        id: row.id,
        patientId: row.patient_id,
        patientName: row.patient_name ?? "",
        appointmentType: row.appointment_type ?? "",
        date: row.date,
        startTime: row.start_time ?? "",
        status: row.status,
      }) as unknown as ScheduleAppointmentRecord,
  );
  const ids = Array.from(new Set(appointments.map((a) => a.patientId).filter(Boolean)));
  const patientsById = new Map<string, PatientRecord>();
  if (ids.length) {
    const { data: pts } = await admin
      .from("patients")
      .select("id, full_name, phone, location_id, text_reminders_off")
      .eq("workspace_id", workspaceId)
      .in("id", ids);
    for (const row of pts ?? []) {
      patientsById.set(row.id, {
        id: row.id,
        fullName: row.full_name ?? "",
        phone: row.phone ?? "",
        locationId: row.location_id ?? undefined,
        textRemindersOff: row.text_reminders_off === true ? true : undefined,
      } as PatientRecord);
    }
  }
  return { appointments, patientsById };
}

export async function alreadySentIds(
  admin: SupabaseClient,
  workspaceId: string,
  visitDate: string,
): Promise<Set<string>> {
  const { data } = await admin
    .from("reminder_log")
    .select("appointment_id")
    .eq("workspace_id", workspaceId)
    .eq("visit_date", visitDate)
    .eq("status", "sent");
  return new Set((data ?? []).map((row) => row.appointment_id as string));
}

/** Is another active device in this workspace marked primary? */
export async function otherPrimaryExists(admin: SupabaseClient, device: ReminderDevice): Promise<boolean> {
  if (device.is_primary) return false;
  const { data } = await admin
    .from("reminder_devices")
    .select("id")
    .eq("workspace_id", device.workspace_id)
    .eq("is_primary", true)
    .is("revoked_at", null)
    .neq("id", device.id)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Lease these appointments to the device; returns the ids it now holds. */
export async function claimReminders(
  admin: SupabaseClient,
  device: ReminderDevice,
  visitDate: string,
  ids: string[],
  minutes: number,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.rpc("claim_reminders", {
    p_workspace_id: device.workspace_id,
    p_device_id: device.id,
    p_visit_date: visitDate,
    p_appointment_ids: ids,
    p_minutes: minutes,
  });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (data ?? []) as unknown[];
  return new Set(rows.map((row) => (typeof row === "string" ? row : String((row as Record<string, unknown>).claim_reminders ?? ""))));
}

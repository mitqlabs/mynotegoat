/**
 * Server-only helpers for the reminder device API. The device token is the
 * only credential; every query below is pinned to the device's workspace.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { broadcastTimeOk, hashDeviceToken, parseOptOutReply, phoneMatchKey, withOptOutLine, type OfficeHoursDay, type ReminderOffice } from "@/lib/reminder-automation";
import { keyDateHoursForDate, keyDateHasHours, normalizeKeyDates, type KeyDateHours } from "@/lib/key-dates";
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
  /** Key Date special hours (partial closures / custom hours) by date. */
  hoursByDate: Map<string, KeyDateHours>;
}

type Kv = Record<string, unknown>;

/** Special hours for every date a Key Date with hours covers. */
export function hoursByDateFromKeyDates(value: unknown): Map<string, KeyDateHours> {
  const rows = normalizeKeyDates(value).filter(keyDateHasHours);
  const out = new Map<string, KeyDateHours>();
  for (const row of rows) {
    let iso = row.startDate;
    for (let i = 0; i < 400 && iso <= row.endDate; i += 1) {
      const h = keyDateHoursForDate(rows, iso);
      if (h) out.set(iso, h);
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      iso = d.toISOString().slice(0, 10);
    }
  }
  return out;
}

export function closedDates(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const row = raw as { startDate?: string; endDate?: string; officeStatus?: string; openStart?: string; openEnd?: string };
    if (row?.officeStatus && row.officeStatus !== "Closed") continue;
    // A Closed key date WITH hours is a partial day (see hoursByDate).
    if (row && keyDateHasHours(row)) continue;
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
    hoursByDate: hoursByDateFromKeyDates(kv["casemate.key-dates.v1"]),
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

export interface BroadcastQueueRow {
  recipientId: string;
  phone: string;
  text: string;
  createdAt: Date;
}

/**
 * Queued "Message patients" texts for this workspace whose target date is
 * today or later, not canceled, not opted out, and not leased to another
 * device. The phone is read from the patient record at send time.
 */
export async function loadBroadcastQueue(
  admin: SupabaseClient,
  device: ReminderDevice,
  todayIso: string,
  now: Date,
  nowHHMM: string,
  /** Opt-out line settings (appended to each text). */
  optOut: { optOutLine?: boolean; optOutText?: string } = { optOutLine: false },
): Promise<BroadcastQueueRow[]> {
  const query = (cols: string) =>
    admin
      .from("reminder_broadcast_recipients")
      .select(`id, patient_id, appointment_id, claimed_by, claimed_until, reminder_broadcasts!inner(${cols})`)
      .eq("workspace_id", device.workspace_id)
      .eq("status", "queued")
      .gte("reminder_broadcasts.target_date", todayIso)
      .is("reminder_broadcasts.canceled_at", null)
      .order("created_at", { ascending: true })
      .limit(300);
  let { data, error } = await query("message, target_date, created_at, canceled_at, start_time, end_time");
  // Time-window columns not migrated yet → read without them.
  if (error) ({ data, error } = await query("message, target_date, created_at, canceled_at"));
  // Table not migrated yet → behave as if there is nothing queued.
  if (error || !data?.length) return [];
  type B = { message: string; created_at: string; target_date: string; start_time?: string | null; end_time?: string | null };
  type Row = {
    id: string;
    patient_id: string;
    appointment_id: string | null;
    claimed_by: string | null;
    claimed_until: string | null;
    reminder_broadcasts: B | B[];
  };
  const rows = (data as unknown as Row[]).filter(
    (r) => !r.claimed_until || r.claimed_by === device.id || new Date(r.claimed_until) < now,
  );
  const ids = Array.from(new Set(rows.map((r) => r.patient_id)));
  if (!ids.length) return [];
  // Chunked: an all-active broadcast can hold hundreds of ids (URL length).
  const pts: { id: unknown; phone: unknown; text_reminders_off: unknown }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: part } = await admin
      .from("patients")
      .select("id, phone, text_reminders_off")
      .eq("workspace_id", device.workspace_id)
      .in("id", ids.slice(i, i + 100));
    pts.push(...(part ?? []));
  }
  const phoneById = new Map(
    pts.filter((p) => p.text_reminders_off !== true).map((p) => [p.id as string, String(p.phone ?? "")]),
  );
  // Visit times, so a text never goes to a visit that already passed (or
  // one outside the chosen window).
  const apptIds = Array.from(new Set(rows.map((r) => r.appointment_id).filter((v): v is string => Boolean(v))));
  const timeByAppt = new Map<string, string>();
  if (apptIds.length) {
    const { data: appts } = await admin
      .from("schedule_appointments")
      .select("id, start_time")
      .eq("workspace_id", device.workspace_id)
      .in("id", apptIds);
    for (const a of appts ?? []) timeByAppt.set(a.id as string, String(a.start_time ?? ""));
  }
  const out: BroadcastQueueRow[] = [];
  for (const r of rows) {
    const b = Array.isArray(r.reminder_broadcasts) ? r.reminder_broadcasts[0] : r.reminder_broadcasts;
    const time = r.appointment_id ? timeByAppt.get(r.appointment_id) : undefined;
    if (r.appointment_id && time === undefined) continue; // visit deleted
    if (
      b &&
      !broadcastTimeOk(time ?? "", {
        startTime: b.start_time ?? undefined,
        endTime: b.end_time ?? undefined,
        notBefore: b.target_date === todayIso ? nowHHMM : undefined,
      })
    ) continue;
    const digits = (phoneById.get(r.patient_id) ?? "").replace(/\D/g, "");
    const phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
    if (!b?.message?.trim() || !phone) continue;
    out.push({ recipientId: r.id, phone, text: withOptOutLine(b.message.trim(), optOut), createdAt: new Date(b.created_at) });
  }
  return out;
}

/** Lease broadcast recipients to this device; returns the ids it holds. */
export async function claimBroadcasts(
  admin: SupabaseClient,
  device: ReminderDevice,
  ids: string[],
  minutes: number,
  now: Date,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const nowIso = now.toISOString();
  const claimed = new Set<string>();
  // Chunked: an all-active broadcast can lease hundreds of ids (URL length).
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("reminder_broadcast_recipients")
      .update({ claimed_by: device.id, claimed_until: new Date(now.getTime() + minutes * 60_000).toISOString() })
      .eq("workspace_id", device.workspace_id)
      .eq("status", "queued")
      .in("id", ids.slice(i, i + 100))
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso},claimed_by.eq.${device.id}`)
      .select("id");
    if (error) throw new Error(`broadcast claim failed: ${error.message}`);
    for (const r of data ?? []) claimed.add(r.id as string);
  }
  return claimed;
}

/** Record a device's result for one broadcast text. Only queued rows change. */
export async function ackBroadcast(
  admin: SupabaseClient,
  device: ReminderDevice,
  recipientId: string,
  status: "sent" | "failed" | "dry-run",
  error: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from("reminder_broadcast_recipients")
    .update({ status, error, sent_at: new Date().toISOString(), device_id: device.id, claimed_until: null })
    .eq("workspace_id", device.workspace_id)
    .eq("id", recipientId)
    .eq("status", "queued")
    .select("id");
  return (data ?? []).length > 0;
}

export interface InboundReply {
  from: string;
  text: string;
}

export interface InboundResult {
  /** Keyword messages seen (stop/start). */
  keywords: number;
  /** Patients whose text-reminder flag actually changed. */
  changed: number;
  /** Keyword messages whose phone matched no patient. */
  unmatched: number;
  /** Non-keyword messages (ignored, never stored). */
  ignored: number;
}

/**
 * Patients replied STOP (or START): flip the same per-patient flag the
 * queue already respects (patients.text_reminders_off) and log the change.
 * Idempotent: a patient already in that state is left alone and not logged
 * again. Message bodies are never stored; no reply is ever sent.
 */
export async function applyInboundReplies(
  admin: SupabaseClient,
  device: ReminderDevice,
  replies: InboundReply[],
  source: string,
): Promise<InboundResult> {
  const result: InboundResult = { keywords: 0, changed: 0, unmatched: 0, ignored: 0 };
  const wanted: { key: string; action: "stop" | "start" }[] = [];
  for (const reply of replies) {
    const action = parseOptOutReply(reply.text);
    const key = phoneMatchKey(reply.from);
    if (!action) {
      result.ignored += 1;
      continue;
    }
    result.keywords += 1;
    if (!key) result.unmatched += 1;
    else wanted.push({ key, action });
  }
  if (!wanted.length) return result;
  const { data: pts, error } = await admin
    .from("patients")
    .select("id, phone, text_reminders_off")
    .eq("workspace_id", device.workspace_id);
  if (error) throw new Error(`patients lookup failed: ${error.message}`);
  const byKey = new Map<string, { id: string; off: boolean }[]>();
  for (const p of pts ?? []) {
    const key = phoneMatchKey(p.phone);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push({ id: p.id as string, off: p.text_reminders_off === true });
    byKey.set(key, list);
  }
  for (const { key, action } of wanted) {
    const matches = byKey.get(key) ?? [];
    if (!matches.length) {
      result.unmatched += 1;
      continue;
    }
    const off = action === "stop";
    for (const m of matches) {
      if (m.off === off) continue; // already in that state
      const { error: upErr } = await admin
        .from("patients")
        .update({ text_reminders_off: off })
        .eq("workspace_id", device.workspace_id)
        .eq("id", m.id);
      if (upErr) continue;
      m.off = off;
      result.changed += 1;
      await admin.from("reminder_opt_outs").insert({
        workspace_id: device.workspace_id,
        patient_id: m.id,
        action,
        phone_last4: key.slice(-4),
        source,
        device_id: device.id,
      });
    }
  }
  return result;
}

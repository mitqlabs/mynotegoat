/**
 * Server-only helpers for the reminder device API. The device token is the
 * only credential; every query below is pinned to the device's workspace.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PatientRecord } from "@/lib/mock-data";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import { broadcastTimeOk, hashDeviceToken, isStopTest, leaseCanTake, matchPatientByName, parseOptOutReply, phoneMatchKey, splitPatientName, STOP_TEST_PATIENT_ID, UNMATCHED_PREFIX, withOptOutLine, type OfficeHoursDay, type ReminderOffice } from "@/lib/reminder-automation";
import { expandTokens } from "@/lib/sms-render";
import { keyDateHoursForDate, keyDateHasHours, normalizeKeyDates, type KeyDateHours } from "@/lib/key-dates";
import { normalizeSmsTemplates } from "@/lib/sms-template-core";
import { resolveBirthdayMessage, resolveReminderMessage } from "@/lib/message-library";
import { normalizeSmsReminderSettings, type SmsReminderSettings } from "@/lib/sms-reminders";
import { BIRTHDAY_EXPIRED_ERROR, birthdayClaimDecision, birthdayDobSuffixes, pickBirthdayRecipients, type BirthdayPatient, type BirthdayRecipient } from "@/lib/birthday-texts";
import { decideDeviceToken, promotedTokenFields, type DeviceTokenRow } from "@/lib/device-token";

export interface ReminderDevice {
  id: string;
  workspace_id: string;
  name: string;
  kind: string;
  last_run_at: string | null;
  last_run_summary?: string | null;
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
  const cols = "id, workspace_id, name, kind, last_run_at, last_run_summary, run_requested_until, is_primary, revoked_at, token_hash, pending_token_hash, retired_token_hash, last_rejected_at";
  let { data, error } = await admin
    .from("reminder_devices")
    .select(cols)
    .or(`token_hash.eq.${hash},pending_token_hash.eq.${hash},retired_token_hash.eq.${hash}`)
    .limit(1)
    .maybeSingle();
  // Columns not migrated yet: the code already on the phone still works.
  if (error) {
    ({ data, error } = await admin
      .from("reminder_devices")
      .select("id, workspace_id, name, kind, last_run_at, last_run_summary, run_requested_until, is_primary, revoked_at, token_hash")
      .eq("token_hash", hash)
      .maybeSingle());
  }
  if (error || !data) return null;
  const row = data as DeviceTokenRow & typeof data;
  const decision = decideDeviceToken(hash, row);
  if (!decision.ok) {
    await admin
      .from("reminder_devices")
      .update({ last_rejected_at: new Date().toISOString(), last_rejected_reason: decision.reject })
      .eq("id", data.id);
    return null;
  }
  if (decision.promote) {
    await admin.from("reminder_devices").update(promotedTokenFields(row)).eq("id", data.id);
  } else if (data.last_rejected_at) {
    await admin.from("reminder_devices").update({ last_rejected_at: null, last_rejected_reason: null }).eq("id", data.id);
  }
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    name: data.name,
    kind: data.kind ?? "mac",
    last_run_at: data.last_run_at ?? null,
    last_run_summary: data.last_run_summary ?? null,
    run_requested_until: data.run_requested_until ?? null,
    is_primary: data.is_primary === true,
  };
}

export interface WorkspaceReminderConfig {
  settings: SmsReminderSettings;
  templateBody: string;
  /** The message attached to Auto Texts → Birthday (words not filled in yet). */
  birthdayBody: string;
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
  // The Messages library (deleted ones are markers and never used). Same picking code the Settings page uses.
  const templates = normalizeSmsTemplates(kv["casemate.sms-templates.v1"]);
  const template = resolveReminderMessage(settings, templates);
  const birthday = resolveBirthdayMessage(settings, templates);
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
    birthdayBody: birthday.body,
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
 * Queued "Message patients" texts for this workspace: not canceled, not
 * opted out, and not leased to another device. A send day that already
 * passed is still due. A closed office day does not drop these. The phone
 * is read from the patient record at send time.
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
  const rows = (data as unknown as Row[]).filter((r) => leaseCanTake(r.claimed_by, r.claimed_until, device.id, now));
  const ids = Array.from(new Set(rows.map((r) => r.patient_id)));
  if (!ids.length) return [];
  // Chunked: an all-active broadcast can hold hundreds of ids (URL length).
  const pts: { id: unknown; phone: unknown; full_name: unknown; text_reminders_off: unknown }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: part } = await admin
      .from("patients")
      .select("id, full_name, phone, text_reminders_off")
      .eq("workspace_id", device.workspace_id)
      .in("id", ids.slice(i, i + 100));
    pts.push(...(part ?? []));
  }
  const phoneById = new Map(
    pts.filter((p) => p.text_reminders_off !== true).map((p) => [p.id as string, String(p.phone ?? "")]),
  );
  const nameById = new Map(pts.map((p) => [p.id as string, String(p.full_name ?? "")]));
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
    const who = splitPatientName(nameById.get(r.patient_id) ?? "");
    const body = expandTokens(b.message.trim(), {
      patient: { firstName: who.firstName, lastName: who.lastName, fullName: nameById.get(r.patient_id) ?? "" },
    });
    out.push({ recipientId: r.id, phone, text: withOptOutLine(body, optOut), createdAt: new Date(b.created_at) });
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

export { STOP_TEST_PATIENT_ID, UNMATCHED_PREFIX } from "@/lib/reminder-automation";

export interface InboundResult {
  /** Keyword messages seen (stop/start). */
  keywords: number;
  /** Patients whose text-reminder flag actually changed. */
  changed: number;
  /** Keyword messages that did not match one patient. */
  unmatched: number;
  /** Names or numbers we could not match. Shown in NoteGoat. */
  unmatchedLabels: string[];
  /** STOP TEST reports. These never change a patient. */
  tested: number;
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
  const result: InboundResult = { keywords: 0, changed: 0, unmatched: 0, unmatchedLabels: [], tested: 0, ignored: 0 };
  const wanted: { from: string; action: "stop" | "start" }[] = [];
  for (const reply of replies) {
    if (isStopTest(reply.text)) {
      result.tested += 1;
      await admin.from("reminder_opt_outs").insert({
        workspace_id: device.workspace_id,
        patient_id: STOP_TEST_PATIENT_ID,
        action: "stop",
        phone_last4: "TEST",
        source,
        device_id: device.id,
      });
      continue;
    }
    const action = parseOptOutReply(reply.text);
    if (!action) {
      result.ignored += 1;
      continue;
    }
    result.keywords += 1;
    wanted.push({ from: reply.from, action });
  }
  if (!wanted.length) return result;
  const { data: pts, error } = await admin
    .from("patients")
    .select("id, full_name, phone, text_reminders_off")
    .eq("workspace_id", device.workspace_id);
  if (error) throw new Error(`patients lookup failed: ${error.message}`);
  const people = (pts ?? []).map((p) => ({
    id: p.id as string,
    fullName: String(p.full_name ?? ""),
    phone: String(p.phone ?? ""),
    off: p.text_reminders_off === true,
  }));
  const byPhone = new Map<string, typeof people>();
  for (const person of people) {
    const key = phoneMatchKey(person.phone);
    if (!key) continue;
    const list = byPhone.get(key) ?? [];
    list.push(person);
    byPhone.set(key, list);
  }
  for (const { from, action } of wanted) {
    const phoneKey = phoneMatchKey(from);
    const matches = phoneKey
      ? (byPhone.get(phoneKey) ?? [])
      : (() => {
          const id = matchPatientByName(people, from);
          const person = id ? people.find((p) => p.id === id) : undefined;
          return person ? [person] : [];
        })();
    if (!matches.length) {
      result.unmatched += 1;
      const label = (from || "unknown").replace(/\s+/g, " ").trim().slice(0, 80) || "unknown";
      result.unmatchedLabels.push(label);
      await admin.from("reminder_opt_outs").insert({
        workspace_id: device.workspace_id,
        patient_id: `${UNMATCHED_PREFIX}${label}`,
        action,
        phone_last4: phoneKey ? phoneKey.slice(-4) : "",
        source,
        device_id: device.id,
      });
      continue;
    }
    const off = action === "stop";
    for (const person of matches) {
      if (person.off === off) continue;
      const { error: upErr } = await admin
        .from("patients")
        .update({ text_reminders_off: off })
        .eq("workspace_id", device.workspace_id)
        .eq("id", person.id);
      if (upErr) continue;
      person.off = off;
      result.changed += 1;
      await admin.from("reminder_opt_outs").insert({
        workspace_id: device.workspace_id,
        patient_id: person.id,
        action,
        phone_last4: phoneMatchKey(person.phone).slice(-4) || phoneKey.slice(-4),
        source,
        device_id: device.id,
      });
    }
  }
  return result;
}

// ---- Daily birthday texts ----

/** A failed birthday text is tried again later the same year, at most this many times. */
export const BIRTHDAY_MAX_ATTEMPTS = 3;

/**
 * Close birthday claims from an earlier day. They are not sent late, and a
 * later run must not hand them out. Same-day claims are left for the queue
 * to re-offer once the claim window has passed. Missing table: do nothing.
 */
export async function expireStaleBirthdayClaims(
  admin: SupabaseClient,
  device: ReminderDevice,
  todayIso: string,
  timeZone: string,
  now: Date,
): Promise<void> {
  const { data, error } = await admin
    .from("birthday_text_log")
    .select("id, claimed_at, created_at")
    .eq("workspace_id", device.workspace_id)
    .eq("status", "claimed")
    .limit(200);
  if (error || !data?.length) return;
  for (const row of data) {
    const claimedAt = String(row.claimed_at ?? row.created_at ?? "");
    if (birthdayClaimDecision({ claimedAt, todayIso, now, timeZone }) !== "expire") continue;
    await admin
      .from("birthday_text_log")
      .update({ status: "failed", error: BIRTHDAY_EXPIRED_ERROR, sent_at: null })
      .eq("workspace_id", device.workspace_id)
      .eq("id", row.id)
      .eq("status", "claimed");
  }
}

export interface BirthdayQueueRow extends BirthdayRecipient {
  year: number;
  /** What the send log already says about this patient this year. */
  prior: "none" | "failed" | "dry-run" | "claimed";
  attempts: number;
  /** Set when prior is "claimed": the lease we are taking over. */
  claimedAt?: string;
}

/**
 * Birthday texts for today: patients (any case status) whose birthday is today (office
 * time zone; Feb 29 → Feb 28 in non-leap years), not opted out, with a phone
 * and first name, minus anyone the send log (birthday_text_log) already has
 * for this year. A "sent" ack is final. A claim the phone never answers is
 * not: after the claim window it is handed out again the same day, and a
 * claim from an earlier day is closed without sending (a birthday text is
 * not sent late). If the log table is missing or unreadable this returns
 * nothing: the queue never sends a text it cannot record.
 *
 * `retryDryRun`: true when about to really send (or previewing), so rows a
 * test run logged count as not sent yet. False in test mode, so the same
 * test text is not logged again on every 10-minute check.
 * `reofferClaims`: true on a real send. Same-day expired claims are handed
 * out again. Left false for a dry run, which must not take over a live claim.
 */
export async function loadBirthdayQueue(
  admin: SupabaseClient,
  device: ReminderDevice,
  todayIso: string,
  settings: SmsReminderSettings,
  opts: {
    retryDryRun: boolean;
    reofferClaims?: boolean;
    now?: Date;
    body?: string;
    office?: { officeName?: string; doctorName?: string; phone?: string };
  },
): Promise<BirthdayQueueRow[]> {
  if (!settings.birthdayTexts) return [];
  const now = opts.now ?? new Date();
  await expireStaleBirthdayClaims(admin, device, todayIso, settings.timeZone, now);
  const suffixes = birthdayDobSuffixes(todayIso);
  if (!suffixes.length) return [];
  const year = Number(todayIso.slice(0, 4));
  const { data: pts, error } = await admin
    .from("patients")
    .select("id, full_name, phone, dob, case_status, text_reminders_off")
    .eq("workspace_id", device.workspace_id)
    .or(suffixes.map((x) => `dob.like.*-${x}`).join(","))
    .limit(1000);
  if (error || !pts?.length) return [];
  const patients: BirthdayPatient[] = pts.map((row) => ({
    patientId: String(row.id ?? ""),
    fullName: String(row.full_name ?? ""),
    dob: String(row.dob ?? ""),
    phone: String(row.phone ?? ""),
    caseStatus: String(row.case_status ?? ""),
    optedOut: row.text_reminders_off === true,
  }));
  const picks = pickBirthdayRecipients(patients, todayIso, opts.body !== undefined ? { ...settings, birthdayMessage: opts.body } : settings, opts.office);
  if (!picks.length) return [];
  const { data: logRows, error: logError } = await admin
    .from("birthday_text_log")
    .select("patient_id, status, attempts, claimed_at, created_at, error")
    .eq("workspace_id", device.workspace_id)
    .eq("year", year)
    .in("patient_id", picks.map((p) => p.patientId));
  if (logError) return [];
  const logged = new Map(
    (logRows ?? []).map((r) => [
      String(r.patient_id),
      {
        status: String(r.status),
        attempts: Number(r.attempts) || 1,
        claimedAt: String(r.claimed_at ?? r.created_at ?? ""),
        error: typeof r.error === "string" ? r.error : null,
      },
    ]),
  );
  const out: BirthdayQueueRow[] = [];
  for (const pick of picks) {
    const row = logged.get(pick.patientId);
    if (!row) {
      out.push({ ...pick, year, prior: "none", attempts: 0 });
      continue;
    }
    if (row.status === "claimed") {
      const decision = birthdayClaimDecision({
        claimedAt: row.claimedAt,
        todayIso,
        now,
        timeZone: settings.timeZone,
      });
      if (decision === "expire") {
        await admin
          .from("birthday_text_log")
          .update({ status: "failed", error: BIRTHDAY_EXPIRED_ERROR, sent_at: null })
          .eq("workspace_id", device.workspace_id)
          .eq("patient_id", pick.patientId)
          .eq("year", year)
          .eq("status", "claimed");
      } else if (decision === "reoffer" && opts.reofferClaims) {
        out.push({ ...pick, year, prior: "claimed", attempts: row.attempts, claimedAt: row.claimedAt });
      }
      continue;
    }
    if (row.status === "failed" && row.error === BIRTHDAY_EXPIRED_ERROR) continue;
    if (row.status === "failed" && row.attempts < BIRTHDAY_MAX_ATTEMPTS) out.push({ ...pick, year, prior: "failed", attempts: row.attempts });
    else if (row.status === "dry-run" && opts.retryDryRun) out.push({ ...pick, year, prior: "dry-run", attempts: row.attempts });
    // sent, or failed too often: never again this year.
  }
  return out;
}

/**
 * Record that this device is about to text these patients. The unique key
 * (workspace, patient, year) makes the first claim win; everyone else is
 * dropped. Returns the patient ids this device now holds.
 */
export async function claimBirthdays(
  admin: SupabaseClient,
  device: ReminderDevice,
  rows: BirthdayQueueRow[],
  now: Date,
): Promise<Set<string>> {
  const held = new Set<string>();
  const nowIso = now.toISOString();
  for (const row of rows) {
    const common = { status: "claimed", device_id: device.id, claimed_at: nowIso, error: null, sent_at: null };
    if (row.prior === "none") {
      const { error } = await admin.from("birthday_text_log").insert({
        workspace_id: device.workspace_id,
        patient_id: row.patientId,
        year: row.year,
        attempts: 1,
        phone_last4: row.phone.slice(-4),
        ...common,
      });
      if (!error) held.add(row.patientId);
      continue;
    }
    if (row.prior === "claimed") {
      // Take over only the expired lease we just read. A phone that already
      // refreshed it (or acked it) keeps the row, so nobody is texted twice.
      const { data } = await admin
        .from("birthday_text_log")
        .update({ ...common, phone_last4: row.phone.slice(-4) })
        .eq("workspace_id", device.workspace_id)
        .eq("patient_id", row.patientId)
        .eq("year", row.year)
        .eq("status", "claimed")
        .eq("claimed_at", row.claimedAt ?? "")
        .select("id");
      if ((data ?? []).length > 0) held.add(row.patientId);
      continue;
    }
    // A failed or test row: take it over only if nobody changed it meanwhile.
    const { data } = await admin
      .from("birthday_text_log")
      .update({ ...common, attempts: row.prior === "failed" ? row.attempts + 1 : 1, phone_last4: row.phone.slice(-4) })
      .eq("workspace_id", device.workspace_id)
      .eq("patient_id", row.patientId)
      .eq("year", row.year)
      .eq("status", row.prior)
      .eq("attempts", row.attempts)
      .select("id");
    if ((data ?? []).length > 0) held.add(row.patientId);
  }
  return held;
}

/**
 * A device's answer for one birthday text. sent / failed only change a row
 * this workspace has CLAIMED. dry-run writes a test row (only if there is
 * none yet). Returns false when nothing changed (a repeat or unknown id).
 */
export async function ackBirthday(
  admin: SupabaseClient,
  device: ReminderDevice,
  year: number,
  patientId: string,
  status: "sent" | "failed" | "dry-run",
  error: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (!patientId || Math.abs(year - now.getUTCFullYear()) > 1) return false;
  if (status === "dry-run") {
    const { data: p } = await admin
      .from("patients")
      .select("id, phone")
      .eq("workspace_id", device.workspace_id)
      .eq("id", patientId)
      .maybeSingle();
    if (!p) return false;
    const { error: insErr } = await admin.from("birthday_text_log").insert({
      workspace_id: device.workspace_id,
      patient_id: patientId,
      year,
      status: "dry-run",
      attempts: 1,
      phone_last4: String(p.phone ?? "").replace(/\D/g, "").slice(-4),
      device_id: device.id,
      claimed_at: now.toISOString(),
    });
    return !insErr;
  }
  const { data } = await admin
    .from("birthday_text_log")
    .update({ status, error, device_id: device.id, sent_at: status === "sent" ? now.toISOString() : null })
    .eq("workspace_id", device.workspace_id)
    .eq("patient_id", patientId)
    .eq("year", year)
    .eq("status", "claimed")
    .select("id");
  return (data ?? []).length > 0;
}

/**
 * Queue a patient text the way the "Message patients" composer does, for callers that aren't that composer
 * (G.O.A.T.'s /text). Same tables (reminder_broadcasts + reminder_broadcast_recipients), same recipient rules
 * (pickAudienceRecipients / pickBroadcastRecipients: one text per phone, never opted-out, never no-phone),
 * same target_date + quiet-hours logic (broadcastSendDay), same all-or-nothing queue (a failed recipient insert
 * cancels the whole message). The Supabase client is injected so tests can use a fake.
 *
 * Nothing here sends a text. The office's iPhone/iMac sends what's queued.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  broadcastSendDay,
  isActiveCaseStatus,
  localHHMM,
  localNow,
  phoneMatchKey,
  pickAudienceRecipients,
  pickBroadcastRecipients,
  type BroadcastCandidate,
  type BroadcastPatient,
} from "@/lib/reminder-automation";
import type { TextAudience } from "@/lib/goat-text";
import type { SmsReminderSettings } from "@/lib/sms-reminders";
import { officeMacSeen, type DeviceLike } from "@/lib/reminder-format";

export type Db = Pick<SupabaseClient, "from">;
type Tz = Pick<SmsReminderSettings, "timeZone" | "quietStartHour" | "quietEndHour">;

export const BROADCAST_MAX = 640;
const PAGE = 1000;
const INSERT_CHUNK = 500;

export interface SkippedCounts {
  /** Replied STOP / "no texts" is switched on. */
  optedOut: number;
  /** No usable phone number on file. */
  noPhone: number;
  /** Shares a phone with someone who's already getting it. */
  sharedPhone: number;
}

export interface TextRecipients {
  recipients: BroadcastCandidate[];
  skipped: SkippedCounts;
  /** The reminder_broadcasts.target_date this audience would queue with. */
  date: string;
  /** Quiet hours right now: it will go out after they end. */
  deferred: boolean;
}

interface PatientRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  case_status?: string | null;
  text_reminders_off: boolean | null;
}

function skippedOf(eligible: { phone: string; optedOut?: boolean }[], picked: number): SkippedCounts {
  const optedOut = eligible.filter((r) => r.optedOut).length;
  const noPhone = eligible.filter((r) => !r.optedOut && !phoneMatchKey(r.phone)).length;
  return { optedOut, noPhone, sharedPhone: Math.max(0, eligible.length - optedOut - noPhone - picked) };
}

async function readAllPatients(db: Db, workspaceId: string): Promise<PatientRow[] | null> {
  const out: PatientRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("patients")
      .select("id, full_name, phone, case_status, text_reminders_off")
      .eq("workspace_id", workspaceId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return null;
    out.push(...((data as PatientRow[] | null) ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

const toPatient = (p: PatientRow, forceActive = false): BroadcastPatient => ({
  patientId: p.id,
  patientName: String(p.full_name ?? ""),
  phone: String(p.phone ?? ""),
  caseStatus: forceActive ? "Active" : String(p.case_status ?? ""),
  optedOut: p.text_reminders_off === true,
});

/**
 * Who would get this text. Null = couldn't read the data (never guess: the card says so and offers nothing to send).
 *  - active:   every Active patient with a phone (PR #147 rule), sends today (or tomorrow in the evening quiet hours)
 *  - booked:   patients with a not-canceled visit that day (visits already past are skipped for today)
 *  - patients: exactly these patients (e.g. the ones just canceled) — same phone/opt-out rules
 */
export async function loadTextRecipients(
  db: Db,
  workspaceId: string,
  audience: TextAudience,
  settings: Tz,
  now: Date = new Date(),
): Promise<TextRecipients | null> {
  const sendDay = broadcastSendDay(now, settings);
  if (audience.kind === "booked") {
    const { data: appts, error } = await db
      .from("schedule_appointments")
      .select("id, patient_id, patient_name, start_time, status")
      .eq("workspace_id", workspaceId)
      .eq("date", audience.date);
    if (error) return null;
    const rows = (appts ?? []) as { id: string; patient_id: string; patient_name: string | null; start_time: string | null; status: string | null }[];
    const ids = Array.from(new Set(rows.map((r) => r.patient_id).filter(Boolean)));
    let pts: PatientRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: pErr } = await db
        .from("patients")
        .select("id, full_name, phone, text_reminders_off")
        .eq("workspace_id", workspaceId)
        .in("id", ids.slice(i, i + 200));
      if (pErr) return null;
      pts = pts.concat((data ?? []) as PatientRow[]);
    }
    const byId = new Map(pts.map((p) => [p.id, p]));
    const candidates: BroadcastCandidate[] = rows.map((r) => {
      const p = byId.get(r.patient_id);
      return {
        appointmentId: r.id,
        patientId: r.patient_id,
        patientName: r.patient_name || p?.full_name || "",
        time: r.start_time ?? "",
        status: r.status ?? "",
        phone: String(p?.phone ?? ""),
        optedOut: p?.text_reminders_off === true,
      };
    });
    const notBefore = audience.date === localNow(now, settings.timeZone).iso ? localHHMM(now, settings.timeZone) : undefined;
    const recipients = pickBroadcastRecipients(candidates, { excludeCanceled: true, notBefore });
    // People who'd be texted but for a missing phone / STOP / a shared phone: same rules with unique fake phones.
    const live = pickBroadcastRecipients(candidates.map((c, i) => ({ ...c, optedOut: false, phone: String(5550000000 + i) })), { excludeCanceled: true, notBefore });
    const byPatient = new Map(candidates.map((c) => [c.patientId, c]));
    const eligible = live.map((l) => byPatient.get(l.patientId)!).filter(Boolean);
    return { recipients, skipped: skippedOf(eligible, recipients.length), date: audience.date, deferred: false };
  }

  if (audience.kind === "patients") {
    const ids = Array.from(new Set(audience.ids));
    let pts: PatientRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from("patients")
        .select("id, full_name, phone, text_reminders_off")
        .eq("workspace_id", workspaceId)
        .in("id", ids.slice(i, i + 200));
      if (error) return null;
      pts = pts.concat((data ?? []) as PatientRow[]);
    }
    const list = pts.map((p) => toPatient(p, true));
    const recipients = pickAudienceRecipients("active", list);
    return { recipients, skipped: skippedOf(list.map((p) => ({ phone: p.phone, optedOut: p.optedOut })), recipients.length), date: sendDay.iso, deferred: sendDay.deferred };
  }

  const all = await readAllPatients(db, workspaceId);
  if (!all) return null;
  const list = all.map((p) => toPatient(p));
  const recipients = pickAudienceRecipients("active", list);
  const eligible = list.filter((p) => isActiveCaseStatus(p.caseStatus)).map((p) => ({ phone: p.phone, optedOut: p.optedOut }));
  return { recipients, skipped: skippedOf(eligible, recipients.length), date: sendDay.iso, deferred: sendDay.deferred };
}

export type QueueResult = { ok: true; broadcastId: string; count: number } | { ok: false; error: string };

/** Queue it. All-or-nothing: if any recipient chunk fails, the broadcast is canceled so nobody gets a partial send. */
export async function queueBroadcast(
  db: Db,
  workspaceId: string,
  input: { message: string; date: string; recipients: BroadcastCandidate[]; booked: boolean },
): Promise<QueueResult> {
  const message = input.message.trim();
  if (!workspaceId) return { ok: false, error: "Sign in to message patients." };
  if (!message) return { ok: false, error: "Type a message first." };
  if (message.length > BROADCAST_MAX) return { ok: false, error: `That message is too long (${message.length} of ${BROADCAST_MAX} characters). Shorten it and try again.` };
  if (!input.recipients.length) return { ok: false, error: "There's nobody to text." };
  const row = { workspace_id: workspaceId, message, target_date: input.date, exclude_canceled: true };
  const { data: b, error } = await db.from("reminder_broadcasts").insert(row).select("id").single();
  if (error || !b) return { ok: false, error: `Couldn't queue the message: ${error?.message ?? "unknown error"}` };
  const rows = input.recipients.map((r) => ({
    broadcast_id: (b as { id: string }).id,
    workspace_id: workspaceId,
    patient_id: r.patientId,
    appointment_id: r.appointmentId || null,
    phone_last4: r.phone.replace(/\D/g, "").slice(-4),
  }));
  let rErr: { message: string } | null = null;
  for (let i = 0; i < rows.length && !rErr; i += INSERT_CHUNK) {
    ({ error: rErr } = await db.from("reminder_broadcast_recipients").insert(rows.slice(i, i + INSERT_CHUNK)));
  }
  if (rErr) {
    await db.from("reminder_broadcasts").update({ canceled_at: new Date().toISOString() }).eq("id", (b as { id: string }).id);
    return { ok: false, error: `Couldn't queue the message (nothing was sent): ${rErr.message}` };
  }
  return { ok: true, broadcastId: (b as { id: string }).id, count: rows.length };
}

/** Has an active Mac checked in? (Decides whether the "Queued" line mentions the iMac.) */
export async function readMacSeen(db: Db, workspaceId: string): Promise<boolean> {
  const { data } = await db
    .from("reminder_devices")
    .select("kind, revoked_at, last_seen_at, last_run_at")
    .eq("workspace_id", workspaceId);
  return officeMacSeen((data as DeviceLike[] | null) ?? []);
}


"use client";

/**
 * Settings → Text Reminders → Message patients. Queue one text (e.g. an
 * emergency closure) for everyone booked on a day. Stored in Supabase
 * (reminder_broadcasts + reminder_broadcast_recipients); the office's
 * sending device delivers it through /api/reminders/queue.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  addDaysIso,
  localNow,
  pickBroadcastRecipients,
  to12h,
  type BroadcastCandidate,
} from "@/lib/reminder-automation";
import type { SmsReminderSettings } from "@/lib/sms-reminders";

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3";
const btn = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-4 text-sm font-semibold";
const MAX = 640;

type Target = "today" | "tomorrow" | "date";
type BroadcastRow = {
  id: string;
  message: string;
  target_date: string;
  created_at: string;
  canceled_at: string | null;
  reminder_broadcast_recipients: { status: string }[] | null;
};

const usDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : iso;
};

export function MessagePatientsComposer({ settings, workspaceId }: { settings: SmsReminderSettings; workspaceId: string }) {
  const todayIso = useMemo(() => localNow(new Date(), settings.timeZone).iso, [settings.timeZone]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>("today");
  const [pickedDate, setPickedDate] = useState(todayIso);
  const [excludeCanceled, setExcludeCanceled] = useState(true);
  const [recipients, setRecipients] = useState<BroadcastCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [busy, setBusy] = useState(false);

  const date = target === "today" ? todayIso : target === "tomorrow" ? addDaysIso(todayIso, 1) : pickedDate;

  const loadRecipients = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId || !date) return;
    setLoading(true);
    const { data: appts } = await client
      .from("schedule_appointments")
      .select("id, patient_id, patient_name, start_time, status")
      .eq("workspace_id", workspaceId)
      .eq("date", date);
    const rows = appts ?? [];
    const ids = Array.from(new Set(rows.map((r) => r.patient_id as string).filter(Boolean)));
    const { data: pts } = ids.length
      ? await client.from("patients").select("id, full_name, phone, text_reminders_off").eq("workspace_id", workspaceId).in("id", ids)
      : { data: [] as { id: string; full_name: string; phone: string; text_reminders_off: boolean }[] };
    const byId = new Map((pts ?? []).map((p) => [p.id as string, p]));
    setRecipients(
      pickBroadcastRecipients(
        rows.map((r) => {
          const p = byId.get(r.patient_id as string);
          return {
            appointmentId: r.id as string,
            patientId: r.patient_id as string,
            patientName: (r.patient_name as string) || (p?.full_name as string) || "",
            time: (r.start_time as string) ?? "",
            status: (r.status as string) ?? "",
            phone: String(p?.phone ?? ""),
            optedOut: p?.text_reminders_off === true,
          };
        }),
        { excludeCanceled },
      ),
    );
    setLoading(false);
  }, [workspaceId, date, excludeCanceled]);

  const loadHistory = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const { data } = await client
      .from("reminder_broadcasts")
      .select("id, message, target_date, created_at, canceled_at, reminder_broadcast_recipients(status)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5);
    setHistory((data as BroadcastRow[] | null) ?? []);
  }, [workspaceId]);

  useEffect(() => {
    // Network fetch; state is set after the round trip.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecipients();
  }, [loadRecipients]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory]);

  const queue = async () => {
    const client = getSupabaseBrowserClient();
    const message = text.trim();
    if (!client || !workspaceId) return setStatus("Sign in to message patients.");
    if (!message) return setStatus("Type a message first.");
    if (!recipients.length) return setStatus("No patients with a phone number on that day.");
    const dry = settings.dryRun ? "\n\nDry run is ON: nothing will actually be texted; it will only be logged." : "";
    if (!window.confirm(`Text this to ${recipients.length} patient(s) booked ${usDate(date)}?\n\n"${message}"${dry}`)) return;
    setBusy(true);
    const { data: b, error } = await client
      .from("reminder_broadcasts")
      .insert({ workspace_id: workspaceId, message, target_date: date, exclude_canceled: excludeCanceled })
      .select("id")
      .single();
    if (error || !b) {
      setBusy(false);
      return setStatus(`Couldn't queue the message: ${error?.message ?? "unknown error"}`);
    }
    const { error: rErr } = await client.from("reminder_broadcast_recipients").insert(
      recipients.map((r) => ({
        broadcast_id: b.id,
        workspace_id: workspaceId,
        patient_id: r.patientId,
        appointment_id: r.appointmentId,
        phone_last4: r.phone.replace(/\D/g, "").slice(-4),
      })),
    );
    setBusy(false);
    if (rErr) return setStatus(`Couldn't queue the message: ${rErr.message}`);
    setText("");
    setStatus(
      settings.dryRun
        ? `Queued for ${recipients.length} patient(s). Dry run is on, so devices will only log it.`
        : `Queued for ${recipients.length} patient(s). Tap "Send Reminders Now" on the iPhone to send it now; the iMac picks it up within 10 minutes.`,
    );
    void loadHistory();
  };

  const cancel = async (id: string) => {
    if (!window.confirm("Cancel the texts that haven't gone out yet?")) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    await client.from("reminder_broadcasts").update({ canceled_at: new Date().toISOString() }).eq("id", id);
    await client.from("reminder_broadcast_recipients").update({ status: "canceled" }).eq("broadcast_id", id).eq("status", "queued");
    void loadHistory();
  };

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3 text-sm" data-testid="message-patients">
      <div>
        <p className="font-semibold">Message patients</p>
        <p className="text-[var(--text-muted)]">
          Send one text to everyone booked on a day, for example an emergency closure. It goes out from your iPhone or iMac like the reminders.
        </p>
      </div>
      {settings.dryRun && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800">
          Dry run is on: messages are only logged, nobody is texted.
        </p>
      )}
      <label className="grid gap-1">
        <span className={label}>Message</span>
        <textarea
          className="min-h-[84px] rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          maxLength={MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Our office is closed today due to an emergency. We'll call you to reschedule."
          value={text}
        />
        <span className="text-xs text-[var(--text-muted)]">{text.length}/{MAX}</span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className={label}>Send to patients booked</span>
          <select className={input} onChange={(e) => setTarget(e.target.value as Target)} value={target}>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="date">Pick a date</option>
          </select>
        </label>
        {target === "date" && (
          <input className={input} min={todayIso} onChange={(e) => setPickedDate(e.target.value)} type="date" value={pickedDate} />
        )}
        <label className="inline-flex h-[42px] items-center gap-2 font-semibold">
          <input checked={excludeCanceled} onChange={(e) => setExcludeCanceled(e.target.checked)} type="checkbox" />
          Skip canceled visits
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-left font-semibold text-[var(--brand-primary)]" onClick={() => setShowList((v) => !v)} type="button">
          {loading ? "Counting…" : `${recipients.length} patient(s) on ${usDate(date)}`} {recipients.length > 0 && (showList ? "▴" : "▾")}
        </button>
        <button
          className={`${btn} bg-[var(--brand-primary)] text-white disabled:opacity-50`}
          data-testid="message-patients-send"
          disabled={busy || loading || !text.trim() || !recipients.length}
          onClick={() => void queue()}
          type="button"
        >
          {busy ? "Queuing…" : "Queue message"}
        </button>
      </div>
      {showList && recipients.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-[var(--line-soft)] px-3 py-2 text-[var(--text-muted)]">
          {recipients.map((r) => (
            <li key={r.patientId}>
              {to12h(r.time)} · {r.patientName} · ***{r.phone.replace(/\D/g, "").slice(-4)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Only patients with a phone number are included, once each. Patients marked &quot;no text reminders&quot; are skipped. Quiet hours apply.
      </p>
      {status && <p className="font-semibold">{status}</p>}
      {history.length > 0 && (
        <div className="grid gap-1">
          <span className={label}>Recent messages</span>
          {history.map((h) => {
            const rs = h.reminder_broadcast_recipients ?? [];
            const count = (s: string) => rs.filter((r) => r.status === s).length;
            const queued = count("queued");
            const summary = h.canceled_at
              ? `Canceled · sent ${count("sent")} of ${rs.length}`
              : count("dry-run")
                ? `Dry run · ${count("dry-run")} logged`
                : queued
                  ? `Queued · sent ${count("sent")} of ${rs.length}`
                  : `Sent ${count("sent")} of ${rs.length}${count("failed") ? ` · ${count("failed")} failed` : ""}`;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-1" key={h.id}>
                <span className="min-w-0 flex-1 truncate">
                  <b>{usDate(h.target_date)}</b> · {h.message}
                </span>
                <span className="text-[var(--text-muted)]">{summary}</span>
                {queued > 0 && !h.canceled_at && (
                  <button className="font-semibold text-red-700" onClick={() => void cancel(h.id)} type="button">
                    Cancel
                  </button>
                )}
              </div>
            );
          })}
          <button className="justify-self-start text-xs font-semibold text-[var(--brand-primary)]" onClick={() => void loadHistory()} type="button">
            Refresh status
          </button>
        </div>
      )}
    </div>
  );
}

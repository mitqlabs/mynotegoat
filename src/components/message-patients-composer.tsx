"use client";

/**
 * Settings → Text Reminders → Message patients. Send one text (e.g. an
 * emergency closure) for an audience: all active patients (default) or the
 * patients booked on a day. Stored in Supabase (reminder_broadcasts +
 * reminder_broadcast_recipients); the office's sending device delivers it
 * through /api/reminders/queue. More audiences (all patients, patients seen
 * in a time period) slot in through BROADCAST_AUDIENCES in
 * reminder-automation.ts plus a loader below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { fmtDate, queuedStatusText, sentFromText } from "@/lib/reminder-format";
import { CollapsibleSection } from "@/components/collapsible-section";
import { useSimpleConfirm } from "@/components/fill-confirm-dialog";
import {
  addDaysIso,
  BROADCAST_AUDIENCES,
  broadcastSendDay,
  DEFAULT_BROADCAST_AUDIENCE,
  localHHMM,
  localNow,
  pickAudienceRecipients,
  pickBroadcastRecipients,
  to12h,
  type BroadcastAudience,
  type BroadcastCandidate,
  type BroadcastPatient,
} from "@/lib/reminder-automation";
import type { SmsReminderSettings } from "@/lib/sms-reminders";

const label = "text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]";
const input = "h-[42px] rounded-xl border border-[var(--line-soft)] bg-white px-3";
// Solid brand button. Do NOT also set bg-white here: two bg-* classes on one element
// are resolved by stylesheet order, and white-on-white made this button invisible.
const primaryBtn =
  "h-[42px] shrink-0 rounded-xl border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const MAX = 640;
/** Supabase returns at most 1000 rows per request; recipients insert in chunks. */
const PAGE = 1000;
const INSERT_CHUNK = 500;

type Target = "today" | "tomorrow" | "date";
type BroadcastRow = {
  id: string;
  message: string;
  target_date: string;
  created_at: string;
  canceled_at: string | null;
  reminder_broadcast_recipients: { status: string; appointment_id: string | null }[] | null;
};

/** mm/dd/yy, like every other date on the Text Reminders page. */
const usDate = fmtDate;

/** Must match the shortcut name in tools/build-shortcuts.py. */
export const SEND_NOW_SHORTCUT_URL = "shortcuts://run-shortcut?name=Send%20Reminders%20Now";

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports "Macintosh" but has touch.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Runs the "Send Reminders Now" shortcut. Rendered on iPhone / iPad only. */
export function SendFromIphoneButton({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // navigator is client-only; decide after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(isAppleMobile());
  }, []);
  if (!show) return null;
  return (
    <a
      className={`inline-flex h-[42px] items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white ${className}`}
      data-testid="send-from-iphone"
      href={SEND_NOW_SHORTCUT_URL}
    >
      Send now from this device
    </a>
  );
}

export interface MessagePatientsPrefill {
  /** Bumps on every request so the same prefill can be applied twice. */
  key: number;
  date: string;
  message: string;
  startTime?: string;
  endTime?: string;
}

export function MessagePatientsComposer({
  settings,
  workspaceId,
  prefill,
  macConnected = false,
  recentOpen = true,
  onRecentToggle,
}: {
  settings: SmsReminderSettings;
  workspaceId: string;
  /** e.g. from a Key Date: closure text for the visits outside its hours. */
  prefill?: MessagePatientsPrefill | null;
  /** An active, non-revoked Mac has checked in. Only then does the text mention the iMac. */
  macConnected?: boolean;
  /** "Recent messages" open/closed (kept in the cloud-backed settings by the parent). */
  recentOpen?: boolean;
  onRecentToggle?: (open: boolean) => void;
}) {
  const todayIso = useMemo(() => localNow(new Date(), settings.timeZone).iso, [settings.timeZone]);
  const { ask, confirmDialog } = useSimpleConfirm();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>(DEFAULT_BROADCAST_AUDIENCE);
  const [target, setTarget] = useState<Target>("today");
  const [pickedDate, setPickedDate] = useState(todayIso);
  // Hidden time window: only set by a Key Dates prefill (e.g. "after 2 PM").
  // For today, visits already past are always skipped (here and on the server).
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [appliedPrefill, setAppliedPrefill] = useState(0);
  if (prefill && prefill.key !== appliedPrefill) {
    setAppliedPrefill(prefill.key);
    setText(prefill.message);
    // A Key Dates closure text is for the visits on that day.
    setAudience("booked");
    const t: Target = prefill.date === todayIso ? "today" : prefill.date === addDaysIso(todayIso, 1) ? "tomorrow" : "date";
    setTarget(t);
    setPickedDate(prefill.date);
    setStartTime(prefill.startTime ?? "");
    setEndTime(prefill.endTime ?? "");
  }
  const [excludeCanceled, setExcludeCanceled] = useState(true);
  const [recipients, setRecipients] = useState<BroadcastCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [justQueued, setJustQueued] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prefill) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [prefill]);

  const isBooked = audience === "booked";
  const sendDay = broadcastSendDay(new Date(), settings);
  // Booked: the day you pick. Everyone else: the send day (today, or tomorrow
  // if it's the evening part of quiet hours), so the device picks it up promptly.
  const date = !isBooked ? sendDay.iso : target === "today" ? todayIso : target === "tomorrow" ? addDaysIso(todayIso, 1) : pickedDate;
  const isToday = date === todayIso;
  const windowError = isBooked && startTime && endTime && endTime <= startTime ? "The end time must be after the start time." : "";
  const audienceOption = BROADCAST_AUDIENCES.find((a) => a.id === audience) ?? BROADCAST_AUDIENCES[0];
  const loadToken = useRef(0);

  const changeTarget = (next: Target) => {
    setTarget(next);
    setStartTime("");
    setEndTime("");
  };

  /** Patient-list audiences: read the workspace's patients (paged) and pick. */
  const loadPatientAudience = useCallback(
    async (which: Exclude<BroadcastAudience, "booked">) => {
      const client = getSupabaseBrowserClient();
      if (!client || !workspaceId) return null;
      const patients: BroadcastPatient[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
          .from("patients")
          .select("id, full_name, phone, case_status, text_reminders_off")
          .eq("workspace_id", workspaceId)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) return null;
        for (const p of data ?? []) {
          patients.push({
            patientId: p.id as string,
            patientName: String(p.full_name ?? ""),
            phone: String(p.phone ?? ""),
            caseStatus: String(p.case_status ?? ""),
            optedOut: p.text_reminders_off === true,
          });
        }
        if ((data?.length ?? 0) < PAGE) break;
      }
      return pickAudienceRecipients(which, patients);
    },
    [workspaceId],
  );

  const loadRecipients = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId || !date) return;
    const token = ++loadToken.current;
    setLoading(true);
    if (audience !== "booked") {
      const list = await loadPatientAudience(audience);
      if (token !== loadToken.current) return;
      if (list) setStatus((s) => (s.startsWith("Couldn't load") ? "" : s));
      else setStatus("Couldn't load patients. Check your connection and try again.");
      setRecipients(list ?? []);
      setLoading(false);
      return;
    }
    const { data: appts } = await client
      .from("schedule_appointments")
      .select("id, patient_id, patient_name, start_time, status")
      .eq("workspace_id", workspaceId)
      .eq("date", date);
    if (token !== loadToken.current) return;
    const rows = appts ?? [];
    const ids = Array.from(new Set(rows.map((r) => r.patient_id as string).filter(Boolean)));
    const { data: pts } = ids.length
      ? await client.from("patients").select("id, full_name, phone, text_reminders_off").eq("workspace_id", workspaceId).in("id", ids)
      : { data: [] as { id: string; full_name: string; phone: string; text_reminders_off: boolean }[] };
    if (token !== loadToken.current) return;
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
        {
          excludeCanceled,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          notBefore: date === localNow(new Date(), settings.timeZone).iso ? localHHMM(new Date(), settings.timeZone) : undefined,
        },
      ),
    );
    setLoading(false);
  }, [workspaceId, date, audience, loadPatientAudience, excludeCanceled, startTime, endTime, settings.timeZone]);

  const loadHistory = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !workspaceId) return;
    const { data } = await client
      .from("reminder_broadcasts")
      .select("id, message, target_date, created_at, canceled_at, reminder_broadcast_recipients(status, appointment_id)")
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

  const windowLabel = !isBooked
    ? ""
    : startTime && endTime
      ? `${to12h(startTime)} – ${to12h(endTime)}`
      : startTime
        ? `after ${to12h(startTime)}`
        : endTime
          ? `before ${to12h(endTime)}`
          : isToday
            ? "visits still ahead"
            : "";
  const windowLine = isBooked && (startTime || endTime) ? `Texting patients ${windowLabel}` : "";

  const queue = async () => {
    setJustQueued(false);
    const client = getSupabaseBrowserClient();
    const message = text.trim();
    if (!client || !workspaceId) return setStatus("Sign in to message patients.");
    if (!message) return setStatus("Type a message first.");
    if (windowError) return setStatus(windowError);
    if (!recipients.length) {
      return setStatus(isBooked ? "No patients with a phone number in that time." : "No active patients with a phone number.");
    }
    const ok = await ask({
      title: `Text ${recipients.length} patient(s)?`,
      lines: [
        isBooked ? `Booked ${usDate(date)}${windowLabel ? `, ${windowLabel}` : ""}.` : `${audienceOption.label}.`,
        ...(!isBooked && sendDay.deferred ? [`It's quiet hours now. It will go out after ${to12h(`${String(settings.quietEndHour).padStart(2, "0")}:00`)}.`] : []),
        `"${message}"`,
        ...(settings.dryRun ? ["Test mode is on: nothing will actually be texted."] : []),
      ],
      confirmLabel: "Send message",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy(true);
    const row: Record<string, unknown> = { workspace_id: workspaceId, message, target_date: date, exclude_canceled: excludeCanceled };
    if (isBooked && startTime) row.start_time = startTime;
    if (isBooked && endTime) row.end_time = endTime;
    const { data: b, error } = await client.from("reminder_broadcasts").insert(row).select("id").single();
    if (error || !b) {
      setBusy(false);
      return setStatus(`Couldn't send the message: ${error?.message ?? "unknown error"}`);
    }
    const rows = recipients.map((r) => ({
      broadcast_id: b.id,
      workspace_id: workspaceId,
      patient_id: r.patientId,
      appointment_id: r.appointmentId || null,
      phone_last4: r.phone.replace(/\D/g, "").slice(-4),
    }));
    let rErr: { message: string } | null = null;
    for (let i = 0; i < rows.length && !rErr; i += INSERT_CHUNK) {
      ({ error: rErr } = await client.from("reminder_broadcast_recipients").insert(rows.slice(i, i + INSERT_CHUNK)));
    }
    if (rErr) {
      // Never leave a half-queued message: cancel it so nobody gets a partial send.
      await client.from("reminder_broadcasts").update({ canceled_at: new Date().toISOString() }).eq("id", b.id);
    }
    setBusy(false);
    if (rErr) return setStatus(`Couldn't send the message (nothing was sent): ${rErr.message}`);
    setText("");
    setJustQueued(true);
    setStatus(queuedStatusText(recipients.length, settings.dryRun, macConnected));
    void loadHistory();
  };

  const cancel = async (id: string) => {
    const ok = await ask({
      title: "Cancel this message?",
      lines: ["Texts that haven't gone out yet won't be sent."],
      confirmLabel: "Cancel message",
      cancelLabel: "Keep",
    });
    if (!ok) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    await client.from("reminder_broadcasts").update({ canceled_at: new Date().toISOString() }).eq("id", id);
    await client.from("reminder_broadcast_recipients").update({ status: "canceled" }).eq("broadcast_id", id).eq("status", "queued");
    void loadHistory();
  };

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3 text-sm" data-testid="message-patients" ref={rootRef}>
      <div>
        <p className="font-semibold">Message patients</p>
        <p className="text-[var(--text-muted)]">
          Send one text to everyone booked on a day, for example an emergency closure. It goes out from {sentFromText(macConnected)} like the reminders.
        </p>
      </div>
      {settings.dryRun && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800">
          Test mode is on: nobody is texted. Turn it off in Texts when you are ready.
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
          <span className={label}>Send to</span>
          <select
            className={input}
            data-testid="message-patients-audience"
            onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
            value={audience}
          >
            {BROADCAST_AUDIENCES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {isBooked && (
          <>
            <label className="grid gap-1">
              <span className={label}>Booked</span>
              <select className={input} onChange={(e) => changeTarget(e.target.value as Target)} value={target}>
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
          </>
        )}
      </div>
      <p className="-mt-1 text-xs text-[var(--text-muted)]" data-testid="message-patients-audience-summary">
        {audienceOption.summary}
        {!isBooked && sendDay.deferred ? ` It's quiet hours, so it will go out after ${to12h(`${String(settings.quietEndHour).padStart(2, "0")}:00`)}.` : ""}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-left font-semibold text-[var(--brand-primary)]" onClick={() => setShowList((v) => !v)} type="button">
          {loading
            ? "Counting…"
            : isBooked
              ? `${recipients.length} patient(s) on ${usDate(date)}${windowLabel ? ` · ${windowLabel}` : ""}`
              : `${recipients.length} active patient(s)`} {recipients.length > 0 && (showList ? "▴" : "▾")}
        </button>
        <button
          className={primaryBtn}
          data-testid="message-patients-send"
          disabled={busy || loading || !text.trim() || !recipients.length || Boolean(windowError)}
          onClick={() => void queue()}
          type="button"
        >
          {busy ? "Sending…" : "Send message"}
        </button>
      </div>
      {showList && recipients.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-[var(--line-soft)] px-3 py-2 text-[var(--text-muted)]">
          {recipients.map((r) => (
            <li key={r.patientId}>
              {r.time ? `${to12h(r.time)} · ` : ""}{r.patientName} · ***{r.phone.replace(/\D/g, "").slice(-4)}
            </li>
          ))}
        </ul>
      )}
      {windowLine && (
        <p className="text-sm" data-testid="message-patients-window">
          {windowLine}.{" "}
          <button className="font-semibold text-[var(--brand-primary)] underline" onClick={() => { setStartTime(""); setEndTime(""); }} type="button">
            Whole day
          </button>
        </p>
      )}
      {windowError && <p className="font-semibold text-red-700">{windowError}</p>}
      <p className="text-xs text-[var(--text-muted)]">
        {isBooked ? "Visits that already passed are never texted. " : ""}Only patients with a phone number are included, once per phone number. Patients marked &quot;no text reminders&quot; (or who replied STOP) are skipped. Quiet hours apply.
      </p>
      {status && <p className="font-semibold">{status}</p>}
      {justQueued && <SendFromIphoneButton className="justify-self-start" />}
      {history.length > 0 && (
        <CollapsibleSection
          actions={
            <button className="text-xs font-semibold text-[var(--brand-primary)]" onClick={() => void loadHistory()} type="button">
              Refresh
            </button>
          }
          onToggle={(next) => onRecentToggle?.(next)}
          open={recentOpen}
          testId="recent-messages"
          title="Recent messages"
          variant="inline"
        >
        <div className="grid gap-1">
          {history.map((h) => {
            const rs = h.reminder_broadcast_recipients ?? [];
            const count = (s: string) => rs.filter((r) => r.status === s).length;
            const queued = count("queued");
            const summary = h.canceled_at
              ? `Canceled · sent ${count("sent")} of ${rs.length}`
              : count("dry-run")
                ? `Test mode · ${count("dry-run")} not texted`
                : queued
                  ? `Waiting · sent ${count("sent")} of ${rs.length}`
                  : `Sent ${count("sent")} of ${rs.length}${count("failed") ? ` · ${count("failed")} failed` : ""}`;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-1" key={h.id}>
                <span className="min-w-0 flex-1 truncate">
                  <b>{rs.length > 0 && rs.every((r) => !r.appointment_id) ? "Active patients" : usDate(h.target_date)}</b> · {h.message}
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
        </div>
        </CollapsibleSection>
      )}
      {confirmDialog}
    </div>
  );
}

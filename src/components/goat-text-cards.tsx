"use client";

/**
 * G.O.A.T. cards for texting patients and bulk-canceling visits. Presentation only: every action is a
 * callback, and nothing is queued or canceled until the user taps the Send / red Cancel button.
 */
import { useState } from "react";
import type { ChatMessage } from "@/lib/goat-ai/global-chat";
import { BROADCAST_MAX } from "@/lib/broadcast-queue";
import { audienceLabel } from "@/lib/goat-text";

const btn = "rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
const primary = `${btn} border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white`;
const quiet = `${btn} border-[var(--line-soft)] bg-white text-[var(--text-muted)]`;
const danger = `${btn} border-red-700 bg-red-600 text-white hover:bg-red-700`;

/** The Send card for a patient text. */
export function TextCard({ d, today, onChange, onSend, onCancel }: {
  d: NonNullable<ChatMessage["textDraft"]>;
  today: string;
  onChange: (message: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const who = audienceLabel(d.audience, today);
  if (d.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Okay, nothing was sent.</p>;
  if (d.state === "queued") return <p className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-800" data-goat-text-queued>{d.result}</p>;
  const n = d.recipients?.length ?? 0;
  const len = d.message.trim().length;
  const tooLong = len > BROADCAST_MAX;
  const busy = d.state === "queuing";
  const canSend = d.state === "open" && n > 0 && len > 0 && !tooLong;
  return (
    <div className="mt-2 space-y-2 text-xs" data-goat-text-card>
      <div className="rounded-lg bg-[#eef8fb] px-2.5 py-2">
        <div className="text-[11px] font-bold tracking-wide text-[#2f7f93]">TEXT TO: {who.toUpperCase()}</div>
        <div className="mt-0.5 text-[13px] font-semibold">
          {n === 0 ? "Nobody to text" : `${n} ${n === 1 ? "patient" : "patients"} will get this`}
          {n > 0 && (
            <button className="ml-2 text-[11px] font-semibold text-[var(--brand-primary)] underline" onClick={() => setOpen((v) => !v)} type="button">
              {open ? "Hide the list" : "See the list"}
            </button>
          )}
        </div>
        {open && (
          <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-[12px]" data-goat-text-list>
            {d.recipients?.map((r) => <li key={r.id}>{r.name}</li>)}
          </ul>
        )}
        {d.skipped && d.skipped.optedOut + d.skipped.noPhone + d.skipped.sharedPhone > 0 && (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Left out:{" "}
            {[
              d.skipped.optedOut ? `${d.skipped.optedOut} replied STOP / no texts` : "",
              d.skipped.noPhone ? `${d.skipped.noPhone} with no phone number` : "",
              d.skipped.sharedPhone ? `${d.skipped.sharedPhone} sharing a phone (one text per phone)` : "",
            ].filter(Boolean).join(", ")}
            .
          </p>
        )}
        {d.deferred && <p className="mt-1 text-[11px] text-amber-800">It&apos;s quiet hours right now, so this goes out after they end.</p>}
      </div>
      <label className="block">
        <span className="mb-0.5 block text-[11px] font-semibold text-[var(--text-muted)]">Message</span>
        <textarea
          aria-label="Text message"
          className="w-full rounded-xl border border-[#72bdcf] bg-white px-2.5 py-1.5 text-[13px]"
          disabled={busy}
          maxLength={BROADCAST_MAX + 200}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          value={d.message}
        />
        <span className={`block text-right text-[11px] ${tooLong ? "font-semibold text-red-700" : "text-[var(--text-muted)]"}`}>{len} / {BROADCAST_MAX}</span>
      </label>
      {d.state === "error" && d.result && <p className="rounded-md bg-red-50 px-2 py-1 font-semibold text-red-800">{d.result}</p>}
      {d.result && d.state === "open" && <p className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800">{d.result}</p>}
      <p className="text-[11px] text-[var(--text-muted)]">Nothing is sent until you tap Send.</p>
      <div className="flex flex-wrap gap-1.5">
        <button className={primary} disabled={!canSend} onClick={onSend} type="button">{busy ? "Sending…" : `Send to ${n} ${n === 1 ? "patient" : "patients"}`}</button>
        <button className={quiet} disabled={busy} onClick={onCancel} type="button">Never mind</button>
      </div>
    </div>
  );
}

/** The checklist for a bulk cancel. */
export function BulkCancelCard({ d, busy, onToggle, onToggleAll, onCancelVisits, onNever, onUndo, onTextThem }: {
  d: NonNullable<ChatMessage["bulkCancel"]>;
  busy: boolean;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onCancelVisits: () => void;
  onNever: () => void;
  onUndo: () => void;
  onTextThem: () => void;
}) {
  const n = d.rows.filter((r) => r.checked).length;
  if (d.state === "canceled") return <p className="mt-1.5 text-xs text-[var(--text-muted)]">Okay, nothing was canceled.</p>;
  if (d.state === "undone") return <p className="mt-1.5 text-xs font-semibold text-emerald-700">{d.result}</p>;
  if (d.state === "done") {
    return (
      <div className="mt-2 space-y-1.5 text-xs" data-goat-bulk-done>
        <p className="rounded-lg bg-emerald-50 px-2.5 py-2 font-semibold text-emerald-800">{d.result}</p>
        <div className="flex flex-wrap gap-1.5">
          {d.offerText && <button className={primary} onClick={onTextThem} type="button">Also text these patients</button>}
          <button className={quiet} disabled={busy} onClick={onUndo} type="button">Undo</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2 text-xs" data-goat-bulk-card>
      <div className="rounded-lg bg-[#fff7f7] px-2.5 py-2">
        <div className="text-[11px] font-bold tracking-wide text-red-700">{d.heading.toUpperCase()}</div>
        <label className="mt-1 flex items-center gap-2 text-[12px] font-semibold">
          <input checked={n === d.rows.length} disabled={busy} onChange={(e) => onToggleAll(e.target.checked)} type="checkbox" />
          {n} of {d.rows.length} selected
        </label>
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto" data-goat-bulk-list>
          {d.rows.map((r) => (
            <li key={r.id}>
              <label className="flex items-start gap-2 text-[12px]">
                <input checked={r.checked} className="mt-0.5" disabled={busy} onChange={() => onToggle(r.id)} type="checkbox" />
                <span>
                  <span className="font-semibold">{r.time}</span> {r.patientName}
                  <span className="text-[var(--text-muted)]">{[r.type, r.provider].filter(Boolean).map((x) => ` · ${x}`).join("")}</span>
                  {r.prevStatus === "Reschedule" && <span className="text-[var(--text-muted)]"> · marked Reschedule</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">Nothing is canceled until you tap the red button. You can undo it after.</p>
      <div className="flex flex-wrap gap-1.5">
        <button className={danger} disabled={busy || n === 0} onClick={onCancelVisits} type="button">{busy ? "Canceling…" : `Cancel ${n} ${n === 1 ? "appointment" : "appointments"}`}</button>
        <button className={quiet} disabled={busy} onClick={onNever} type="button">Never mind</button>
      </div>
    </div>
  );
}

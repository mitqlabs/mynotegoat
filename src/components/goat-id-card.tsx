"use client";

import { useRef } from "react";
import { ID_FIELD_LABEL, idAddress, type IdCardState, type IdField } from "@/lib/goat-id";
import { dayLabel } from "@/lib/goat-howto";
import { to12hLabel } from "@/lib/time-12h";

const CONF_BADGE = {
  exact: { label: "barcode", className: "bg-emerald-50 text-emerald-800" },
  read: { label: "read", className: "bg-sky-50 text-sky-800" },
  check: { label: "check", className: "bg-amber-50 text-amber-800" },
} as const;

const NEW_FIELDS: IdField[] = ["lastName", "firstName", "dob", "sex", "street", "unit", "city", "state", "zip"];

/**
 * The one confirm card for an ID G.O.A.T. read: "Add new patient: …" (with an
 * optional New Patient visit) or "Update Smith, John with: …" (blanks filled,
 * conflicts to choose). Nothing is saved until Confirm.
 */
export function IdCard({ card, busy, onChange, onConfirm, onCancel }: { card: IdCardState; busy: boolean; onChange: (c: IdCardState) => void; onConfirm: () => void; onCancel: () => void }) {
  const open = card.state === "open";
  const set = (k: IdField, v: string) => onChange({ ...card, values: { ...card.values, [k]: v } });
  const name = [card.values.firstName, card.values.lastName].filter(Boolean).join(" ") || "this patient";
  const phoneOk = card.mode === "update" || card.phone.replace(/\D/g, "").length === 10;
  const nameOk = card.mode === "update" || Boolean(card.values.firstName?.trim() && card.values.lastName?.trim());
  const visitBlocked = Boolean(card.visit && (card.visit.taken || card.visit.outsideHours) && !card.visit.override);
  const input = "w-full rounded-md border border-[var(--line-soft)] px-1.5 py-0.5 text-xs";
  return (
    <div className="mt-2 rounded-xl border border-[#72bdcf] bg-[#f6fbfd] p-2.5 text-xs" data-goat-id-card={card.mode}>
      <div className="text-[11px] font-bold tracking-wide text-[#2f7f93]">
        {card.mode === "new" ? `ADD NEW PATIENT${card.visit ? " + NEW PATIENT VISIT" : ""}` : `UPDATE ${(card.patientName ?? "").toUpperCase()}`}
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
        Read from the {card.side === "back" ? "barcode on the back" : "front"} of the ID, here in your browser.
      </p>
      {card.mode === "new" ? (
        <div className="mt-1.5 grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1">
          {NEW_FIELDS.map((k) => (
            <FieldRow key={k} card={card} k={k} open={open} input={input} onSet={set} />
          ))}
          <label className="font-semibold">Phone *</label>
          <input aria-label="Phone" className={input} disabled={!open} onChange={(e) => onChange({ ...card, phone: e.target.value })} value={card.phone} />
          <label className="font-semibold">Marital</label>
          <select aria-label="Marital status" className={input} disabled={!open} onChange={(e) => onChange({ ...card, marital: e.target.value })} value={card.marital}>
            <option value="">–</option>
            {["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic Partner"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {card.plan && card.plan.fills.length === 0 && card.plan.conflicts.length === 0 && <p>Everything on the ID already matches the patient file.</p>}
          {card.plan?.fills.map((f) => (
            <p key={f.key}>
              <span className="font-semibold">{f.label}:</span> {f.value} <span className="text-[var(--text-muted)]">(blank now)</span>
            </p>
          ))}
          {card.plan?.conflicts.map((c) => (
            <div key={c.key} className="rounded-md bg-amber-50 p-1.5">
              <div className="font-semibold text-amber-900">{c.label} is different — pick one:</div>
              {[false, true].map((useId) => (
                <label key={String(useId)} className="mt-0.5 flex items-start gap-1.5">
                  <input checked={Boolean(card.useId[c.key]) === useId} disabled={!open} name={`${card.fileKey}-${c.key}`} onChange={() => onChange({ ...card, useId: { ...card.useId, [c.key]: useId } })} type="radio" />
                  <span>
                    {useId ? "From ID: " : "Keep: "}
                    {useId ? c.fromId : c.current}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {card.visit && (
        <div className={`mt-2 rounded-md p-1.5 ${card.visit.taken || card.visit.outsideHours ? "bg-amber-50" : "bg-white"}`}>
          <div className="font-semibold">
            New Patient visit: {dayLabel(card.visit.date)} at {to12hLabel(card.visit.time)} ({card.visit.durationMin} min)
          </div>
          <div className="text-[var(--text-muted)]">
            {[card.visit.type, card.visit.provider, card.visit.location].filter(Boolean).join(" · ")}
          </div>
          {card.visit.notes.map((n) => (
            <p key={n} className="text-[var(--text-muted)]">{n}</p>
          ))}
          {card.visit.taken && <p className="font-semibold text-amber-800">That time is already booked.</p>}
          {card.visit.outsideHours && <p className="font-semibold text-amber-800">That&apos;s outside office hours.</p>}
          {(card.visit.taken || card.visit.outsideHours) && card.visit.suggestions.length > 0 && open && (
            <div className="mt-1 flex flex-wrap gap-1">
              {card.visit.suggestions.map((t) => (
                <button key={t} className="rounded-full border border-[#72bdcf] bg-[#eef8fb] px-2 py-0.5 font-semibold" onClick={() => onChange({ ...card, visit: { ...card.visit!, time: t, taken: false, outsideHours: false, suggestions: [], override: false } })} type="button">
                  {to12hLabel(t)}
                </button>
              ))}
            </div>
          )}
          {(card.visit.taken || card.visit.outsideHours) && open && (
            <label className="mt-1 flex items-center gap-1.5">
              <input checked={card.visit.override} onChange={(e) => onChange({ ...card, visit: { ...card.visit!, override: e.target.checked } })} type="checkbox" /> Book it anyway
            </label>
          )}
          {open && (
            <button className="mt-1 text-[11px] font-semibold text-[var(--text-muted)] hover:underline" onClick={() => onChange({ ...card, visit: undefined })} type="button">
              Don&apos;t book a visit
            </button>
          )}
        </div>
      )}
      {card.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-800">
          {card.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <label className="mt-2 flex items-center gap-1.5 font-semibold">
        <input checked={card.saveId} disabled={!open} onChange={(e) => onChange({ ...card, saveId: e.target.checked })} type="checkbox" />
        Save ID to file{card.side ? ` (${card.side})` : ""}
      </label>
      {card.state === "open" ? (
        <div className="mt-2 flex gap-2">
          <button className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 font-semibold text-white disabled:opacity-40" disabled={busy || !phoneOk || !nameOk || visitBlocked} onClick={onConfirm} type="button">
            {card.mode === "new" ? (card.visit ? "Add patient & book" : "Add patient") : "Update patient"}
          </button>
          <button className="rounded-lg border border-[var(--line-soft)] px-3 py-1.5 font-semibold" onClick={onCancel} type="button">
            Cancel
          </button>
          {!phoneOk && <span className="self-center text-[11px] text-amber-800">Add {name}&apos;s phone.</span>}
        </div>
      ) : (
        <p className={`mt-2 font-semibold ${card.state === "done" ? "text-emerald-700" : "text-[var(--text-muted)]"}`}>{card.state === "done" ? card.result : "Canceled — nothing saved."}</p>
      )}
      {card.mode === "new" && open && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Address saved as: {idAddress(card.values) || "–"}</p>}
    </div>
  );
}

function FieldRow({ card, k, open, input, onSet }: { card: IdCardState; k: IdField; open: boolean; input: string; onSet: (k: IdField, v: string) => void }) {
  const conf = card.confidence[k];
  return (
    <>
      <label className="font-semibold">
        {ID_FIELD_LABEL[k]}
        {conf && <span className={`ml-1 rounded px-1 text-[9px] font-semibold ${CONF_BADGE[conf].className}`}>{CONF_BADGE[conf].label}</span>}
      </label>
      {k === "sex" ? (
        <select aria-label="Sex" className={input} disabled={!open} onChange={(e) => onSet(k, e.target.value)} value={card.values.sex ?? ""}>
          <option value="">–</option>
          <option>Male</option>
          <option>Female</option>
          <option>Other</option>
        </select>
      ) : (
        <input aria-label={ID_FIELD_LABEL[k]} className={`${input} ${conf === "check" ? "border-amber-400" : ""}`} disabled={!open} onChange={(e) => onSet(k, e.target.value)} placeholder={k === "dob" ? "MM/DD/YYYY" : ""} value={card.values[k] ?? ""} />
      )}
    </>
  );
}

/** 📎 (image / PDF) and, in the /goat phone app, 📷 (camera). */
export function GoatAttachButtons({ camera, disabled, onFiles }: { camera: boolean; disabled: boolean; onFiles: (files: File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const pickFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /^image\//.test(f.type) || f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (files.length) onFiles(files);
  };
  const btn = "shrink-0 rounded-xl border border-[var(--line-soft)] bg-white px-2 text-base disabled:opacity-40";
  return (
    <>
      <button aria-label="Attach an ID or screenshot" className={btn} data-goat-attach disabled={disabled} onClick={() => fileRef.current?.click()} title="Attach an ID, screenshot or PDF (read here in your browser)" type="button">
        📎
      </button>
      <input accept="image/*,application/pdf" className="hidden" multiple onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} ref={fileRef} type="file" />
      {camera && (
        <>
          <button aria-label="Take a photo" className={btn} data-goat-camera disabled={disabled} onClick={() => camRef.current?.click()} title="Take a photo of an ID" type="button">
            📷
          </button>
          <input accept="image/*" capture="environment" className="hidden" onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} ref={camRef} type="file" />
        </>
      )}
    </>
  );
}

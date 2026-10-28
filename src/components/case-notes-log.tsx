"use client";

import { useRef, useState } from "react";
import { useCaseNoteEntries } from "@/hooks/use-case-note-entries";
import { useCaseNotes } from "@/hooks/use-case-notes";
import { formatEntryDate, isValidIsoDate, type CaseNoteEntry } from "@/lib/case-note-entries";
import { UsDateInput, isoToUsDate, usDateToIso } from "@/components/us-date-input";

const FIELD = "w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm";
const LINK_BTN = "rounded-md px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--brand-primary)]";

/**
 * The patient's Notes: type a note, press Enter (Shift+Enter = new line) or
 * tap "Add note". It is saved as an entry stamped with today's date and the
 * signed-in person's name. Used by the patient page and the encounter side
 * rail, so both show the same cloud-backed list. The old free-form text shows
 * below as "Earlier notes" (only when there is some).
 */
export function CaseNotesLog({
  patientId,
  patientName = "",
  seed = "",
  maxListHeight = 340,
}: {
  patientId: string;
  patientName?: string;
  /** Legacy patient.matrix.notes fallback for the old free-form text. */
  seed?: string;
  maxListHeight?: number;
}) {
  const { entries, add, edit, remove, cloudOk, canEditDate, canEditText } = useCaseNoteEntries(patientId, patientName);
  const { notes: legacy, setNotes: setLegacy } = useCaseNotes(patientId, seed);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const submit = () => {
    if (add(draft)) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  const startEdit = (e: CaseNoteEntry) => {
    setConfirmId(null);
    setEditingId(e.id);
    setEditText(e.text);
    setEditDate(isoToUsDate(e.date));
  };

  const dateIso = usDateToIso(editDate);
  const editValid = editText.trim().length > 0 && isValidIsoDate(dateIso);

  const saveEdit = (e: CaseNoteEntry) => {
    if (!editValid) return;
    edit(e.id, { text: editText, ...(canEditDate ? { date: dateIso } : {}) });
    setEditingId(null);
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-[var(--line-soft)] bg-white p-2 focus-within:border-[var(--brand-primary)]">
        <textarea
          aria-label="Add a note"
          className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Type a note and press Enter…"
          ref={inputRef}
          rows={2}
          value={draft}
        />
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <span className="text-[11px] text-[var(--text-muted)]">Enter to add · Shift+Enter for a new line</span>
          <button
            className="rounded-full bg-[var(--brand-primary)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!draft.trim()}
            onClick={submit}
            type="button"
          >
            Add note
          </button>
        </div>
      </div>

      {!cloudOk && (
        <p className="text-xs font-semibold text-[#b45309]">Saved on this device. It will sync to the cloud as soon as the connection is back.</p>
      )}

      {entries.length > 0 && (
        <ul className="grid divide-y divide-[var(--line-soft)] overflow-y-auto rounded-xl border border-[var(--line-soft)] bg-white" style={{ maxHeight: maxListHeight }}>
          {entries.map((e) => {
            const editing = editingId === e.id;
            const mayEdit = canEditText(e);
            return (
              <li className="px-3 py-2" key={e.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-semibold">{formatEntryDate(e.date)}</span>
                    {e.author && <span className="ml-2 font-semibold text-[var(--brand-primary)]">{e.author}</span>}
                    {e.editedBy && <span className="ml-2 text-[11px] text-[var(--text-muted)]">edited by {e.editedBy}</span>}
                  </p>
                  {mayEdit && !editing && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {confirmId === e.id ? (
                        <>
                          <button className={`${LINK_BTN} !text-[#c9423a]`} onClick={() => { remove(e.id); setConfirmId(null); }} type="button">
                            Delete note?
                          </button>
                          <button className={LINK_BTN} onClick={() => setConfirmId(null)} type="button">
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button className={LINK_BTN} onClick={() => startEdit(e)} type="button">
                            Edit
                          </button>
                          <button className={LINK_BTN} onClick={() => setConfirmId(e.id)} type="button">
                            Delete
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {editing ? (
                  <div className="mt-2 grid gap-2">
                    {canEditDate && (
                      <label className="grid max-w-[180px] gap-1 text-xs font-semibold text-[var(--text-muted)]">
                        Date
                        <UsDateInput className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-normal text-[var(--text-main)]" onChange={setEditDate} value={editDate} />
                      </label>
                    )}
                    <textarea
                      aria-label="Edit note"
                      autoFocus
                      className={`${FIELD} min-h-[64px]`}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      value={editText}
                    />
                    <div className="flex gap-2">
                      <button className="rounded-full bg-[var(--brand-primary)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40" disabled={!editValid} onClick={() => saveEdit(e)} type="button">
                        Save
                      </button>
                      <button className="rounded-full border border-[var(--line-soft)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]" onClick={() => setEditingId(null)} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.text}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {legacy.trim() && (
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Earlier notes</span>
          <textarea
            className={`${FIELD} min-h-[90px]`}
            onChange={(event) => setLegacy(event.target.value)}
            value={legacy}
          />
        </label>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { ScrollLock } from "@/components/scroll-lock";
import { TimeInput12h } from "@/components/time-input-12h";
import { UsDateInput } from "@/components/us-date-input";
import type { CasePopupConflict, CasePopupDraft } from "@/lib/new-patient-intake";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { to12hLabel } from "@/lib/time-12h";

export type CaseAttorneyOption = { id: string; name: string; phone: string };

const emptyDraft: CasePopupDraft = { attorney: "", attorneyPhone: "", dateOfLoss: "", evalDate: "", evalTime: "" };

function attorneyKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * New Patient "+ Case". Attorney, date of injury, and the first exam are
 * all optional. Picking an attorney fills the phone. A date of injury fills
 * the case number. Save is the parent's job (book the visit, store the exam
 * date, and move the chart once a date of injury exists).
 */
export function NewPatientCasePopup({
  initial,
  attorneys,
  purpose,
  message,
  conflict,
  onCaseNumber,
  onDismissIssue,
  onClose,
  onSave,
}: {
  initial?: CasePopupDraft;
  attorneys: CaseAttorneyOption[];
  purpose: "new" | "intake";
  message?: string;
  conflict?: CasePopupConflict | null;
  onCaseNumber: (dateOfLoss: string) => string;
  onDismissIssue: () => void;
  onClose: () => void;
  onSave: (draft: CasePopupDraft, bookAnyway: boolean) => void;
}) {
  const [draft, setDraft] = useState<CasePopupDraft>(initial ?? emptyDraft);
  const [bookAnyway, setBookAnyway] = useState(false);
  const [typingNew, setTypingNew] = useState(
    () => Boolean(initial?.attorney) && !attorneys.some((contact) => attorneyKey(contact.name) === attorneyKey(initial?.attorney ?? "")),
  );
  const known = attorneys.find((contact) => attorneyKey(contact.name) === attorneyKey(draft.attorney));

  const pickAttorney = (name: string) => {
    const match = attorneys.find((contact) => attorneyKey(contact.name) === attorneyKey(name));
    setTypingNew(false);
    setDraft((current) => ({
      ...current,
      attorney: name,
      attorneyPhone: match ? formatUsPhoneInput(match.phone) : "",
    }));
  };

  const changeWhen = (patch: Partial<CasePopupDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setBookAnyway(false);
    onDismissIssue();
  };

  return (
    <div className="modal-overlay fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8" data-testid="new-patient-case-popup">
      <ScrollLock />
      <form
        aria-labelledby="case-popup-title"
        className="panel-card mx-auto w-full max-w-xl overflow-hidden p-0"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSave(draft, bookAnyway);
        }}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
          <div>
            <h3 className="text-xl font-semibold" id="case-popup-title">+ Case</h3>
            <p className="text-sm text-[var(--text-muted)]">All of these can be left blank.</p>
          </div>
          <button aria-label="Close" className="btn btn-secondary btn-sm" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 sm:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney</span>
            <select
              className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              data-testid="case-attorney"
              onChange={(event) => {
                if (event.target.value === "__custom__") {
                  setTypingNew(true);
                  setDraft((current) => ({ ...current, attorney: "", attorneyPhone: "" }));
                  return;
                }
                pickAttorney(event.target.value);
              }}
              value={known ? known.name : typingNew ? "__custom__" : ""}
            >
              <option value="">Select attorney…</option>
              {attorneys.map((contact) => (
                <option key={contact.id} value={contact.name}>
                  {contact.name}
                </option>
              ))}
              <option value="__custom__">Type a new attorney…</option>
            </select>
          </label>
          {typingNew && (
            <label className="grid min-w-0 gap-1 sm:col-span-2">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney name</span>
              <input
                className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                data-testid="case-attorney-name"
                onChange={(event) => setDraft((current) => ({ ...current, attorney: event.target.value }))}
                placeholder="Law firm"
                value={draft.attorney}
              />
            </label>
          )}
          <label className="grid min-w-0 gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney Phone</span>
            <input
              className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              data-testid="case-attorney-phone"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => setDraft((current) => ({ ...current, attorneyPhone: formatUsPhoneInput(event.target.value) }))}
              placeholder="Fills from the attorney"
              value={draft.attorneyPhone}
            />
          </label>
          <label className="grid min-w-0 gap-1" data-testid="case-doi">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Date of Injury</span>
            <UsDateInput
              className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(formatted) => setDraft((current) => ({ ...current, dateOfLoss: formatted }))}
              placeholder="MM/DD/YYYY"
              value={draft.dateOfLoss}
            />
          </label>
          <label className="grid min-w-0 gap-1 sm:col-span-2">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Case #</span>
            <input
              className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-[rgba(242,247,252,0.65)] px-3 py-2 font-semibold tracking-[0.04em]"
              data-testid="case-number"
              placeholder="Fills from the date of injury"
              readOnly
              value={onCaseNumber(draft.dateOfLoss)}
            />
          </label>
          <label className="grid min-w-0 gap-1" data-testid="case-exam-date">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Initial Exam <span className="font-normal">(optional)</span></span>
            <UsDateInput
              className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(formatted) => changeWhen({ evalDate: formatted })}
              placeholder="MM/DD/YYYY"
              value={draft.evalDate}
            />
          </label>
          <label className="grid min-w-0 gap-1" data-testid="case-exam-time">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Time</span>
            <TimeInput12h
              allowEmpty
              ariaLabel="Initial exam time"
              dateIso={draft.evalDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2")}
              inputClassName="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(value) => changeWhen({ evalTime: value })}
              placeholder=""
              smart
              value={draft.evalTime}
            />
          </label>
        </div>

        <div className="grid gap-2 px-5 pb-4">
          <p className="text-xs text-[var(--text-muted)]">
            {purpose === "intake"
              ? "Save writes this onto the chart. A date of injury moves them onto the Patient List. An exam date and time book a New Patient visit and set the Initial Exam date."
              : "Save keeps this with the new patient. Create Patient books the visit. A date of injury puts them on the Patient List instead of New Patient Intake, and the exam date is saved as the Initial Exam."}
          </p>
          {message && !conflict && (
            <p className="text-sm font-semibold text-[#b43b34]" role="alert">{message}</p>
          )}
          {conflict && (
            <SlotConflict
              bookAnyway={bookAnyway}
              conflict={conflict}
              onBookAnyway={setBookAnyway}
              onPick={(time) => changeWhen({ evalTime: time })}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line-soft)] bg-[var(--bg-soft)] px-5 py-3">
          <button className="btn btn-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-primary" data-testid="case-popup-save" type="submit">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function SlotConflict({
  conflict,
  bookAnyway,
  onPick,
  onBookAnyway,
}: {
  conflict: CasePopupConflict;
  bookAnyway: boolean;
  onPick: (time: string) => void;
  onBookAnyway: (on: boolean) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-[#efc9c5] bg-[#fdf4f3] px-3 py-2.5" data-testid="new-patient-slot-issue" role="alert">
      <p className="text-sm font-semibold text-[#b43b34]">
        {to12hLabel(conflict.time)} {conflict.reason === "outside" ? "is outside office hours that day." : "is taken."}
      </p>
      {conflict.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">{conflict.reason === "outside" ? "Open times:" : "Open nearby:"}</span>
          {conflict.suggestions.map((time) => (
            <button
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-sm font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
              data-testid="new-patient-slot-chip"
              key={time}
              onClick={() => onPick(time)}
              type="button"
            >
              {to12hLabel(time)}
            </button>
          ))}
        </div>
      )}
      {conflict.canOverride ? (
        <label className="flex items-start gap-2 text-sm" data-testid="new-patient-book-anyway">
          <input
            checked={bookAnyway}
            className="mt-0.5 h-4 w-4"
            onChange={(event) => onBookAnyway(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block font-semibold">Book anyway at {to12hLabel(conflict.time)}</span>
            <span className="block text-xs text-[var(--text-muted)]">
              {conflict.reason === "outside" ? "Books it outside office hours." : "Double-books this time."} Then click Save.
            </span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">Overrides are turned off in Settings → Schedule, so pick an open time.</p>
      )}
    </div>
  );
}

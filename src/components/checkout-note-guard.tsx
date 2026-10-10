"use client";

/**
 * "This visit's note is still open" prompt for every status-only Check Out.
 *
 * Checking a patient out from the schedule, the edit dialog, the patient
 * page or the encounter page's Today list used to change only the
 * appointment, leaving the note open — the visit then looked finished
 * everywhere except reports. Now, when the visit has an open note, the user
 * picks: Close + Check Out (default), Check out only, or Cancel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { findOpenLinkedNote } from "@/lib/note-link";

export type OpenNoteCheckoutChoice = "close" | "checkout" | "cancel";

type Request = { dateLabel: string; typeLabel: string; resolve: (choice: OpenNoteCheckoutChoice) => void };

type GuardNote = {
  id: string;
  patientId: string;
  encounterDate: string;
  appointmentType: string;
  appointmentId?: string;
  signed: boolean;
};

type GuardAppointment = {
  id: string;
  patientId: string;
  date: string;
  appointmentType: string;
  status: string;
};

export function useCheckoutNoteGuard() {
  const [request, setRequest] = useState<Request | null>(null);
  const requestRef = useRef<Request | null>(null);

  const ask = useCallback(
    (dateLabel: string, typeLabel: string) =>
      new Promise<OpenNoteCheckoutChoice>((resolve) => {
        // A second prompt replaces an unanswered one; treat that as Cancel.
        requestRef.current?.resolve("cancel");
        const next = { dateLabel, typeLabel, resolve };
        requestRef.current = next;
        setRequest(next);
      }),
    [],
  );

  const answer = useCallback((choice: OpenNoteCheckoutChoice) => {
    requestRef.current?.resolve(choice);
    requestRef.current = null;
    setRequest(null);
  }, []);

  /**
   * Run a Check Out with the open-note check.
   * Returns "checked-out" | "closed-and-checked-out" | "canceled" | "close-failed".
   */
  const guardCheckout = useCallback(
    async (args: {
      appointment: GuardAppointment;
      notes: readonly GuardNote[];
      checkOut: () => void;
      closeNote: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
      onMessage?: (message: string) => void;
    }): Promise<"checked-out" | "closed-and-checked-out" | "canceled" | "close-failed"> => {
      const { appointment, notes, checkOut, closeNote, onMessage } = args;
      const openNote = appointment.status === "Check Out" ? null : findOpenLinkedNote(notes, appointment);
      if (!openNote) {
        checkOut();
        return "checked-out";
      }
      const choice = await ask(openNote.encounterDate, appointment.appointmentType);
      if (choice === "cancel") return "canceled";
      if (choice === "checkout") {
        checkOut();
        return "checked-out";
      }
      onMessage?.("Closing the note…");
      const result = await closeNote(openNote.id);
      if (!result.ok) {
        onMessage?.(
          `The note couldn't be confirmed as closed in the cloud, so the patient was NOT checked out. ${
            result.error ?? ""
          } Try again in a moment.`.trim(),
        );
        return "close-failed";
      }
      checkOut();
      onMessage?.("Note closed and patient checked out.");
      return "closed-and-checked-out";
    },
    [ask],
  );

  const dialog = request ? (
    <OpenNoteCheckoutDialog
      dateLabel={request.dateLabel}
      typeLabel={request.typeLabel}
      onChoose={answer}
    />
  ) : null;

  return { guardCheckout, checkoutNoteDialog: dialog };
}

function OpenNoteCheckoutDialog({
  dateLabel,
  typeLabel,
  onChoose,
}: {
  dateLabel: string;
  typeLabel: string;
  onChoose: (choice: OpenNoteCheckoutChoice) => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const onChooseRef = useRef(onChoose);
  useEffect(() => {
    onChooseRef.current = onChoose;
  });
  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onChooseRef.current("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      data-checkout-note-dialog
      onClick={(event) => {
        if (event.target === event.currentTarget) onChoose("cancel");
      }}
      role="dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-2xl">
        <p className="text-base font-semibold">This visit&apos;s note is still open. Close the note and check out?</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {dateLabel}
          {typeLabel ? ` · ${typeLabel}` : ""}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
            onClick={() => onChoose("cancel")}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
            onClick={() => onChoose("checkout")}
            type="button"
          >
            Check out only
          </button>
          <button
            className="rounded-lg border border-emerald-400 bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => onChoose("close")}
            ref={primaryRef}
            type="button"
          >
            Close + Check Out
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small "Note open" tag with a one-click Close (note only). */
export function NoteOpenTag({
  onClose,
  dateLabel,
  compact = false,
}: {
  onClose: () => void | Promise<void>;
  dateLabel: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${compact ? "" : "mt-1"}`} data-note-open-tag>
      <span
        className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
        title="This visit is Checked Out but its note isn't closed, so reports treat it as open."
      >
        Note open
      </span>
      <button
        className="whitespace-nowrap rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
        disabled={busy}
        onClick={async (event) => {
          event.stopPropagation();
          if (!window.confirm(`Close the note for ${dateLabel}? The appointment stays Checked Out.`)) return;
          setBusy(true);
          try {
            await onClose();
          } finally {
            setBusy(false);
          }
        }}
        type="button"
      >
        {busy ? "Closing…" : "Close note"}
      </button>
    </span>
  );
}

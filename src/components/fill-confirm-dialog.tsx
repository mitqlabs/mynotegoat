"use client";

/**
 * In-app confirm / notice, same look as the checkout-note dialog.
 * `ask(...)` resolves true for the primary button, false for Cancel,
 * Escape or a click outside. A notice (no cancelLabel) has one OK button.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SimpleConfirmRequest = {
  title: string;
  lines?: string[];
  confirmLabel?: string;
  /** Omit for a notice with a single button. */
  cancelLabel?: string;
};

type Pending = SimpleConfirmRequest & { resolve: (ok: boolean) => void };

export function useSimpleConfirm() {
  const [request, setRequest] = useState<Pending | null>(null);
  const requestRef = useRef<Pending | null>(null);

  const ask = useCallback(
    (next: SimpleConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        // A second prompt replaces an unanswered one; treat that as Cancel.
        requestRef.current?.resolve(false);
        const pending = { ...next, resolve };
        requestRef.current = pending;
        setRequest(pending);
      }),
    [],
  );

  const answer = useCallback((ok: boolean) => {
    requestRef.current?.resolve(ok);
    requestRef.current = null;
    setRequest(null);
  }, []);

  const dialog = request ? <SimpleConfirmDialog request={request} onAnswer={answer} /> : null;
  return { ask, confirmDialog: dialog };
}

function SimpleConfirmDialog({
  request,
  onAnswer,
}: {
  request: SimpleConfirmRequest;
  onAnswer: (ok: boolean) => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const onAnswerRef = useRef(onAnswer);
  useEffect(() => {
    onAnswerRef.current = onAnswer;
  });
  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAnswerRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isNotice = !request.cancelLabel;
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      data-simple-confirm-dialog
      onClick={(event) => {
        if (event.target === event.currentTarget) onAnswer(false);
      }}
      role={isNotice ? "alertdialog" : "dialog"}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-2xl">
        <p className="text-base font-semibold">{request.title}</p>
        {request.lines?.map((line, index) => (
          <p className="mt-1 break-words text-sm text-[var(--text-muted)]" key={index}>
            {line}
          </p>
        ))}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {!isNotice && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onAnswer(false)}
              type="button"
            >
              {request.cancelLabel}
            </button>
          )}
          <button
            className={
              isNotice
                ? "rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
                : "rounded-lg border border-emerald-400 bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white"
            }
            onClick={() => onAnswer(true)}
            ref={primaryRef}
            type="button"
          >
            {request.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import type { CardStatus } from "@/lib/reminder-format";

const PILL: Record<Exclude<CardStatus, "info">, { text: string; cls: string }> = {
  done: { text: "✓ Done", cls: "bg-emerald-100 text-emerald-800" },
  todo: { text: "To do", cls: "bg-amber-100 text-amber-900" },
  optional: { text: "Optional", cls: "bg-[var(--bg-soft)] text-[var(--text-muted)]" },
};

/**
 * One card in Settings → Text Reminders → Set up. Same look every time: a title,
 * a plain one-line summary (what you see when it is closed), an optional
 * Done / To do / Optional pill, and optional buttons on the right of the header.
 * Controlled: the caller keeps `open` in the cloud-backed settings.
 */
export function SetupCard({
  title,
  summary,
  status = "info",
  open,
  onToggle,
  actions,
  children,
  testId,
}: {
  title: string;
  summary: string;
  status?: CardStatus;
  open: boolean;
  onToggle: (next: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  const pill = status === "info" ? null : PILL[status];
  return (
    <section
      className="rounded-xl border border-[var(--line-soft)] bg-white"
      data-open={open ? "true" : "false"}
      data-status={status}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <button
          aria-controls={`${testId}-body`}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-left"
          data-testid={`${testId}-toggle`}
          onClick={() => onToggle(!open)}
          type="button"
        >
          <span aria-hidden className={`mt-0.5 inline-block w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{title}</span>
              {pill && <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${pill.cls}`} data-testid={`${testId}-status`}>{pill.text}</span>}
            </span>
            <span className="mt-0.5 block text-sm text-[var(--text-muted)]" data-testid={`${testId}-summary`}>{summary}</span>
          </span>
        </button>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {open && (
        <div className="space-y-3 border-t border-[var(--line-soft)] px-4 py-3 text-sm" data-testid={`${testId}-body`} id={`${testId}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A "More" / "Advanced" fold inside a card body. Plain details, same look everywhere. */
export function InnerFold({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)]/40 px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

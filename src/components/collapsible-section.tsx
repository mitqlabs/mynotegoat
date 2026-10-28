"use client";

import type { ReactNode } from "react";

/**
 * A titled section with a chevron header that opens and closes. Controlled:
 * the caller owns `open` so it can be remembered in the cloud-backed settings.
 * `card` = the big bordered section; `inline` = a light sub-heading.
 */
export function CollapsibleSection({
  title,
  hint,
  open,
  onToggle,
  children,
  testId,
  variant = "card",
  actions,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
  testId: string;
  variant?: "card" | "inline";
  /** Small controls on the right of the header (e.g. Refresh). Kept outside the toggle button. */
  actions?: ReactNode;
}) {
  const card = variant === "card";
  return (
    <section
      className={card ? "rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-soft)]/40" : ""}
      data-open={open ? "true" : "false"}
      data-testid={testId}
    >
      <div className={`flex items-center justify-between gap-2 ${card ? "px-4 py-3" : "py-1"}`}>
        <button
          aria-controls={`${testId}-body`}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid={`${testId}-toggle`}
          onClick={() => onToggle(!open)}
          type="button"
        >
          <span aria-hidden className={`inline-block w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="min-w-0">
            <span className={card ? "block text-base font-bold" : "block text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]"}>
              {title}
            </span>
            {hint && card && <span className="block text-sm font-normal text-[var(--text-muted)]">{hint}</span>}
          </span>
        </button>
        {actions}
      </div>
      {open && (
        <div className={card ? "space-y-5 border-t border-[var(--line-soft)] px-4 py-4" : "pt-1"} id={`${testId}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

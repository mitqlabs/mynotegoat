"use client";

import { useMemo, useState } from "react";
import type { ContactEmail } from "@/lib/mock-data";
import { emailOptionLabel, emailOptionsOf, mailtoHref } from "@/lib/contact-email";

/**
 * Attorney email picker + Copy, under the Attorney field. Reads the attorney's
 * emails from Contacts (starred first). The picked email is view-only (not saved).
 */
export function AttorneyEmailCopy({ contact }: { contact: { email?: string; emails?: ContactEmail[] } | null | undefined }) {
  const options = useMemo(() => emailOptionsOf(contact), [contact]);
  const [picked, setPicked] = useState(options[0]?.email ?? "");
  const [copied, setCopied] = useState(false);
  if (!contact || !options.length) {
    return (
      <span className="rounded-xl border border-[var(--line-soft)] bg-[rgba(242,247,252,0.65)] px-3 py-2 text-[var(--text-muted)]" data-testid="attorney-email-none">
        {contact ? "No email" : "—"}
      </span>
    );
  }
  const value = options.some((o) => o.email === picked) ? picked : options[0].email;
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="attorney-email">
      <select
        aria-label="Attorney email"
        className="min-w-0 flex-1 truncate rounded-xl border border-[var(--line-soft)] bg-white px-2 py-2"
        onChange={(event) => {
          setPicked(event.target.value);
          setCopied(false);
        }}
        title={value}
        value={value}
      >
        {options.map((o) => (
          <option key={o.email} value={o.email}>
            {o.main && options.length > 1 ? "★ " : ""}
            {emailOptionLabel(o)}
          </option>
        ))}
      </select>
      <a
        aria-label="Email this address"
        className="flex h-[42px] w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line-soft)] bg-white text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
        data-testid="attorney-email-mailto"
        href={mailtoHref(value)}
        title="Email (opens your mail app)"
      >
        <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <rect height="14" rx="2" width="18" x="3" y="5" />
          <path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <button
        aria-label={copied ? "Copied" : "Copy email"}
        className="flex h-[42px] w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line-soft)] bg-white text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
        data-testid="attorney-email-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
        title={copied ? "Copied" : "Copy email"}
        type="button"
      >
        {copied ? (
          <svg aria-hidden className="h-4 w-4 text-[#2f8a4c]" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <rect height="12" rx="2" width="12" x="9" y="9" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

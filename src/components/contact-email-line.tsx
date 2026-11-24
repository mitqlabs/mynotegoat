"use client";

import { useMemo, useState } from "react";
import type { ContactEmail } from "@/lib/mock-data";
import { emailOptionLabel, emailOptionsOf, mailtoHref } from "@/lib/contact-email";

type EmailContact = { name?: string; email?: string; emails?: ContactEmail[] };

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Finds the Contacts entry whose name matches a referral card's center/specialist. */
export function findEmailContact<T extends EmailContact>(contacts: T[], name: string): T | null {
  const key = norm(name || "");
  if (!key) return null;
  return contacts.find((contact) => norm(contact.name ?? "") === key) ?? null;
}

const iconClass =
  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]";

/**
 * Small, muted email line for referral cards (imaging centers, specialists).
 * Starred email first; a compact picker only when there are several.
 * Renders nothing when the contact has no email.
 */
export function ContactEmailLine({ contact }: { contact: EmailContact | null | undefined }) {
  const options = useMemo(() => emailOptionsOf(contact), [contact]);
  const [picked, setPicked] = useState(options[0]?.email ?? "");
  const [copied, setCopied] = useState(false);
  if (!contact || !options.length) return null;
  const value = options.some((o) => o.email === picked) ? picked : options[0].email;
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-[var(--text-muted)]" data-testid="referral-email">
      {options.length > 1 ? (
        <select
          aria-label="Email"
          className="min-w-0 max-w-[16rem] truncate rounded border border-[var(--line-soft)] bg-white px-1 py-0 text-xs text-[var(--text-muted)]"
          onChange={(event) => {
            setPicked(event.target.value);
            setCopied(false);
          }}
          title={value}
          value={value}
        >
          {options.map((o) => (
            <option key={o.email} value={o.email}>
              {o.main ? "★ " : ""}
              {emailOptionLabel(o)}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 truncate" title={value}>
          {value}
        </span>
      )}
      <a aria-label="Email this address" className={iconClass} href={mailtoHref(value)} title="Email (opens your mail app)">
        <svg aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <rect height="14" rx="2" width="18" x="3" y="5" />
          <path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <button
        aria-label={copied ? "Copied" : "Copy email"}
        className={iconClass}
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
          <svg aria-hidden className="h-3.5 w-3.5 text-[#2f8a4c]" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <rect height="12" rx="2" width="12" x="9" y="9" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

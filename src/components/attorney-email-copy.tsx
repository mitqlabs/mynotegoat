"use client";

import { useMemo, useState } from "react";
import type { ContactEmail } from "@/lib/mock-data";
import { emailOptionLabel, emailOptionsOf } from "@/lib/contact-email";

/**
 * Attorney email picker + Copy, under the Attorney field. Reads the attorney's
 * emails from Contacts (starred first). The picked email is view-only (not saved).
 */
export function AttorneyEmailCopy({ contact }: { contact: { email?: string; emails?: ContactEmail[] } | null | undefined }) {
  const options = useMemo(() => emailOptionsOf(contact), [contact]);
  const [picked, setPicked] = useState(options[0]?.email ?? "");
  const [copied, setCopied] = useState(false);
  if (!contact) return null;
  if (!options.length) {
    return <span className="text-sm text-[var(--text-muted)]" data-testid="attorney-email-none">No email</span>;
  }
  const value = options.some((o) => o.email === picked) ? picked : options[0].email;
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="attorney-email">
      <select
        aria-label="Attorney email"
        className="min-w-0 flex-1 truncate rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm"
        disabled={options.length === 1}
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
      <button
        className="shrink-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
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
        title="Copy this email"
        type="button"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

"use client";

import Link from "next/link";

/**
 * GOAT Mail opens from the first pill. The read-only Outlook triage
 * fills this page in; until that connection is configured it stays quiet.
 */
export default function GoatMailPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="panel-card p-5">
        <h1 className="text-xl font-semibold">GOAT Mail</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Read-only. GOAT never sends, deletes, or changes email.
        </p>
        <p className="mt-3 text-sm">
          Connect a Microsoft mailbox in Settings when the office app is registered. Until then, nothing is pulled in.
        </p>
        <Link className="mt-4 inline-block text-sm font-semibold text-[var(--brand-primary)] hover:underline" href="/goat">
          Back to G.O.A.T.
        </Link>
      </section>
    </div>
  );
}

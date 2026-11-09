"use client";

import Link from "next/link";
import type { CloseoutModel } from "@/lib/goat-closeout";

function Lines({ rows, empty }: { rows: Array<{ id: string; name: string; href: string; extra?: string }>; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">{empty}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => (
        <li key={row.id}>
          <Link className="font-medium hover:underline" href={row.href}>{row.name}</Link>
          {row.extra ? <span className="text-[var(--text-muted)]"> · {row.extra}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function GoatCloseout({ model }: { model: CloseoutModel }) {
  return (
    <section className="panel-card p-4" data-goat-page="closeout">
      <h2 className="text-sm font-semibold">End-of-day closeout</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Unsigned notes</h3>
          <Lines empty="All of today's notes are signed." rows={model.unsigned.map((row) => ({ ...row }))} />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Checked in, no note</h3>
          <Lines
            empty="Every checked-in visit has a note."
            rows={model.checkedInWithoutNote.map((row) => ({ ...row, extra: row.time }))}
          />
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tomorrow's openings</h3>
          {model.tomorrowClosed ? (
            <p className="text-sm text-[var(--text-muted)]">The office is closed tomorrow.</p>
          ) : model.openings.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Tomorrow is full.</p>
          ) : (
            <p className="text-sm">{model.openings.join(", ")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

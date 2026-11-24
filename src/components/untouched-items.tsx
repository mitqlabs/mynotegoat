"use client";

import Link from "next/link";
import type { UntouchedItem } from "@/lib/goat-untouched";

export function UntouchedItems({
  items,
  onHandled,
}: {
  items: UntouchedItem[];
  onHandled: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing untouched.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-[var(--line-soft)]">
      {items.map((item) => (
        <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={item.id}>
          <div className="min-w-0">
            <Link className="font-medium hover:underline" href={item.href}>
              {item.patientName}
            </Link>
            <p className="text-xs text-[var(--text-muted)]">
              {item.title}
              {item.detail ? ` — ${item.detail}` : ""}
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => onHandled(item.id)} type="button">
            Handled
          </button>
        </li>
      ))}
    </ul>
  );
}

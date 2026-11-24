"use client";

import type { HandoffBullet } from "@/lib/goat-handoff";
import { printGoatHandoff } from "@/lib/print-goat-handoff";

function Column({ items }: { items: HandoffBullet[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm">
      {items.map((item) => (
        <li key={item.text}>
          <span className="font-semibold">{item.text}</span>
          {item.children.length > 0 && (
            <ul className="mt-1 list-[circle] space-y-0.5 pl-5 font-normal">
              {item.children.map((child) => (
                <li key={child}>{child}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function GoatHandoff({
  title,
  left,
  right,
}: {
  title: string;
  left: HandoffBullet[];
  right: HandoffBullet[];
}) {
  return (
    <section className="goat-handoff panel-card p-4" data-goat-page="handoff">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button className="goat-handoff-actions btn btn-secondary btn-sm" onClick={(event) => printGoatHandoff(event.currentTarget.closest(".goat-handoff"))} type="button">
          Print
        </button>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Column items={left} />
        <Column items={right} />
      </div>
    </section>
  );
}

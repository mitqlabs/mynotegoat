"use client";

import type { ReactNode } from "react";
import type { GoatPageModel } from "@/lib/goat-page-model";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function GoatPageView({
  model,
  children,
}: {
  model: GoatPageModel;
  children: ReactNode;
}) {
  return (
    <div className="w-full space-y-4" data-goat-page-layout="full">
      <header className="flex items-center gap-3 rounded-2xl bg-[#7ec8d6] px-4 py-3 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className="h-11 w-11 rounded-full bg-white/80 object-cover" src="/goat-avatar/tablet-128.png" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-semibold leading-tight">
            GOAT Page
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[#b6f5c8]" /> On duty
            </span>
          </div>
          <p className="truncate text-xs text-white/90">Your front desk, at a glance</p>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--line-soft)] bg-white p-4">
        <p className="text-sm">
          <span className="font-semibold">{model.greeting}</span>
          {" — "}
          {model.dateLabel}. Here&apos;s everything for {model.officeName} today.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {plural(model.appointments, "appointment")}
          {" · "}
          {model.mailNeedingAction} mail item{model.mailNeedingAction === 1 ? " needs" : "s need"} action
          {" · "}
          {plural(model.intake.length, "new patient")} waiting on intake
          {" · "}
          {model.questions} question{model.questions === 1 ? "" : "s"} for you
        </p>
      </section>
      {children}
    </div>
  );
}

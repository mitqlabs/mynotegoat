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
      <header className="flex items-center gap-4 rounded-3xl bg-gradient-to-br from-[#ffe7a3] via-[#ffc48a] to-[#8fd4e2] px-5 py-5 text-[#3b2a16] shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className="h-16 w-16 shrink-0 rounded-full border-4 border-white object-cover shadow-md" src="/goat-avatar/tablet-128.png" />
        <div className="min-w-0">
          <p className="text-xl font-semibold leading-snug sm:text-2xl">
            {model.greeting}! {model.welcomeEmoji} Happy {model.dateLabel}
          </p>
          <p className="mt-1 text-base font-medium">{model.officeName}</p>
          <p className="mt-1 text-sm">
            {plural(model.appointments, "appointment")}
            {" · "}
            {model.mailNeedingAction} mail item{model.mailNeedingAction === 1 ? " needs" : "s need"} action
            {" · "}
            {plural(model.intake.length, "new patient")} waiting on intake
            {" · "}
            {model.questions} question{model.questions === 1 ? "" : "s"} for you
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}

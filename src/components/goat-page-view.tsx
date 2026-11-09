"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { chipsFor } from "@/lib/goat-briefs";
import type { GoatPageModel, GoatPageScheduleRow } from "@/lib/goat-page-model";

const TONE: Record<GoatPageScheduleRow["tone"], string> = {
  next: "bg-[#e7f6ee] text-[#1f7a45]",
  confirmed: "bg-[#e7f6ee] text-[#1f7a45]",
  in: "bg-[#e7f0ff] text-[#1d4ed8]",
  new: "bg-[#f3e8ff] text-[#7e22ce]",
  risk: "bg-[#fff1f0] text-[#c93b1d]",
  canceled: "bg-[#f3f4f6] text-[#6b7280]",
  done: "bg-[#eef2f6] text-[#475569]",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function GoatPageView({
  model,
  isAdmin,
  onMoveIntake,
  mail,
  questions,
  todos,
}: {
  model: GoatPageModel;
  isAdmin: boolean;
  onMoveIntake?: (patientId: string) => void;
  /** Later sections fill these. The shell keeps the slots. */
  mail?: ReactNode;
  questions?: ReactNode;
  todos?: ReactNode;
}) {
  const chips = chipsFor(isAdmin);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Link
              className="rounded-full border border-[var(--brand-primary)]/40 bg-[#eef8fb] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--brand-primary)] hover:text-white"
              href={chip === "GOAT Mail" ? "/goat-mail" : `/goat?q=${encodeURIComponent(chip)}`}
              key={chip}
            >
              {chip}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="panel-card p-4" data-goat-page="mail">
            <h2 className="text-sm font-semibold">GOAT Mail triage</h2>
            {mail ?? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                No mailbox connected. GOAT Mail stays empty until the office turns on the read-only connection.
              </p>
            )}
          </section>
          <section className="panel-card p-4" data-goat-page="schedule">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Today&apos;s schedule</h2>
              <span className="text-xs text-[var(--text-muted)]">{model.schedule.rows.length}</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                [model.schedule.confirmed, "Confirmed"],
                [model.schedule.checkedIn, "Checked in"],
                [model.schedule.noShow, "No-show"],
                [model.schedule.newPatients, "New patient"],
              ].map(([n, label]) => (
                <div className="rounded-xl bg-[var(--bg-soft)] px-1 py-2" key={String(label)}>
                  <div className="text-lg font-semibold tabular-nums">{n}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
                </div>
              ))}
            </div>
            <ul className="mt-3 divide-y divide-[var(--line-soft)]">
              {model.schedule.rows.map((row) => (
                <li className="flex items-center gap-3 py-2 text-sm" key={row.id}>
                  <span className="w-16 shrink-0 tabular-nums text-[var(--text-muted)]">{row.time}</span>
                  <Link className="min-w-0 flex-1 truncate font-medium hover:underline" href={row.href}>
                    {row.name}
                    <span className="ml-2 font-normal text-[var(--text-muted)]">{row.detail}</span>
                  </Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[row.tone]}`}>{row.badge}</span>
                </li>
              ))}
              {model.schedule.rows.length === 0 && (
                <li className="py-3 text-sm text-[var(--text-muted)]">Nothing on the schedule today.</li>
              )}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="panel-card p-4" data-goat-page="intake">
            <h2 className="text-sm font-semibold">New Patient Intake</h2>
            <ul className="mt-2 divide-y divide-[var(--line-soft)]">
              {model.intake.map((row) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={row.id}>
                  <Link className="font-medium hover:underline" href={row.href}>{row.name}</Link>
                  <span className="text-xs text-[var(--text-muted)]">{row.detail}</span>
                  {onMoveIntake && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onMoveIntake(row.id)} type="button">
                      Move Patient to Patient List
                    </button>
                  )}
                </li>
              ))}
              {model.intake.length === 0 && <li className="py-2 text-sm text-[var(--text-muted)]">No one waiting on intake.</li>}
            </ul>
          </section>
          <section className="panel-card p-4" data-goat-page="questions">
            <h2 className="text-sm font-semibold">GOAT needs your answer</h2>
            {questions ?? <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing to decide right now.</p>}
          </section>
          <section className="panel-card p-4" data-goat-page="todos">
            <h2 className="text-sm font-semibold">To-dos and alerts</h2>
            {todos ?? <p className="mt-2 text-sm text-[var(--text-muted)]">No untouched items yet.</p>}
          </section>
          <section className="panel-card p-4" data-goat-page="snapshot">
            <h2 className="text-sm font-semibold">Case snapshot</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                [model.snapshot.openCases, "Open cases"],
                [model.snapshot.awaitingRb, "Awaiting R&B"],
                [model.snapshot.missingLien, "Missing Lien/LOP"],
                [model.snapshot.inIntake, "In New Patient"],
              ].map(([n, label]) => (
                <div className="rounded-xl bg-[var(--bg-soft)] px-3 py-2" key={String(label)}>
                  <div className="text-xl font-semibold tabular-nums">{n}</div>
                  <div className="text-xs text-[var(--text-muted)]">{label}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

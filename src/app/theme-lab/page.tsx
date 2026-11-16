"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PRESET_IDS, type Mode, type PresetId } from "@/lib/brand";

/**
 * Sample screens for a theme, with no office data and no database writes.
 * Open /theme-lab?theme=sunset&tone=dark. The no-flash script locks the look.
 */

const THEME_NAMES: Record<PresetId, string> = {
  blue: "NoteGoat Blue",
  sunset: "Sunset",
  harbor: "Harbor",
  grove: "Grove",
  cedar: "Cedar",
};

function Lab() {
  const params = useSearchParams();
  const theme = (PRESET_IDS.includes(params.get("theme") as PresetId) ? params.get("theme") : "sunset") as PresetId;
  const tone: Mode = params.get("tone") === "dark" ? "dark" : "light";
  const href = (nextTone: Mode) => `/theme-lab?theme=${theme}&tone=${nextTone}`;

  return (
    <div className="min-h-screen bg-[var(--shell-bg)] text-[var(--text-main)]">
      <div className="grid min-h-screen lg:grid-cols-[250px_1fr]">
        <aside className="border-r border-[var(--line-soft)] bg-[var(--bg-sidebar)] p-6 text-[var(--sidebar-text)]">
          <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-center text-lg font-semibold">My Note Goat</div>
          <p className="mt-2 text-sm text-[var(--sidebar-muted)]">Secure office workspace</p>
          <nav className="mt-6 space-y-2">
            {["Dashboard", "Patients", "Schedule", "G.O.A.T. Page"].map((label, i) => (
              <div key={label} className={`rounded-xl px-4 py-3 text-sm font-semibold ${i === 0 ? "nav-link-active" : "nav-link"}`}>
                {label}
              </div>
            ))}
          </nav>
        </aside>
        <div>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] bg-[var(--header-bg)] px-7 py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">My Note Goat</div>
              <h1 className="text-2xl font-semibold">Theme Preview</h1>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link className={`rounded-full px-3 py-1 ${tone === "light" ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "bg-[var(--bg-soft)]"}`} href={href("light")}>
                Light
              </Link>
              <Link className={`rounded-full px-3 py-1 ${tone === "dark" ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "bg-[var(--bg-soft)]"}`} href={href("dark")}>
                Dark
              </Link>
            </div>
          </header>
          <main className="space-y-6 p-7">
            <p className="text-sm text-[var(--text-muted)]">
              {THEME_NAMES[theme]}, {tone === "light" ? "Light" : "Dark"}. Sample names only. Nothing here is saved.
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESET_IDS.map((id) => (
                <Link key={id} className="btn btn-secondary btn-sm" href={`/theme-lab?theme=${id}&tone=${tone}`}>
                  {THEME_NAMES[id]}
                </Link>
              ))}
            </div>

            <section className="panel-card p-4" aria-label="Dashboard">
              <h2 className="text-lg font-semibold">Dashboard</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Follow-ups due today</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <p className="text-xs text-[var(--text-muted)]">Patients</p>
                  <p className="text-2xl font-semibold text-[var(--brand-primary)]">24</p>
                </article>
                <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <p className="text-xs text-[var(--text-muted)]">Notes Open</p>
                  <p className="text-2xl font-semibold">6</p>
                </article>
                <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <p className="text-xs text-[var(--text-muted)]">Checked In</p>
                  <p className="text-2xl font-semibold">3</p>
                </article>
              </div>
            </section>

            <section className="panel-card p-4" aria-label="G.O.A.T. Page">
              <h2 className="text-lg font-semibold">G.O.A.T. Page</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">End of day, still open</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2">Sample, Alex — note not signed</li>
                <li className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2">Sample, Blair — MRI report to read</li>
              </ul>
            </section>

            <section className="panel-card p-4" aria-label="Patient page">
              <h2 className="text-lg font-semibold">Patient</h2>
              <p className="text-sm text-[var(--text-muted)]">Sample, Alex · Case 0000</p>
              <p className="mt-2 text-sm">
                <span className="font-semibold text-[var(--brand-primary)]">Initial exam</span>
                <span className="text-[var(--text-muted)]"> · Tuesday at 10:00</span>
              </p>
            </section>

            <section className="panel-card p-4" aria-label="SOAP">
              <h2 className="text-lg font-semibold">SOAP</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--brand-primary)]">Subjective</p>
                  <p className="mt-1 text-sm">Neck feels better today. Sample wording only.</p>
                </div>
                <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <p className="text-xs font-semibold text-[var(--brand-primary)]">Plan</p>
                  <p className="mt-1 text-sm">Continue the plan. Recheck next week.</p>
                </div>
              </div>
              <button type="button" className="btn btn-primary mt-3">
                Sign Note
              </button>
            </section>

            <section className="panel-card p-4" aria-label="Schedule">
              <h2 className="text-lg font-semibold">Schedule</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line-soft)]">
                <div className="grid grid-cols-[8rem_1fr_8rem] bg-[var(--bg-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  <span>Time</span>
                  <span>Patient</span>
                  <span>Status</span>
                </div>
                <div className="grid grid-cols-[8rem_1fr_8rem] border-t border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
                  <span>10:00</span>
                  <span>Sample, Alex</span>
                  <span className="font-semibold text-[var(--brand-primary)]">Checked In</span>
                </div>
                <div className="grid grid-cols-[8rem_1fr_8rem] border-t border-[var(--line-soft)] bg-white px-3 py-2 text-sm">
                  <span>10:30</span>
                  <span>Sample, Blair</span>
                  <span className="text-[var(--text-muted)]">Scheduled</span>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function ThemeLabPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[var(--text-muted)]">Loading preview…</div>}>
      <Lab />
    </Suspense>
  );
}

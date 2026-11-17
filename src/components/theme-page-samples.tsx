"use client";

import { useState, type ReactNode } from "react";
import { lookOf, type BrandSettings, type Mode } from "@/lib/brand";

/**
 * Static pictures of the real pages, painted with the theme being edited.
 * Fake names only. Nothing here reads or writes patients, files, or the database.
 */

const TABS = [
  { id: "patient", label: "Patient Page" },
  { id: "encounter", label: "Encounter" },
  { id: "cases", label: "Case List" },
  { id: "patients", label: "Patient List" },
  { id: "contacts", label: "Contacts" },
] as const;

type SampleId = (typeof TABS)[number]["id"];

function Bar({ children }: { children: ReactNode }) {
  return (
    <div className="section-bar flex items-center justify-between rounded-xl px-3 py-2 text-lg font-semibold">
      <span>{children}</span>
      <span className="text-xl leading-none">−</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <div className="theme-field min-h-[36px] rounded-lg border border-[var(--line-soft)] px-3 py-2 text-sm">{value}</div>
    </label>
  );
}

function PatientSample() {
  return (
    <div className="space-y-4">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Patients / Patient File</p>
            <h2 className="text-2xl font-semibold">Jane Sample</h2>
            <p className="text-sm text-[var(--text-muted)]">Female · DOB 04/12/1984 · (818) 555-0142</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill" style={{ backgroundColor: "rgba(31, 157, 96, 0.22)" }}>
              Active
            </span>
            <span className="status-pill" style={{ backgroundColor: "rgba(13, 121, 191, 0.2)" }}>
              Compliance: On Track
            </span>
            <span className="tone-warn rounded-lg border px-3 py-1.5 text-sm font-bold">⚠ ALLERGY: PENICILLIN</span>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-3">
        <article className="tint-panel rounded-2xl p-4">
          <Bar>X-Ray</Bar>
          <div className="mt-3 grid gap-3">
            <Field label="Sent Date" value="03/02/2026" />
            <Field label="Imaging Center" value="Diagnostic Imaging Network (Glendale)" />
            <div className="grid gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Regions</span>
              <div className="theme-field min-h-[36px] rounded-lg border border-[color-mix(in_srgb,var(--brand-primary)_40%,var(--line-soft))] px-2 py-1.5">
                <span className="tone-info inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold">Cervical</span>
              </div>
            </div>
          </div>
          <div className="theme-surface mt-3 space-y-2 rounded-xl border border-[var(--line-soft)] p-2 text-sm">
            <div className="theme-surface rounded-lg border border-[var(--line-soft)] p-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">X-Ray — Diagnostic Imaging Network (Glendale)</p>
                <span className="tone-warn-badge rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Patient Refused
                </span>
              </div>
              <p className="mt-1">Regions: Cervical</p>
              <p>Sent: 03/02/2026 | Completed: - | Received: - | Reviewed: -</p>
              <div className="mt-2 flex gap-2">
                <span className="btn btn-secondary btn-sm">Generate PDF</span>
                <span className="btn btn-secondary btn-sm">Edit</span>
                <span className="btn btn-secondary btn-sm">Remove</span>
              </div>
            </div>
          </div>
        </article>

        <article className="tint-panel rounded-2xl p-4">
          <Bar>MRI</Bar>
          <div className="mt-3 grid gap-3">
            <Field label="Sent Date" value="" />
            <Field label="Imaging Center" value="" />
            <div className="grid gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Regions</span>
              <div className="theme-field min-h-[36px] rounded-lg border border-[color-mix(in_srgb,var(--brand-primary)_40%,var(--line-soft))] px-2 py-1.5">
                <p className="text-xs text-[var(--text-muted)]">No regions selected</p>
              </div>
            </div>
          </div>
          <div className="theme-surface mt-3 rounded-xl border border-[var(--line-soft)] p-2 text-sm text-[var(--text-muted)]">
            No MRI / CT sent entries yet.
          </div>
        </article>

        <article className="tint-panel rounded-2xl p-4">
          <Bar>Specialist</Bar>
          <div className="mt-3 grid gap-3">
            <Field label="Specialist" value="Dr. Pat Example" />
            <Field label="Sent Date" value="03/11/2026" />
          </div>
          <div className="theme-surface mt-3 rounded-xl border border-[var(--line-soft)] p-2 text-sm">
            <div className="theme-surface rounded-lg border border-[var(--line-soft)] p-2">
              <p className="font-semibold">Dr. Pat Example — Orthopedics</p>
              <p className="mt-1">Sent: 03/11/2026 | Scheduled: 03/20/2026 | Completed: -</p>
              <div className="mt-2 flex gap-2">
                <span className="btn btn-secondary btn-sm">Generate PDF</span>
                <span className="btn btn-secondary btn-sm">Edit</span>
                <span className="btn btn-secondary btn-sm">Remove</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <section className="panel-card p-4">
          <Bar>Appointments / Encounters</Bar>
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line-soft)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--bg-soft)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[var(--line-soft)]">
                  <td className="px-3 py-2">03/04/2026</td>
                  <td className="px-3 py-2">New Patient</td>
                  <td className="px-3 py-2"><span className="tone-ok rounded-full px-2 py-0.5 text-xs font-semibold">Checked Out</span></td>
                </tr>
                <tr className="border-t border-[var(--line-soft)]">
                  <td className="px-3 py-2">03/18/2026</td>
                  <td className="px-3 py-2">Re-exam</td>
                  <td className="px-3 py-2"><span className="tone-info rounded-full px-2 py-0.5 text-xs font-semibold">Scheduled</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel-card p-4">
          <Bar>Patient Files</Bar>
          <ul className="mt-3 grid gap-2 text-sm">
            <li className="theme-surface flex items-center justify-between rounded-lg border border-[var(--line-soft)] px-3 py-2">
              <span>Cervical X-Ray Report.pdf</span>
              <span className="text-xs text-[var(--text-muted)]">03/02/2026</span>
            </li>
            <li className="theme-surface flex items-center justify-between rounded-lg border border-[var(--line-soft)] px-3 py-2">
              <span>Intake — Jane Sample.pdf</span>
              <span className="text-xs text-[var(--text-muted)]">02/28/2026</span>
            </li>
          </ul>
        </section>
      </section>
    </div>
  );
}

function EncounterSample() {
  const sections = ["Subjective", "Objective", "Assessment", "Plan"] as const;
  const bodies: Record<(typeof sections)[number], string> = {
    Subjective: "Neck pain after a sample collision on 02/14/2026. Worse turning left.",
    Objective: "Cervical ROM limited. Tenderness at C5–C6. Sample findings only.",
    Assessment: "Cervical strain. Sample diagnosis, not a real chart.",
    Plan: "Continue care twice a week. Recheck in two weeks.",
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="panel-card p-3">
        <p className="text-sm font-semibold">Jane Sample</p>
        <p className="text-xs text-[var(--text-muted)]">DOB 04/12/1984</p>
        <div className="mt-3 grid gap-2 text-sm">
          <div className="rounded-lg border border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,var(--bg-panel))] px-2 py-1.5">
            <p className="font-semibold">03/04/2026</p>
            <p className="text-xs text-[var(--text-muted)]">New Patient · Open</p>
          </div>
          <div className="theme-surface rounded-lg border border-[var(--line-soft)] px-2 py-1.5">
            <p className="font-semibold">02/20/2026</p>
            <p className="text-xs text-[var(--text-muted)]">Re-exam · Closed</p>
          </div>
        </div>
      </aside>
      <article className="panel-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Jane Sample</h2>
          <span className="text-sm text-[var(--text-muted)]">03/04/2026 @ 9:30 AM</span>
          <span className="tone-warn rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">Open</span>
          <span className="text-sm text-[var(--text-muted)]">Charges: 1 ($250.00)</span>
          <span className="text-link text-sm underline">Case File</span>
          <span className="tone-warn rounded-md border px-1.5 py-0.5 text-[10px] font-bold">⚠ ALLERGY: PENICILLIN</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sections.map((name, index) => (
            <span
              key={name}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                index === 0 ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "bg-[var(--bg-soft)] text-[var(--text-main)]"
              }`}
            >
              {name}
            </span>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sections.map((name) => (
            <div key={name} className="theme-surface overflow-hidden rounded-xl border border-[var(--line-soft)]">
              <div className="border-b border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                {name}
              </div>
              <p className="px-3 py-2 text-sm">{bodies[name]}</p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function ListTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="panel-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded-full bg-[var(--btn-bg,var(--brand-primary))] px-3 py-1 text-xs font-semibold text-[var(--on-brand)]">
          {title === "Case List" ? "Add Case" : "New Patient"}
        </span>
      </div>
      <div className="border-t border-[var(--line-soft)] px-4 py-3">
        <div className="theme-field max-w-sm rounded-xl border border-[var(--line-soft)] px-3 py-2 text-sm text-[var(--text-muted)]">
          Search patient or attorney...
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--bg-soft)] text-xs uppercase tracking-wide text-[var(--text)]">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                className="px-4 py-2 font-semibold"
                style={index === 1 ? { background: "color-mix(in srgb, var(--brand-primary) 18%, var(--bg-soft))" } : undefined}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-[var(--line-soft)]">
              {row.map((cell, index) => (
                <td
                  key={`${row[0]}-${index}`}
                  className="px-4 py-2"
                  style={index === 1 ? { background: "color-mix(in srgb, var(--brand-primary) 12%, transparent)" } : undefined}
                >
                  {index === 0 ? <span className="font-semibold text-[var(--text)]">{cell}</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ContactsSample() {
  return (
    <section className="panel-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <span className="rounded-full bg-[var(--btn-bg,var(--brand-primary))] px-3 py-1 text-xs font-semibold text-[var(--on-brand)]">Add Contact</span>
      </div>
      <article className="theme-surface grid gap-1 rounded-xl border border-[var(--line-soft)] p-3 text-sm">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-[var(--text)]">North Sample Firm</p>
          <span className="theme-badge rounded-full px-2 py-0.5 text-[10px] font-semibold">Attorney</span>
        </div>
        <p className="text-[var(--text-muted)]">(818) 555-0100</p>
        <p className="text-[var(--text-muted)]">100 Sample Ave, Glendale, CA</p>
        <a className="text-link underline" href="mailto:ada@example.test">ada@example.test</a>
      </article>
      <p className="callout mt-3 rounded-lg border px-3 py-2 text-sm">Required: confirm the main email before letters go out.</p>
    </section>
  );
}

function CaseListSample() {
  return (
    <ListTable
      title="Case List"
      headers={["Patient", "Exam", "Attorney", "Status"]}
      rows={[
        ["Jane Sample", "03/04/2026", "North Sample Firm", "Active"],
        ["Alex Sample", "02/18/2026", "Hart Sample LLP", "Discharged"],
        ["Riley Sample", "01/09/2026", "Self", "Submitted"],
      ]}
    />
  );
}

function PatientListSample() {
  return (
    <ListTable
      title="Patient List"
      headers={["Patient", "DOB", "Phone", "Cases"]}
      rows={[
        ["Jane Sample", "04/12/1984", "(818) 555-0142", "1"],
        ["Alex Sample", "11/02/1976", "(818) 555-0198", "2"],
        ["Riley Sample", "06/30/1991", "(818) 555-0164", "1"],
      ]}
    />
  );
}

const SAMPLES: Record<SampleId, () => ReactNode> = {
  patient: PatientSample,
  encounter: EncounterSample,
  cases: CaseListSample,
  patients: PatientListSample,
  contacts: ContactsSample,
};

/** One sample, using whatever theme is already on the page. Fake data only. */
export function ThemeSampleBody({ id }: { id: SampleId }) {
  const Sample = SAMPLES[id];
  return (
    <div className="min-w-[880px]">
      <Sample />
    </div>
  );
}

export function ThemePageSamples({
  brand,
  mode,
  initial = "patient",
}: {
  brand: BrandSettings;
  mode: Mode;
  initial?: SampleId;
}) {
  const look = lookOf(brand, mode);
  const [tab, setTab] = useState<SampleId>(initial);
  const Sample = SAMPLES[tab];
  return (
    <div
      data-brand={look.id}
      data-tone={look.dark ? "dark" : "light"}
      style={{ ...look.vars, background: "var(--shell-bg)", color: "var(--text-main)" }}
      className="overflow-hidden rounded-xl border border-[var(--line-soft)]"
    >
      <div role="tablist" aria-label="Theme samples" className="flex flex-wrap gap-1 border-b border-[var(--line-soft)] bg-[var(--bg-panel)] p-2">
        {TABS.map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                on ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "bg-[var(--bg-soft)] text-[var(--text-main)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="max-h-[720px] min-h-[520px] overflow-auto p-4">
        <div className="min-w-[880px]">
          <Sample />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { PatientsByLocationCard } from "@/components/patients-by-location-card";
import { useRememberedOpen } from "@/components/remembered-open";
import {
  DEMOGRAPHIC_SECTIONS,
  sectionsOpenedByLocationHash,
  summarizeAge,
  summarizeSex,
  type DemographicRow,
} from "@/lib/patient-demographics";
import type { LocationPatient } from "@/lib/patient-locations";

export type DemographicSource = LocationPatient & { sex?: string | null; dob?: string | null };

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
    >
      <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionToggle({
  title,
  open,
  onToggle,
  className,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button aria-expanded={open} className={`flex w-full items-center gap-2 text-left ${className}`} onClick={onToggle} type="button">
      <Chevron open={open} />
      <span>{title}</span>
    </button>
  );
}

function DemographicBars({ rows, heading }: { rows: DemographicRow[]; heading: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div>
      <div className="mb-2 text-sm text-[#57758b]">
        Total: <b className="text-[var(--text-main,#172a3a)]">{total} patient{total === 1 ? "" : "s"}</b>
      </div>
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr className="border-b border-[#d7e6f1] text-left text-xs uppercase tracking-wide text-[#57758b]">
            <th className="px-1.5 py-2">{heading}</th>
            <th />
            <th className="px-1.5 py-2 text-right">Patients</th>
            <th className="px-1.5 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const muted = row.key === "Not set" || row.key === "No DOB";
            return (
              <tr className="border-b border-[#eef3f8]" key={row.key}>
                <td className={`w-[230px] px-1.5 py-2.5 font-semibold ${muted ? "italic text-[#57758b]" : ""}`}>{row.label}</td>
                <td className="px-1.5 py-2.5">
                  <div className="h-3 rounded-md bg-[#eef6fb]">
                    <div
                      className={`h-3 rounded-md ${muted ? "bg-[#b7cad8]" : "bg-gradient-to-r from-[#0d79bf] to-[#1aa0a2]"}`}
                      style={{ width: `${(row.count / max) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="w-[60px] px-1.5 py-2.5 text-right font-bold tabular-nums">{row.count}</td>
                <td className="w-14 px-1.5 py-2.5 text-right tabular-nums text-[#57758b]">{row.percent}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Patient Demographics on Statistics. Location is the existing card.
 * Sex and age use that card's patient list (not the year / attorney /
 * status filters — the location card does not use them either).
 */
export function PatientDemographicsSection({ patients, statuses }: { patients: DemographicSource[]; statuses: string[] }) {
  const main = useRememberedOpen(DEMOGRAPHIC_SECTIONS.main);
  const location = useRememberedOpen(DEMOGRAPHIC_SECTIONS.location);
  const sex = useRememberedOpen(DEMOGRAPHIC_SECTIONS.sex);
  const age = useRememberedOpen(DEMOGRAPHIC_SECTIONS.age);
  const [scrollNonce, setScrollNonce] = useState(0);
  const revealMain = useRef(main.reveal);
  const revealLocation = useRef(location.reveal);
  useEffect(() => {
    revealMain.current = main.reveal;
    revealLocation.current = location.reveal;
  }, [main.reveal, location.reveal]);

  useEffect(() => {
    const onHash = () => {
      const openIds = sectionsOpenedByLocationHash(window.location.hash);
      if (!openIds.includes(DEMOGRAPHIC_SECTIONS.main) && !openIds.includes(DEMOGRAPHIC_SECTIONS.location)) return;
      if (openIds.includes(DEMOGRAPHIC_SECTIONS.main)) revealMain.current();
      if (openIds.includes(DEMOGRAPHIC_SECTIONS.location)) revealLocation.current();
      setScrollNonce((n) => n + 1);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (scrollNonce === 0) return;
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        document.getElementById("patients-by-location")?.scrollIntoView({ block: "start" });
      });
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [scrollNonce]);

  const sexSummary = summarizeSex(patients);
  const ageSummary = summarizeAge(patients);

  return (
    <section data-testid="patient-demographics">
      <article className="panel-card overflow-hidden">
        <div className={main.open ? "border-b border-[var(--line-soft)] p-4" : "p-4"}>
          <SectionToggle className="text-lg font-semibold" onToggle={main.toggle} open={main.open} title="Patient Demographics" />
        </div>
        {main.open && (
          <div className="space-y-4 p-4">
            <div>
              <SectionToggle className="text-base font-semibold" onToggle={location.toggle} open={location.open} title="Location" />
              {location.open && (
                <div className="mt-3">
                  <PatientsByLocationCard patients={patients} statuses={statuses} />
                </div>
              )}
            </div>
            <div className="border-t border-[var(--line-soft)] pt-4">
              <SectionToggle className="text-base font-semibold" onToggle={sex.toggle} open={sex.open} title="Male/Female" />
              {sex.open && (
                <div className="mt-3">
                  <DemographicBars heading="Sex" rows={sexSummary.rows} />
                </div>
              )}
            </div>
            <div className="border-t border-[var(--line-soft)] pt-4">
              <SectionToggle className="text-base font-semibold" onToggle={age.toggle} open={age.open} title="Age" />
              {age.open && (
                <div className="mt-3">
                  <DemographicBars heading="Age" rows={ageSummary.rows} />
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}

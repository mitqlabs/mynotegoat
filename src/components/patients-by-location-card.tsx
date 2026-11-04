"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { NO_ADDRESS_KEY, summarizeLocations, type LocationMode, type LocationPatient, type LocationRow } from "@/lib/patient-locations";

/** City / ZIP choice, per user and mirrored to the cloud (registered "user" key). */
export const LOCATION_MODE_KEY = "casemate.dashboard.location-mode.v1";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readMode(): LocationMode {
  try {
    return window.localStorage.getItem(LOCATION_MODE_KEY) === "zip" ? "zip" : "city";
  } catch {
    return "city";
  }
}

export function PatientsByLocationCard({ patients, statuses }: { patients: LocationPatient[]; statuses: string[] }) {
  const savedMode = useSyncExternalStore(subscribe, readMode, () => "city" as LocationMode);
  const [modeOverride, setModeOverride] = useState<LocationMode | null>(null);
  const mode = modeOverride ?? savedMode;
  const [status, setStatus] = useState("ALL");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const summary = useMemo(() => summarizeLocations(patients, mode, status), [patients, mode, status]);
  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const max = Math.max(1, ...summary.rows.map((r) => r.count), summary.noAddress?.count ?? 0);

  const setMode = (m: LocationMode) => {
    setModeOverride(m);
    setOpenKey(null);
    try {
      window.localStorage.setItem(LOCATION_MODE_KEY, m);
    } catch {
      // The cloud mirror picks it up from the storage write.
    }
  };

  const renderRow = (r: LocationRow, i: number | null) => {
    const open = openKey === r.key;
    const isNone = r.key === NO_ADDRESS_KEY;
    const people = open ? r.patientIds.map((id) => byId.get(id)).filter((p): p is LocationPatient => !!p).sort((a, b) => a.fullName.localeCompare(b.fullName)) : [];
    return [
      <tr
        className="cursor-pointer border-b border-[#eef3f8] hover:bg-[#f5fafd]"
        key={r.key}
        onClick={() => setOpenKey(open ? null : r.key)}
        title={isNone ? "List patients missing a city or ZIP" : `List patients in ${r.label}`}
      >
        <td className="w-7 px-1.5 py-2.5 text-[#9ab0c1]">{i === null ? "" : i + 1}</td>
        <td className={`w-[230px] px-1.5 py-2.5 font-semibold ${isNone ? "italic text-[#57758b]" : ""}`}>{r.label}</td>
        <td className="px-1.5 py-2.5">
          <div className="h-3 rounded-md bg-[#eef6fb]">
            <div className={`h-3 rounded-md ${isNone ? "bg-[#b7cad8]" : "bg-gradient-to-r from-[#0d79bf] to-[#1aa0a2]"}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </td>
        <td className="w-[60px] px-1.5 py-2.5 text-right font-bold">{r.count}</td>
        <td className="w-14 px-1.5 py-2.5 text-right text-[#57758b]">{r.percent}%</td>
      </tr>,
      open ? (
        <tr key={`${r.key}-list`}>
          <td />
          <td className="px-1.5 pb-3 pt-1" colSpan={4}>
            {isNone && <p className="mb-1 text-xs text-[#57758b]">Open a patient to add their address.</p>}
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {people.map((p) => (
                <li key={p.id}>
                  <Link className="text-[var(--brand-primary)] hover:underline" href={`/patients/${p.id}`}>
                    {p.fullName}
                  </Link>
                  <span className="ml-1 text-xs text-[#9ab0c1]">{p.caseStatus}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null,
    ];
  };

  const segBtn = (m: LocationMode, label: string) => (
    <button
      aria-pressed={mode === m}
      className={`rounded-lg px-[18px] py-1.5 text-sm font-semibold ${mode === m ? "bg-[#0d79bf] text-white" : "text-[#57758b]"}`}
      onClick={() => setMode(m)}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <section className="panel-card p-6" id="patients-by-location">
      <div className="flex flex-wrap items-center gap-3.5">
        <h4 className="flex-1 text-xl font-bold">Patients by Location</h4>
        <div className="flex rounded-[10px] bg-[#e4f0f7] p-[3px]">
          {segBtn("city", "City")}
          {segBtn("zip", "ZIP")}
        </div>
        <select
          aria-label="Case status"
          className="rounded-[10px] border border-[#c0d8ea] bg-white px-3 py-1.5 text-sm"
          onChange={(e) => {
            setStatus(e.target.value);
            setOpenKey(null);
          }}
          value={status}
        >
          <option value="ALL">All patients</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 mt-3.5 text-sm text-[#57758b]">
        Total: <b className="text-[var(--text-main,#172a3a)]">{summary.total} patient{summary.total === 1 ? "" : "s"}</b>
      </div>
      {summary.total === 0 ? (
        <p className="py-4 text-sm text-[#57758b]">No patients match this filter.</p>
      ) : (
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="border-b border-[#d7e6f1] text-left text-xs uppercase tracking-wide text-[#57758b]">
              <th className="px-1.5 py-2">#</th>
              <th className="px-1.5 py-2">{mode === "city" ? "City" : "ZIP code"}</th>
              <th />
              <th className="px-1.5 py-2 text-right">Patients</th>
              <th className="px-1.5 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.flatMap((r, i) => renderRow(r, i))}
            {summary.noAddress && renderRow(summary.noAddress, null)}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-[#9ab0c1]">Based on each patient&apos;s home address. Click a row to list those patients.</p>
    </section>
  );
}

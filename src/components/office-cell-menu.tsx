"use client";

import { useEffect, useRef, useState } from "react";
import { updatePatientRecordById } from "@/lib/mock-data";
import { forceSyncNow } from "@/lib/storage-sync-interceptor";
import { officeCellLabel, officeMenuChoices, officePatch } from "@/lib/office-assign";

type Loc = { id: string; name?: string; nickname?: string };

/**
 * Patients list office cell: the gray office pill, clickable to pick an office.
 * Saves right away through the normal patient save path (local record +
 * patients-table dual-write, then a forced sync) and shows Saving/Saved/Failed.
 */
export function OfficeCellMenu({
  patientId,
  locationId,
  locations,
  readOnly,
  onSaved,
}: {
  patientId: string;
  locationId: string | undefined;
  locations: ReadonlyArray<Loc>;
  readOnly?: boolean;
  onSaved?: (locationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const boxRef = useRef<HTMLSpanElement>(null);
  const label = officeCellLabel(locationId, locations);
  const assigned = locations.some((l) => l.id === locationId);

  // Document listeners only while THIS menu is open. Each Patients row has one
  // of these; listening for the component's whole life put one mousedown +
  // keydown listener per row on the document (hundreds on a multi-office list).
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const choose = async (id: string) => {
    setOpen(false);
    if ((locationId ?? "") === id) return;
    setState("saving");
    try {
      const saved = updatePatientRecordById(patientId, officePatch(id));
      if (!saved) throw new Error("patient not found");
      onSaved?.(id);
      await forceSyncNow();
      setState("saved");
    } catch (err) {
      console.error("[patients] office save failed:", err);
      setState("error");
    }
  };

  const pill = `ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
    assigned ? "bg-[var(--bg-soft)] text-[var(--text-main)]" : "bg-[var(--bg-soft)] text-[var(--text-muted)]"
  }`;

  if (readOnly) return <span className={pill}>{label}</span>;

  return (
    <span className="relative inline-block" ref={boxRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${pill} hover:ring-1 hover:ring-[var(--brand-primary)]`}
        onClick={() => setOpen((o) => !o)}
        title="Choose this patient's office"
        type="button"
      >
        {label} ▾
      </button>
      {state === "error" && (
        <span
          className="ml-1 text-[11px] font-semibold text-red-700"
          role="status"
        >
          Not saved
        </span>
      )}
      {open && (
        <span
          className="absolute left-2 top-full z-30 mt-1 grid w-max min-w-[12rem] rounded-xl border border-[var(--line-soft)] bg-white py-1 shadow-lg"
          role="menu"
        >
          {officeMenuChoices(locations).map((c) => (
            <button
              className={`whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-[rgba(13,121,191,0.06)] ${
                (locationId ?? "") === c.id || (!c.id && !assigned) ? "font-semibold text-[var(--brand-primary)]" : "text-[var(--text-main)]"
              }`}
              key={c.id || "none"}
              onClick={() => void choose(c.id)}
              role="menuitem"
              type="button"
            >
              {c.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

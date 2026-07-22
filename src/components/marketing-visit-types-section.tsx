"use client";

import { useEffect, useState } from "react";
import { useMarketingSettings } from "@/hooks/use-marketing-settings";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { DEFAULT_MARKETING_VISIT_TYPES } from "@/lib/marketing";
import { resolveCaseBucket, type MarketingCaseBucket } from "@/lib/marketing-settings";

/**
 * Settings → Admin → Marketing. For now, just the customizable "Type of
 * Visit" list used by the Marketing activity logger. Self-contained
 * (own open-state) so it drops into the Settings page without touching
 * that page's section-key machinery.
 */
const BUCKET_OPTIONS: { value: MarketingCaseBucket; label: string }[] = [
  { value: "active", label: "Active + Total" },
  { value: "total", label: "Total only" },
  { value: "none", label: "Don’t count" },
];

export function MarketingVisitTypesSection() {
  const { settings, setVisitTypes, setCaseBucket } = useMarketingSettings();
  const { caseStatuses } = useCaseStatuses();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const types = settings.visitTypes;

  const addType = () => {
    const value = draft.trim();
    if (!value) return;
    if (types.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setVisitTypes([...types, value]);
    setDraft("");
  };

  const removeType = (index: number) => {
    setVisitTypes(types.filter((_, i) => i !== index));
  };

  const renameType = (index: number, next: string) => {
    const value = next.trim();
    const current = types[index];
    if (!value || value === current) return;
    // Ignore if the new name collides with another existing type.
    if (types.some((t, i) => i !== index && t.toLowerCase() === value.toLowerCase())) return;
    setVisitTypes(types.map((t, i) => (i === index ? value : t)));
  };

  // Drag-and-drop reorder: move the dragged item to the drop position.
  const dropOnto = (targetIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === targetIndex) return;
    const next = [...types];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    setVisitTypes(next);
  };

  return (
    <section className="panel-card p-4">
      <button
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div>
          <h3 className="text-xl font-semibold">Marketing</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Customize the “Type of Contact” options used when logging marketing activity.
          </p>
        </div>
        <span
          aria-hidden
          className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div>
          <h4 className="text-sm font-semibold text-[var(--text-muted)]">Types of Contact</h4>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Drag the handle to reorder; edit a name to rename it (Tab or Enter to save). These
            are the options in the Marketing “Type of Contact” picker.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {types.map((type, index) => (
              <VisitTypeRow
                key={index}
                value={type}
                dragging={dragIndex === index}
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDropRow={() => dropOnto(index)}
                onRename={(next) => renameType(index, next)}
                onRemove={() => removeType(index)}
              />
            ))}
            {types.length === 0 && (
              <span className="text-sm text-[var(--text-muted)]">No types yet — add one below.</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="min-w-[200px] flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addType();
                }
              }}
              placeholder="e.g. Holiday Card, Sponsorship…"
              value={draft}
            />
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={addType}
              type="button"
            >
              Add Type
            </button>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-main)]"
              onClick={() => setVisitTypes([...DEFAULT_MARKETING_VISIT_TYPES])}
              type="button"
            >
              Reset to defaults
            </button>
          </div>
          </div>

          <div>
          <h4 className="text-sm font-semibold text-[var(--text-muted)]">
            Case Count
          </h4>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            For each case status, choose whether it counts toward a firm&apos;s{" "}
            <strong>Active</strong> and <strong>Total</strong> case figures on the Marketing page.
          </p>
          <div className="mt-2 divide-y divide-[var(--line-soft)] rounded-xl border border-[var(--line-soft)]">
            {caseStatuses.map((status) => {
              const bucket = resolveCaseBucket(status.name, settings, caseStatuses);
              return (
                <div key={status.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: status.color }}
                    />
                    {status.name}
                  </span>
                  <select
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                    onChange={(e) => setCaseBucket(status.name, e.target.value as MarketingCaseBucket)}
                    value={bucket}
                  >
                    {BUCKET_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          </div>
        </div>
      )}
    </section>
  );
}

function VisitTypeRow({
  value,
  dragging,
  onDragStart,
  onDragEnd,
  onDropRow,
  onRename,
  onRemove,
}: {
  value: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropRow: () => void;
  onRename: (next: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg ${dragging ? "opacity-50" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropRow();
      }}
    >
      <span
        aria-label="Drag to reorder"
        className="cursor-grab select-none px-1 text-base text-[var(--text-muted)] active:cursor-grabbing"
        draggable
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        title="Drag to reorder"
      >
        ⠿
      </span>
      <input
        className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm"
        onBlur={() => onRename(draft)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        value={draft}
      />
      <button
        className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
        onClick={() => {
          if (window.confirm(`Delete the “${value}” contact type?`)) onRemove();
        }}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}

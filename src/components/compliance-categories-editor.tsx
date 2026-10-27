"use client";

import { useState } from "react";
import { appConfirm } from "@/components/app-dialog";
import { useComplianceOptions } from "@/hooks/use-compliance-options";
import { complianceUsage, type ComplianceOption } from "@/lib/compliance";
import { patients } from "@/lib/mock-data";

function OptionRow({
  option,
  canEdit,
  onRename,
  onColor,
  onShow,
  onRemove,
}: {
  option: ComplianceOption;
  canEdit: boolean;
  onRename: (label: string) => void;
  onColor: (color: string) => void;
  onShow: (show: boolean) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(option.label);
  const [seen, setSeen] = useState(option.label);
  // Follow edits from another device/tab without clobbering typing in this row.
  if (seen !== option.label) {
    setSeen(option.label);
    setDraft(option.label);
  }
  const commit = () => {
    const next = draft.trim();
    if (!next) return setDraft(option.label);
    if (next !== option.label) onRename(next);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2">
      <div className="flex min-w-[200px] grow items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-3 w-3 shrink-0 rounded-full border border-[var(--line-soft)]"
          style={{ backgroundColor: option.color }}
        />
        <input
          aria-label={`Rename ${option.label}`}
          className="min-w-0 grow rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 font-semibold"
          disabled={!canEdit}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(option.label);
              event.currentTarget.blur();
            }
          }}
          value={draft}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm" title="Offer this option when picking a compliance value and in the Patients filter">
          <input checked={option.show} disabled={!canEdit} onChange={(event) => onShow(event.target.checked)} type="checkbox" />
          Show
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          Color
          <input
            className="h-8 w-10 rounded-md border border-[var(--line-soft)] bg-white p-1"
            disabled={!canEdit}
            onChange={(event) => onColor(event.target.value)}
            type="color"
            value={option.color}
          />
        </label>
        <button aria-label={`Remove ${option.label}`} className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={onRemove} type="button">
          Remove
        </button>
      </div>
    </div>
  );
}

/** Settings → Office → Case Status Categories → Compliance Categories. Same style as the status rows. */
export function ComplianceCategoriesEditor({ canEdit }: { canEdit: boolean }) {
  const { options, addOption, renameOption, setOptionColor, setOptionShown, removeOption, resetOptions } = useComplianceOptions();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5f75ff");

  const usage = () => complianceUsage(patients.map((p) => p.compliance), options);
  const add = () => {
    if (!name.trim()) return;
    addOption(name, color);
    setName("");
  };
  const inUseText = (count: number) => `${count} patient${count === 1 ? " has" : "s have"}`;

  return (
    <div className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
      <h4 className="text-lg font-semibold">Compliance Categories</h4>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        The choices (and pill colors) for the Compliance column and patient-file field. Renaming keeps every
        patient on that option. Turn the column on with the checkbox above.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <label className="min-w-[220px] grow space-y-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">New Compliance Option</span>
          <input
            className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="Example: Partially Compliant"
            value={name}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Color</span>
          <input
            className="h-10 w-12 rounded-md border border-[var(--line-soft)] bg-white p-1"
            disabled={!canEdit}
            onChange={(event) => setColor(event.target.value)}
            type="color"
            value={color}
          />
        </label>
        <button className="btn btn-primary" disabled={!canEdit || !name.trim()} onClick={add} type="button">
          Add Option
        </button>
        <button
          className="btn btn-secondary"
          disabled={!canEdit}
          onClick={async () => {
            if (await appConfirm("Reset Compliance Categories to the defaults (New Patient, Yes, No, DNS ATM, Non-Compliant)? Options you added are removed; patients keep their saved values.")) resetOptions();
          }}
          type="button"
        >
          Reset Compliance Defaults
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {options.map((option) => (
          <OptionRow
            canEdit={canEdit}
            key={option.id}
            onColor={(c) => setOptionColor(option.id, c)}
            onRemove={async () => {
              const count = usage().get(option.id) ?? 0;
              const message = count
                ? `${inUseText(count)} "${option.label}" saved. If you remove it, they will show as Not set. Remove "${option.label}" anyway?`
                : `Remove compliance option "${option.label}"?`;
              if (await appConfirm(message)) removeOption(option.id);
            }}
            onRename={(label) => renameOption(option.id, label)}
            onShow={(show) => setOptionShown(option.id, show)}
            option={option}
          />
        ))}
        {options.length === 0 && <p className="text-sm text-[var(--text-muted)]">No compliance options. Add one above.</p>}
      </div>
    </div>
  );
}

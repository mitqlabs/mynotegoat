"use client";

import type { ReactNode } from "react";
import {
  ROW_FIELDS,
  clampMaxH,
  defaultTypePriority,
  groupsFor,
  itemShown,
  moveId,
  orderedIds,
  rowFields,
  showsAppointments,
  typeOrder,
  type BoardBox,
  type RowField,
  type SnapshotPeriod,
} from "@/lib/goat-board";

function Check({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

function OrderRow({
  label,
  first,
  last,
  onUp,
  onDown,
  control,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  control?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-1">
      {control}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <button aria-label={`Move ${label} up`} className="px-1 text-xs text-[var(--text-muted)] disabled:opacity-30" disabled={first} onClick={onUp} type="button">
        Up
      </button>
      <button aria-label={`Move ${label} down`} className="px-1 text-xs text-[var(--text-muted)] disabled:opacity-30" disabled={last} onClick={onDown} type="button">
        Down
      </button>
    </li>
  );
}

export function BoxOptions({
  box,
  statusNames,
  appointmentTypes,
  todayYear,
  onChange,
}: {
  box: BoardBox;
  statusNames: string[];
  appointmentTypes: string[];
  todayYear: number;
  onChange: (next: BoardBox) => void;
}) {
  const groups = groupsFor(box.kind, statusNames);
  const groupOrder = orderedIds(groups.map((item) => item.id), box.itemOrder);
  const types = typeOrder(appointmentTypes, box.typePriority ?? defaultTypePriority(appointmentTypes));
  const fields = rowFields(box);
  const years = Array.from({ length: 8 }, (_, index) => todayYear - index).filter((year) => year !== todayYear && year !== todayYear - 1);

  const setHidden = (id: string, shown: boolean) => {
    const hidden = new Set(box.hiddenItems ?? []);
    if (shown) hidden.delete(id);
    else hidden.add(id);
    onChange({ ...box, hiddenItems: [...hidden] });
  };

  return (
    <div className="space-y-3 text-left">
      <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
        Title
        <input
          className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm font-normal text-[var(--text)]"
          onChange={(event) => onChange({ ...box, title: event.target.value })}
          value={box.title ?? ""}
          placeholder="Leave blank for the standard name"
        />
      </label>
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-primary)]">More options</summary>
        <div className="mt-2 space-y-3">
          {groups.length > 0 && (
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">What it shows</legend>
              <ul className="mt-1 space-y-0.5">
                {groupOrder.map((id, index) => {
                  const item = groups.find((row) => row.id === id);
                  if (!item) return null;
                  return (
                    <OrderRow
                      control={<input checked={itemShown(box.hiddenItems, id)} onChange={(event) => setHidden(id, event.target.checked)} type="checkbox" />}
                      first={index === 0}
                      key={id}
                      label={item.label}
                      last={index === groupOrder.length - 1}
                      onDown={() => onChange({ ...box, itemOrder: moveId(groupOrder, id, 1) })}
                      onUp={() => onChange({ ...box, itemOrder: moveId(groupOrder, id, -1) })}
                    />
                  );
                })}
              </ul>
            </fieldset>
          )}
          {showsAppointments(box.kind) && appointmentTypes.length > 0 && (
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Appointment types</legend>
              <p className="text-[11px] text-[var(--text-muted)]">Checked types show. Priority types sit at the top.</p>
              <ul className="mt-1 space-y-0.5">
                {types.map((name, index) => {
                  const hidden = (box.hiddenTypes ?? []).some((row) => row.toLowerCase() === name.toLowerCase());
                  return (
                    <OrderRow
                      control={
                        <input
                          checked={!hidden}
                          onChange={(event) => {
                            const names = new Set((box.hiddenTypes ?? []).map((row) => row.toLowerCase()));
                            if (event.target.checked) names.delete(name.toLowerCase());
                            else names.add(name.toLowerCase());
                            onChange({
                              ...box,
                              hiddenTypes: appointmentTypes.filter((row) => names.has(row.toLowerCase())),
                              typePriority: types,
                            });
                          }}
                          type="checkbox"
                        />
                      }
                      first={index === 0}
                      key={name}
                      label={name}
                      last={index === types.length - 1}
                      onDown={() => onChange({ ...box, typePriority: moveId(types, name, 1) })}
                      onUp={() => onChange({ ...box, typePriority: moveId(types, name, -1) })}
                    />
                  );
                })}
              </ul>
            </fieldset>
          )}
          {showsAppointments(box.kind) && (
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Row fields</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {ROW_FIELDS.map((field) => (
                  <Check
                    checked={fields.includes(field.id)}
                    key={field.id}
                    label={field.label}
                    onChange={(shown) => {
                      const next = new Set(fields);
                      if (shown) next.add(field.id);
                      else next.delete(field.id);
                      const picked = ROW_FIELDS.map((row) => row.id).filter((id) => next.has(id));
                      onChange({ ...box, fields: picked.length ? picked : (["name"] as RowField[]) });
                    }}
                  />
                ))}
              </div>
            </fieldset>
          )}
          {box.kind === "case-snapshot" && (
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
              Default period
              <select
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-normal"
                onChange={(event) => onChange({ ...box, period: event.target.value as SnapshotPeriod })}
                value={box.period ?? "this-year"}
              >
                <option value="this-year">This Year</option>
                <option value="last-year">Last Year</option>
                {years.map((year) => (
                  <option key={year} value={`year:${year}`}>{year}</option>
                ))}
                <option value="all">All Time</option>
              </select>
            </label>
          )}
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Max height
            <input
              className="w-24 rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm font-normal"
              max={20}
              min={4}
              onChange={(event) => onChange({ ...box, maxH: clampMaxH(Number(event.target.value)) })}
              type="number"
              value={clampMaxH(box.maxH)}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

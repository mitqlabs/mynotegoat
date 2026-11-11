"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { BoxOptions } from "@/components/goat-box-options";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import {
  BOX_TITLES,
  boardSnapshot,
  boxesFromSnapshot,
  boxTitle,
  defaultBoard,
  moveId,
  newBuiltinBox,
  resetBoard,
  saveBoard,
  saveOfficeDefault,
  subscribeBoard,
  type BoardBox,
  type BuiltinKind,
} from "@/lib/goat-board";

const STARTERS: Array<Exclude<BuiltinKind, "status-cases">> = [
  "goat-mail",
  "morning-rundown",
  "appointment-check",
  "quick-biz",
  "case-review",
  "schedule",
  "tomorrow-schedule",
  "intake",
  "goat-answers",
  "todos",
  "case-snapshot",
  "end-of-day",
  "cases-by-month",
  "imaging-referrals",
  "specialist-referrals",
];

function flow(boxes: BoardBox[]): BoardBox[] {
  const cols = 12;
  let x = 0;
  let y = 0;
  let rowH = 0;
  return boxes.map((box) => {
    const w = Math.min(12, Math.max(2, box.w));
    if (x + w > cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    const next = { ...box, x, y, w };
    x += w;
    rowH = Math.max(rowH, box.h);
    return next;
  });
}

export function GoatPageSettings({ canSetOfficeDefault }: { canSetOfficeDefault: boolean }) {
  const { caseStatuses } = useCaseStatuses();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const statusNames = caseStatuses.map((status) => status.name);
  const typeNames = appointmentTypes.map((row) => row.name);
  const todayYear = new Date().getFullYear();
  const snapshot = useSyncExternalStore(subscribeBoard, boardSnapshot, () => "");
  const boxes = useMemo(() => boxesFromSnapshot(snapshot), [snapshot]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const commit = (next: BoardBox[]) => {
    saveBoard(next);
    setNotice("");
  };

  const toggleStarter = (kind: Exclude<BuiltinKind, "status-cases">, on: boolean) => {
    if (on) {
      if (boxes.some((box) => box.kind === kind)) return;
      const created = newBuiltinBox(kind, boxes);
      if (created) commit([...boxes, created]);
      return;
    }
    commit(boxes.filter((box) => box.kind !== kind));
  };

  return (
    <div className="space-y-4" data-goat-page-settings>
      <p className="text-sm text-[var(--text-muted)]">
        Your board is saved to your account. Drag boxes on the GOAT Page to move them. The gear on a box renames it and hides the extra options.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            resetBoard();
            setNotice("Reset to the office default, or the standard board when the office has not set one.");
          }}
          type="button"
        >
          Reset to default
        </button>
        {canSetOfficeDefault && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              saveOfficeDefault(boxes);
              setNotice("Saved as the office default. People who have not arranged their own board start here.");
            }}
            type="button"
          >
            Save as office default
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => commit(defaultBoard())} type="button">
          Standard boxes
        </button>
      </div>
      {notice && <p className="text-sm">{notice}</p>}
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Boxes on the board</legend>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {STARTERS.map((kind) => (
            <li key={kind}>
              <label className="flex items-center gap-2 text-sm">
                <input checked={boxes.some((box) => box.kind === kind)} onChange={(event) => toggleStarter(kind, event.target.checked)} type="checkbox" />
                {BOX_TITLES[kind]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <ol className="space-y-2">
        {boxes.map((box, index) => (
          <li className="rounded-xl border border-[var(--line-soft)] p-3" key={box.i}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{boxTitle(box)}</span>
              <button
                className="text-xs font-semibold text-[var(--text-muted)] disabled:opacity-30"
                disabled={index === 0}
                onClick={() => commit(flow(moveId(boxes.map((row) => row.i), box.i, -1).map((id) => boxes.find((row) => row.i === id)!)))}
                type="button"
              >
                Up
              </button>
              <button
                className="text-xs font-semibold text-[var(--text-muted)] disabled:opacity-30"
                disabled={index === boxes.length - 1}
                onClick={() => commit(flow(moveId(boxes.map((row) => row.i), box.i, 1).map((id) => boxes.find((row) => row.i === id)!)))}
                type="button"
              >
                Down
              </button>
              <button className="text-xs font-semibold text-[var(--brand-primary)]" onClick={() => setOpenId(openId === box.i ? null : box.i)} type="button">
                {openId === box.i ? "Done" : "Options"}
              </button>
            </div>
            {openId === box.i && (
              <div className="mt-3">
                <BoxOptions
                  appointmentTypes={typeNames}
                  box={box}
                  onChange={(next) => commit(boxes.map((row) => (row.i === box.i ? next : row)))}
                  statusNames={statusNames}
                  todayYear={todayYear}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

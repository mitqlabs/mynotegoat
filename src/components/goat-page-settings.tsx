"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { appConfirm } from "@/components/app-dialog";
import { BoxOptions } from "@/components/goat-box-options";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import {
  BOX_TITLES,
  boardSnapshot,
  boxesFromSnapshot,
  boxTitle,
  clampMaxH,
  moveId,
  newBuiltinBox,
  newStatusBox,
  resetBoard,
  saveBoard,
  saveOfficeDefault,
  subscribeBoard,
  type BoardBox,
  type BuiltinKind,
} from "@/lib/goat-board";

const BOARD_BOXES: Array<Exclude<BuiltinKind, "status-cases" | "cases-by-month" | "imaging-referrals" | "specialist-referrals">> = [
  "goat-mail",
  "appointment-check",
  "quick-biz",
  "case-review",
  "schedule",
  "tomorrow-schedule",
  "intake",
  "todos",
  "case-snapshot",
  "end-of-day",
];

const REFERRAL_BOXES = ["cases-by-month", "imaging-referrals", "specialist-referrals"] as const;

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

export function GoatPageSettings({
  canSetOfficeDefault,
  arranging = false,
  onArrange,
}: {
  canSetOfficeDefault: boolean;
  arranging?: boolean;
  onArrange?: (next: boolean) => void;
}) {
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

  const toggleStatus = (statusName: string, on: boolean) => {
    if (on) {
      if (boxes.some((box) => box.kind === "status-cases" && box.statusName?.toLowerCase() === statusName.toLowerCase())) return;
      commit([...boxes, newStatusBox(statusName, undefined, boxes)]);
      return;
    }
    commit(boxes.filter((box) => !(box.kind === "status-cases" && box.statusName?.toLowerCase() === statusName.toLowerCase())));
  };

  return (
    <div className="space-y-4" data-goat-page-settings>
      <p className="text-sm text-[var(--text-muted)]">
        Taps and scrolling leave the boxes where they are. Move or resize them here, or turn on Arrange boxes.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void (async () => {
              const ok = await appConfirm("Reset the board to the default layout? Box order and sizes go back to the office default, or the standard board when the office has not set one.");
              if (!ok) return;
              resetBoard();
              setNotice("Layout reset.");
            })();
          }}
          type="button"
        >
          Reset Layout
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
        {onArrange && (
          <button className="btn btn-secondary btn-sm" onClick={() => onArrange(!arranging)} type="button">
            {arranging ? "Done arranging" : "Arrange boxes"}
          </button>
        )}
      </div>
      {notice && <p className="text-sm">{notice}</p>}

      <fieldset data-goat-settings-section="boxes">
        <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Boxes On Board</legend>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {BOARD_BOXES.map((kind) => (
            <li key={kind}>
              <label className="flex items-center gap-2 text-sm">
                <input checked={boxes.some((box) => box.kind === kind)} onChange={(event) => toggleStarter(kind, event.target.checked)} type="checkbox" />
                {BOX_TITLES[kind]}
              </label>
            </li>
          ))}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-primary)]">Rename, order, and what each box shows</summary>
          <ol className="mt-2 space-y-2">
            {boxes.map((box, index) => (
              <li className="rounded-xl border border-[var(--line-soft)] p-3" key={box.i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{boxTitle(box)}</span>
                  <button className="text-xs font-semibold text-[var(--text-muted)] disabled:opacity-30" disabled={index === 0} onClick={() => commit(flow(moveId(boxes.map((row) => row.i), box.i, -1).map((id) => boxes.find((row) => row.i === id)!)))} type="button">Up</button>
                  <button className="text-xs font-semibold text-[var(--text-muted)] disabled:opacity-30" disabled={index === boxes.length - 1} onClick={() => commit(flow(moveId(boxes.map((row) => row.i), box.i, 1).map((id) => boxes.find((row) => row.i === id)!)))} type="button">Down</button>
                  <button className="text-xs font-semibold text-[var(--text-muted)]" onClick={() => commit(boxes.map((row) => (row.i === box.i ? { ...row, w: Math.max(2, row.w - 1) } : row)))} type="button">Narrower</button>
                  <button className="text-xs font-semibold text-[var(--text-muted)]" onClick={() => commit(boxes.map((row) => (row.i === box.i ? { ...row, w: Math.min(12, row.w + 1) } : row)))} type="button">Wider</button>
                  <button className="text-xs font-semibold text-[var(--text-muted)]" onClick={() => commit(boxes.map((row) => (row.i === box.i ? { ...row, h: Math.max(4, row.h - 1) } : row)))} type="button">Shorter</button>
                  <button className="text-xs font-semibold text-[var(--text-muted)]" onClick={() => commit(boxes.map((row) => (row.i === box.i ? { ...row, h: Math.min(clampMaxH(row.maxH), row.h + 1) } : row)))} type="button">Taller</button>
                  <button className="text-xs font-semibold text-[var(--brand-primary)]" onClick={() => setOpenId(openId === box.i ? null : box.i)} type="button">{openId === box.i ? "Done" : "Options"}</button>
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
        </details>
      </fieldset>

      <fieldset data-goat-settings-section="status">
        <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Box By Status</legend>
        <p className="mt-1 text-xs text-[var(--text-muted)]">This office&apos;s case statuses. Each one is its own box of cases.</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {caseStatuses.map((status) => (
            <li key={status.name}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={boxes.some((box) => box.kind === "status-cases" && box.statusName?.toLowerCase() === status.name.toLowerCase())}
                  onChange={(event) => toggleStatus(status.name, event.target.checked)}
                  type="checkbox"
                />
                {status.name}
              </label>
            </li>
          ))}
          {caseStatuses.length === 0 && <li className="text-sm text-[var(--text-muted)]">No case statuses are set up yet.</li>}
        </ul>
      </fieldset>

      <fieldset data-goat-settings-section="referrals">
        <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Box By Referrals</legend>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {REFERRAL_BOXES.map((kind) => (
            <li key={kind}>
              <label className="flex items-center gap-2 text-sm">
                <input checked={boxes.some((box) => box.kind === kind)} onChange={(event) => toggleStarter(kind, event.target.checked)} type="checkbox" />
                {BOX_TITLES[kind]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

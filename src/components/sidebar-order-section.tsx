"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { savePersonPref, type SaveResult } from "@/lib/cloud/brand-save";
import { useSidebarOrder } from "@/hooks/use-sidebar-order";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import {
  SETTINGS_ID,
  SIDEBAR_ORDER_KEY,
  applySidebarOrder,
  moveSidebarId,
  reorderSidebarId,
  sameSidebarOrder,
  sidebarOrderValue,
  visibleSidebarPages,
} from "@/lib/sidebar-order";

type Status = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "failed"; reason: string };

const DRAG_SLOP_PX = 4;

function rowIdAt(list: HTMLElement | null, clientY: number): string | null {
  if (!list) return null;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-sidebar-id]")];
  if (rows.length === 0) return null;
  const first = rows[0].getBoundingClientRect();
  const last = rows[rows.length - 1].getBoundingClientRect();
  if (clientY <= first.top) return rows[0].dataset.sidebarId ?? null;
  if (clientY >= last.bottom) return rows[rows.length - 1].dataset.sidebarId ?? null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return row.dataset.sidebarId ?? null;
  }
  return null;
}

/**
 * Settings → Sidebar. Each person arranges their own pages. Settings stays
 * last. Saved appears only after the cloud row is read back.
 */
export function SidebarOrderSection() {
  const { canView } = useWorkspaceAccess();
  const saved = useSidebarOrder();
  const pages = useMemo(() => visibleSidebarPages("complete", canView), [canView]);
  const base = useMemo(
    () => applySidebarOrder(pages, saved).filter((page) => page.id !== SETTINGS_ID).map((page) => page.id),
    [pages, saved],
  );
  const [override, setOverride] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  if (override && sameSidebarOrder(override, base)) setOverride(null);
  const draft = override ?? base;
  useEffect(() => () => stopDrag.current?.(), []);
  const labels = new Map(pages.map((page) => [page.id, page.label]));
  const settings = pages.find((page) => page.id === SETTINGS_ID);
  const dirty = !sameSidebarOrder(draft, base);

  const run = async (ids: string[]) => {
    setStatus({ state: "saving" });
    const result: SaveResult = await savePersonPref(SIDEBAR_ORDER_KEY, sidebarOrderValue(ids));
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  const save = () => {
    setOverride(draft);
    void run(draft);
  };

  const reset = () => {
    const next = applySidebarOrder(pages, null).filter((page) => page.id !== SETTINGS_ID).map((page) => page.id);
    setOverride(next);
    void run(next);
  };

  // Pointer events, not HTML5 drag. Safari on Mac does not drag an <li draggable>
  // that contains buttons, so the drop never fires.
  const onPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("button")) return;
    const id = target.closest<HTMLElement>("[data-sidebar-id]")?.dataset.sidebarId;
    if (!id) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    let active = false;
    let over: string | null = null;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.abs(ev.clientY - startY) < DRAG_SLOP_PX) return;
        active = true;
        setDragId(id);
      }
      const hit = rowIdAt(listRef.current, ev.clientY);
      const next = hit && hit !== id ? hit : null;
      if (next === over) return;
      over = next;
      setOverId(next);
    };

    const end = (ev: PointerEvent, commit: boolean) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      const hit = rowIdAt(listRef.current, ev.clientY);
      setDragId(null);
      setOverId(null);
      if (commit && active && hit && hit !== id) {
        setOverride(reorderSidebarId(draft, id, hit));
        setStatus({ state: "idle" });
      }
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stopDrag.current = null;
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    stopDrag.current?.();
    stopDrag.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const fromIndex = dragId ? draft.indexOf(dragId) : -1;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {status.state === "saving" && <span className="text-sm text-[var(--text-muted)]">Saving…</span>}
        {status.state === "saved" && <span className="text-sm font-semibold text-[var(--status-active,#186843)]">Saved</span>}
        {status.state === "failed" && (
          <>
            <span className="text-sm text-[var(--status-alert,#8f251f)]">Not saved. {status.reason}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run(draft)}>
              Retry
            </button>
          </>
        )}
        <button type="button" className="btn btn-secondary" onClick={reset} disabled={status.state === "saving"}>
          Reset to Default
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || status.state === "saving"}>
          {status.state === "saving" ? "Saving…" : "Save Order"}
        </button>
      </div>
      <ul
        className={`divide-y divide-[var(--line-soft)] touch-none ${dragId ? "cursor-grabbing select-none [&_button]:pointer-events-none" : ""}`}
        onPointerDown={onPointerDown}
        ref={listRef}
      >
        {draft.map((id, index) => {
          const label = labels.get(id) ?? id;
          const placeAfter = overId === id && fromIndex > -1 && fromIndex < index;
          const showDrop = overId === id && dragId !== id;
          return (
            <li
              key={id}
              data-sidebar-id={id}
              className={`relative flex items-center gap-2 py-2 ${dragId === id ? "opacity-50" : ""} ${showDrop ? "bg-[var(--bg-soft)]" : ""}`}
            >
              {showDrop && (
                <span
                  aria-hidden
                  data-drop-indicator={placeAfter ? "after" : "before"}
                  className={`pointer-events-none absolute inset-x-0 z-10 h-1 bg-[var(--brand-primary)] ${placeAfter ? "bottom-0" : "top-0"}`}
                />
              )}
              <span aria-hidden className="cursor-grab px-1 text-[var(--text-muted)] select-none">
                ⋮⋮
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label={`Move ${label} Up`}
                disabled={index === 0}
                onClick={() => {
                  setOverride(moveSidebarId(draft, id, -1));
                  setStatus({ state: "idle" });
                }}
              >
                Up
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label={`Move ${label} Down`}
                disabled={index === draft.length - 1}
                onClick={() => {
                  setOverride(moveSidebarId(draft, id, 1));
                  setStatus({ state: "idle" });
                }}
              >
                Down
              </button>
            </li>
          );
        })}
      </ul>
      {settings && (
        <div className="border-t border-[var(--line-soft)] py-2 pl-7 text-sm font-semibold" data-sidebar-fixed="settings">
          {settings.label}
        </div>
      )}
    </div>
  );
}

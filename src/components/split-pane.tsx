"use client";

/**
 * Two stacked panes with a divider you can drag, remembered per user (cloud-backed prefs).
 *
 * Used for the note editor over the previous encounter: how much room each
 * one needs is a personal thing — a doctor reading a long prior note wants
 * the bottom big, someone typing wants the top big — and it should stay
 * where they put it rather than resetting on every visit.
 *
 * The height is stored for the TOP pane only; the bottom takes whatever is
 * left, so the pair always fills its container even when the window changes
 * size.
 *
 * Optional `bottomStorageKey`: the bottom pane gets a remembered height too, and
 * the SAME single grip trades height between the two panes (drag up = bottom
 * taller, drag down = top taller; the pair's total stays put). Both heights are
 * remembered. Without it the bottom just fills what is left (older behavior).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { movePaneDivider, parseSavedHeight } from "@/lib/split-heights";

function readSavedHeight(storageKey: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    return parseSavedHeight(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
}

export function SplitPane({
  storageKey,
  top,
  bottom,
  defaultTopHeight = 320,
  minTopHeight = 140,
  minBottomHeight = 140,
  maxHeight = "72vh",
  bottomStorageKey,
  defaultBottomHeight = 260,
}: {
  storageKey: string;
  top: ReactNode;
  bottom: ReactNode;
  defaultTopHeight?: number;
  minTopHeight?: number;
  minBottomHeight?: number;
  /** Caps the pair so both halves stay on screen and each scrolls inside
   *  itself, instead of a long prior note pushing the page down. */
  maxHeight?: string;
  /** Registered localStorage key for the bottom pane's own height (enables its bottom grip). */
  bottomStorageKey?: string;
  defaultBottomHeight?: number;
}) {
  const [topHeight, setTopHeight] = useState(defaultTopHeight);
  const [bottomHeight, setBottomHeight] = useState(defaultBottomHeight);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; start: { top: number; bottom: number } } | null>(null);

  // Read the saved height after mount rather than during render, so the
  // server and the first client render agree.
  useEffect(() => {
    setTopHeight(readSavedHeight(storageKey, defaultTopHeight));
  }, [storageKey, defaultTopHeight]);

  useEffect(() => {
    if (bottomStorageKey) setBottomHeight(readSavedHeight(bottomStorageKey, defaultBottomHeight));
  }, [bottomStorageKey, defaultBottomHeight]);

  const paired = Boolean(bottomStorageKey);
  const latestRef = useRef({ top: topHeight, bottom: bottomHeight });
  useEffect(() => {
    latestRef.current = { top: topHeight, bottom: bottomHeight };
  }, [topHeight, bottomHeight]);

  // Unpaired (older) mode: the top is capped by whatever room the container has.
  const clampHeight = useCallback(
    (next: number) => {
      const container = containerRef.current;
      const available = container ? container.getBoundingClientRect().height : 0;
      const max = available > 0 ? Math.max(minTopHeight, available - minBottomHeight) : next;
      return Math.min(max, Math.max(minTopHeight, next));
    },
    [minTopHeight, minBottomHeight],
  );

  /** Saved with the rest of the user's cloud-backed prefs (the storage interceptor mirrors these keys). */
  const persist = useCallback(
    (top: number, bottom: number) => {
      try {
        window.localStorage.setItem(storageKey, String(Math.round(top)));
        if (bottomStorageKey) window.localStorage.setItem(bottomStorageKey, String(Math.round(bottom)));
      } catch (err) {
        // Losing it just means the next visit opens at the default.
        console.warn("[split-pane] Could not save the divider position:", err);
      }
    },
    [storageKey, bottomStorageKey],
  );

  /** Move the grip `delta` px from the given starting heights (positive = down). */
  const apply = useCallback(
    (start: { top: number; bottom: number }, delta: number) => {
      if (paired) {
        const next = movePaneDivider(start, delta, minTopHeight, minBottomHeight);
        setTopHeight(next.top);
        setBottomHeight(next.bottom);
        return next;
      }
      const top = clampHeight(start.top + delta);
      setTopHeight(top);
      return { top, bottom: start.bottom };
    },
    [paired, minTopHeight, minBottomHeight, clampHeight],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = { startY: event.clientY, start: { ...latestRef.current } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    apply(drag.start, event.clientY - drag.startY);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    persist(latestRef.current.top, latestRef.current.bottom);
  };

  const dividerHint = paired
    ? "Drag up or down to resize the four previous-note boxes together (double-click to reset)"
    : "Drag up or down to resize";

  return (
    <div className="flex min-h-0 flex-col" ref={containerRef} style={paired ? undefined : { maxHeight }}>
      <div className="min-h-0 shrink-0 overflow-auto" style={{ height: topHeight }}>
        {top}
      </div>

      <div
        aria-label={dividerHint}
        aria-orientation="horizontal"
        className="group relative my-1 h-3 shrink-0 cursor-row-resize touch-none"
        onDoubleClick={() => {
          // Back to the default sizes (written, not cleared, so the reset is saved to the cloud prefs too).
          setTopHeight(defaultTopHeight);
          if (paired) setBottomHeight(defaultBottomHeight);
          persist(defaultTopHeight, defaultBottomHeight);
        }}
        onKeyDown={(event) => {
          // Keyboard nudge, so the divider isn't mouse-only.
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const step = event.shiftKey ? 48 : 16;
          const next = apply(latestRef.current, event.key === "ArrowDown" ? step : -step);
          persist(next.top, next.bottom);
        }}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        role="separator"
        tabIndex={0}
        title={dividerHint}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line-soft)]" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--line-soft)] transition-colors group-hover:bg-[var(--brand-primary)]" />
      </div>

      {paired ? (
        <div className="min-h-0 shrink-0 overflow-auto" style={{ height: bottomHeight }}>
          {bottom}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">{bottom}</div>
      )}
    </div>
  );
}

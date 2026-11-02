"use client";

/**
 * A row of columns with draggable vertical dividers between them (same grip look as SplitPane),
 * remembered per user (cloud-backed prefs, see cloud-key-registry). Double-click a divider to
 * restore equal widths. Below the `xl` breakpoint (phones / narrow windows) it renders the plain
 * responsive grid it replaces, so small screens are unchanged.
 */

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const MIN_FRACTION = 0.1;

export function equalFractions(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

/** Saved widths are only used when they are a complete, sane set; otherwise equal widths. */
export function parseFractions(raw: string | null, count: number): number[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(v) && v.length === count && v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= MIN_FRACTION / 2)) {
      const sum = (v as number[]).reduce((a, b) => a + b, 0);
      if (sum > 0) return (v as number[]).map((x) => x / sum);
    }
  } catch {
    // fall through
  }
  return equalFractions(count);
}

/** Move the divider between column i and i+1 by `delta` (a share of the row), keeping both ≥ the minimum. */
export function moveDivider(fractions: number[], i: number, delta: number): number[] {
  const out = [...fractions];
  const pair = out[i] + out[i + 1];
  const left = Math.min(pair - MIN_FRACTION, Math.max(MIN_FRACTION, out[i] + delta));
  out[i] = left;
  out[i + 1] = pair - left;
  return out;
}

export function ResizableColumns({
  storageKey,
  children,
  fallbackClassName = "grid h-full gap-2 sm:grid-cols-2 xl:grid-cols-4",
}: {
  storageKey: string;
  children: ReactNode;
  /** The grid used below `xl`, exactly as before. */
  fallbackClassName?: string;
}) {
  const items = Children.toArray(children);
  const count = items.length;
  const [wide, setWide] = useState(false);
  const [fractions, setFractions] = useState<number[]>(() => equalFractions(count));
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ index: number; startX: number; start: number[]; width: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Read the saved widths after mount so the server and first client render agree.
  /* eslint-disable react-hooks/set-state-in-effect -- localStorage is only readable after mount (avoids a hydration mismatch) */
  useEffect(() => {
    try {
      setFractions(parseFractions(window.localStorage.getItem(storageKey), count));
    } catch {
      setFractions(equalFractions(count));
    }
  }, [storageKey, count]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = useCallback(
    (next: number[] | null) => {
      try {
        if (next) window.localStorage.setItem(storageKey, JSON.stringify(next.map((x) => Math.round(x * 10000) / 10000)));
        else window.localStorage.removeItem(storageKey);
      } catch (err) {
        console.warn("[resizable-columns] Could not save the column widths:", err);
      }
    },
    [storageKey],
  );

  if (!wide || count < 2) return <div className={fallbackClassName}>{items}</div>;

  return (
    <div className="flex h-full min-h-0 items-stretch" ref={rowRef}>
      {items.map((item, i) => (
        <div className="contents" key={i}>
          <div className="flex min-h-0 min-w-0 flex-col [&>*]:min-h-0 [&>*]:flex-1" style={{ flex: `${fractions[i]} 1 0%` }}>
            {item}
          </div>
          {i < count - 1 ? (
            <div
              aria-label="Drag to resize columns (double-click to reset)"
              aria-orientation="vertical"
              className="group relative mx-0.5 w-3 shrink-0 cursor-col-resize touch-none"
              onDoubleClick={() => {
                const eq = equalFractions(count);
                setFractions(eq);
                save(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const step = event.shiftKey ? 0.05 : 0.02;
                const next = moveDivider(fractions, i, event.key === "ArrowRight" ? step : -step);
                setFractions(next);
                save(next);
              }}
              onPointerCancel={(event) => {
                dragRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                const width = rowRef.current?.getBoundingClientRect().width ?? 0;
                dragRef.current = { index: i, startX: event.clientX, start: fractions, width };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const d = dragRef.current;
                if (!d || d.width <= 0) return;
                setFractions(moveDivider(d.start, d.index, (event.clientX - d.startX) / d.width));
              }}
              onPointerUp={(event) => {
                if (!dragRef.current) return;
                dragRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                save(fractions);
              }}
              role="separator"
              tabIndex={0}
              title="Drag to resize • Double-click to reset"
            >
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--line-soft)]" />
              <div className="absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--line-soft)] transition-colors group-hover:bg-[var(--brand-primary)]" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

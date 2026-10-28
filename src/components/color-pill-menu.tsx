"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { softPillStyle } from "@/lib/color-utils";

export interface ColorPillChoice {
  id: string;
  label: string;
  /** Hex color; the pill is the same soft tint Case Status uses. */
  color: string;
}

const NEUTRAL = { backgroundColor: "#eef1f4", color: "#475569" };

/**
 * A Case Status–style pill you click to change: the pill is the exact `.status-pill`
 * (same size, soft tint) and the menu lists every choice as its own colored pill.
 * Used for the Compliance column. `shown` is what's on the pill right now:
 * a choice (colored) or just a label (neutral grey, e.g. "Not set").
 */
export function ColorPillMenu({
  choices,
  value,
  shownLabel,
  shownColor,
  unsetLabel,
  onChange,
  readOnly,
  ariaLabel,
  title,
}: {
  choices: ReadonlyArray<ColorPillChoice>;
  /** Selected choice id, or "" for none. */
  value: string;
  /** Text on the pill (the selected label, "Not set", or an unrecognised raw value). */
  shownLabel: string;
  /** Color of the pill when a real choice is selected; omit for neutral grey. */
  shownColor?: string;
  /** Label of the "clear" entry at the top of the menu. */
  unsetLabel: string;
  onChange: (id: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const style = shownColor ? softPillStyle(shownColor) : NEUTRAL;

  // Listeners exist only while this menu is open (one menu per Patients row).
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      } else if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  // Fixed position (so a scrolling table can't clip the menu); flips upward near the bottom of the screen.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuHeight = 36 * (choices.length + 1) + 16;
    setPos(
      window.innerHeight - r.bottom < menuHeight && r.top > menuHeight
        ? { left: r.left, bottom: window.innerHeight - r.top + 4 }
        : { left: r.left, top: r.bottom + 4 },
    );
  }, [open, choices.length]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== value) onChange(id);
  };

  if (readOnly) {
    return (
      <span className="status-pill max-w-full" style={style} title={title}>
        <span className="truncate">{shownLabel}</span>
      </span>
    );
  }

  return (
    <span className="relative inline-flex max-w-full" ref={boxRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="status-pill max-w-full cursor-pointer gap-1.5 border-0 hover:brightness-95"
        onClick={() => setOpen((o) => !o)}
        ref={btnRef}
        style={style}
        title={title}
        type="button"
      >
        <span className="truncate">{shownLabel}</span>
        <span aria-hidden="true" className="text-[9px] opacity-70">▾</span>
      </button>
      {open && pos && (
        <span
          className="fixed z-50 grid w-max min-w-[10rem] gap-1 rounded-xl border border-[var(--line-soft)] bg-white p-1.5 shadow-lg"
          role="listbox"
          style={pos}
        >
          <button
            aria-selected={value === ""}
            className="flex items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[rgba(13,121,191,0.06)]"
            onClick={() => pick("")}
            role="option"
            type="button"
          >
            <span className="status-pill" style={NEUTRAL}>{unsetLabel}</span>
            {value === "" && <span aria-hidden="true" className="text-xs text-[var(--brand-primary)]">✓</span>}
          </button>
          {choices.map((choice) => (
            <button
              aria-selected={choice.id === value}
              className="flex items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[rgba(13,121,191,0.06)]"
              key={choice.id}
              onClick={() => pick(choice.id)}
              role="option"
              type="button"
            >
              <span className="status-pill" style={softPillStyle(choice.color)}>{choice.label}</span>
              {choice.id === value && <span aria-hidden="true" className="text-xs text-[var(--brand-primary)]">✓</span>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

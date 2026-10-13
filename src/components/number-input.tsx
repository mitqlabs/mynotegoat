"use client";

import { useState, type InputHTMLAttributes } from "react";

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max">;

interface NumberInputProps extends BaseProps {
  value: number | string;
  /** Called with a valid number while typing (inside min/max), and on blur. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Used on blur when the box is left empty. Defaults to min, else 0. */
  fallback?: number;
}

/**
 * Number box that can be cleared while typing. A controlled
 * `<input type=number>` whose handler does `Number(v) || 1` snaps back the
 * moment you delete the last digit; this keeps a text draft instead and
 * only clamps / fills the default when the box loses focus.
 */
export function NumberInput({ value, onChange, min, max, fallback, onBlur, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (draft === "" || Number(draft) !== Number(value)) setDraft(String(value ?? ""));
  }

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined && out < min) out = min;
    if (max !== undefined && out > max) out = max;
    return out;
  };

  return (
    <input
      {...rest}
      max={max}
      min={min}
      onBlur={(event) => {
        const n = Number(draft);
        const next = draft.trim() === "" || !Number.isFinite(n) ? clamp(fallback ?? min ?? 0) : clamp(n);
        setDraft(String(next));
        if (next !== Number(value)) onChange(next);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw.trim() === "") return;
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        if ((min !== undefined && n < min) || (max !== undefined && n > max)) return;
        onChange(n);
      }}
      type="number"
      value={draft}
    />
  );
}

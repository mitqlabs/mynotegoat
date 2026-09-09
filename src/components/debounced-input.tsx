"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A text input that types against LOCAL state (instant, never dropped) and
 * commits upward on a short debounce + on blur. Use this for fields whose
 * onChange updates a large/expensive tree (e.g. office settings), where a
 * per-keystroke parent re-render otherwise drops characters or bounces the
 * caret. External value changes are adopted only while the field is not
 * focused, so a background sync never clobbers active typing.
 */
export function DebouncedInput({
  value,
  onCommit,
  transform,
  delay = 250,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
  /** Optional per-keystroke formatter (e.g. phone). Runs on local state. */
  transform?: (raw: string) => string;
  delay?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt external changes only when the user isn't actively typing here.
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);

  const scheduleCommit = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), delay);
  };

  return (
    <input
      {...rest}
      value={local}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        onCommit(local);
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const next = transform ? transform(e.target.value) : e.target.value;
        setLocal(next);
        scheduleCommit(next);
      }}
    />
  );
}

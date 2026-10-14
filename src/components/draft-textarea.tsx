"use client";

import { useEffect, useRef, useState } from "react";
import { applyExternalValue, createDebouncer, type DraftState } from "@/lib/draft-field";

/**
 * Textarea that keeps the user's typing locally and saves after a pause
 * (default 800ms) or on blur. Outside updates to `value` never overwrite
 * the text while the user is editing.
 */
export function DraftTextarea({
  value,
  onSave,
  className,
  waitMs = 800,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  waitMs?: number;
}) {
  const [state, setState] = useState<DraftState>({ draft: value, dirty: false, focused: false });
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  const debouncerRef = useRef<ReturnType<typeof createDebouncer<string>> | null>(null);
  useEffect(() => {
    const d = createDebouncer<string>((next) => {
      onSaveRef.current(next);
      setState((s) => (s.draft === next ? { ...s, dirty: false } : s));
    }, waitMs);
    debouncerRef.current = d;
    return () => d.flush();
  }, [waitMs]);

  // Accept outside changes only when the user isn't editing.
  const [lastExternal, setLastExternal] = useState(value);
  if (value !== lastExternal) {
    setLastExternal(value);
    setState((s) => applyExternalValue(s, value));
  }

  return (
    <textarea
      className={className}
      onBlur={() => {
        debouncerRef.current?.flush();
        setState((s) => ({ ...s, focused: false }));
      }}
      onChange={(e) => {
        const draft = e.target.value;
        setState((s) => ({ ...s, draft, dirty: true }));
        debouncerRef.current?.push(draft);
      }}
      onFocus={() => setState((s) => ({ ...s, focused: true }))}
      value={state.draft}
    />
  );
}

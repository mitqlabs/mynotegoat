"use client";

import { useId, useRef } from "react";

/**
 * US-format date input with a calendar popup.
 *
 * The visible field is a text input that auto-formats digits into
 * MM/DD/YYYY as the user types — so fast operators can punch
 * `01262026` and see `01/26/2026` without tabbing between segments.
 *
 * A small calendar icon beside the field opens the browser's native
 * date picker (via a hidden `<input type="date">` + `showPicker()`).
 * When the user picks a date there, we convert ISO → MM/DD/YYYY and
 * fire `onChange` with the formatted string, so the component stays
 * a drop-in replacement for the existing text inputs.
 *
 * Props deliberately mirror the existing text-input API so we can
 * swap this in at each site without reshaping surrounding state.
 */

export function formatUsDateInput(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" (or "" if not a complete valid date). */
export function usDateToIso(us: string): string {
  const match = us.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" → "MM/DD/YYYY" (or "" if not a valid ISO date). */
export function isoToUsDate(iso: string): string {
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, yyyy, mm, dd] = match;
  return `${mm}/${dd}/${yyyy}`;
}

interface UsDateInputProps {
  value: string;
  /** Fires with the formatted MM/DD/YYYY string (same shape the old
   *  text inputs used, for drop-in compatibility). */
  onChange: (nextUsFormatted: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional id passed to the visible text input (for <label htmlFor>). */
  id?: string;
  /** Minimum date as ISO string (YYYY-MM-DD). Applied to the hidden
   *  date picker so users can't navigate to invalid months. */
  minIso?: string;
  maxIso?: string;
  autoFocus?: boolean;
  /** Extra handler for the onBlur of the visible text input. */
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
}

export function UsDateInput({
  value,
  onChange,
  onKeyDown,
  placeholder = "MM/DD/YYYY",
  disabled,
  className,
  id,
  minIso,
  maxIso,
  autoFocus,
  onBlur,
}: UsDateInputProps) {
  const generatedId = useId();
  const inputId = id ?? `us-date-${generatedId}`;
  const hiddenRef = useRef<HTMLInputElement | null>(null);

  const openNativePicker = () => {
    const hidden = hiddenRef.current;
    if (!hidden) return;
    // Seed the native picker with whatever's currently in the text
    // input, so it opens on the user's last typed month instead of
    // today when re-opened on an already-filled field.
    const isoFromText = usDateToIso(value);
    if (isoFromText) {
      hidden.value = isoFromText;
    }
    // showPicker() is the spec-sanctioned way to open the native
    // calendar on demand. Fallback to focus+click for older browsers.
    type PickerElement = HTMLInputElement & { showPicker?: () => void };
    const picker = hidden as PickerElement;
    if (typeof picker.showPicker === "function") {
      try {
        picker.showPicker();
        return;
      } catch {
        // Some browsers throw if the element isn't connected or focused.
        // Fall through to the click fallback below.
      }
    }
    hidden.focus();
    hidden.click();
  };

  return (
    <span className="relative inline-flex w-full items-stretch">
      <input
        autoFocus={autoFocus}
        className={className}
        disabled={disabled}
        id={inputId}
        inputMode="numeric"
        maxLength={10}
        onBlur={onBlur}
        onChange={(event) => onChange(formatUsDateInput(event.target.value))}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ paddingRight: "2.25rem" }}
        type="text"
        value={value}
      />
      <button
        aria-label="Open calendar"
        className="absolute inset-y-0 right-1 my-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-soft)] hover:text-[var(--brand-primary)] disabled:opacity-40"
        disabled={disabled}
        onClick={openNativePicker}
        tabIndex={-1}
        title="Open calendar"
        type="button"
      >
        {/* Minimal calendar glyph — no external icon lib dependency */}
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          viewBox="0 0 24 24"
          width="18"
        >
          <rect height="15" rx="2" width="17" x="3.5" y="5" />
          <path d="M3.5 9.5h17" />
          <path d="M8 3.5v3" />
          <path d="M16 3.5v3" />
        </svg>
      </button>
      <input
        aria-hidden="true"
        className="pointer-events-none absolute opacity-0"
        max={maxIso}
        min={minIso}
        onChange={(event) => {
          const iso = event.target.value;
          if (!iso) {
            onChange("");
            return;
          }
          const us = isoToUsDate(iso);
          if (us) onChange(us);
        }}
        ref={hiddenRef}
        style={{ width: 0, height: 0, right: 0, bottom: 0 }}
        tabIndex={-1}
        type="date"
      />
    </span>
  );
}

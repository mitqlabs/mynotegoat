"use client";

import { useEffect, useRef, useState } from "react";
import {
  composeAddressParts,
  parseAddressString,
  type AddressParts,
} from "@/lib/address-parts";

type Props = {
  /** Current composed single-line address string (the canonical storage shape). */
  value: string;
  /** Called with the newly-composed single-line address on every field edit. */
  onChange: (nextValue: string) => void;
  /** Optional class for the outermost wrapper. */
  className?: string;
  /** Optional smaller label styling for inline/quick-edit contexts. */
  compact?: boolean;
};

/**
 * Five-field address editor (Address 1, Address 2, City, State, ZIP).
 * Parses the incoming single-string value on mount / external change,
 * holds the parts in local state, and emits a composed single string
 * on every user edit. Existing stored values with all sorts of shapes
 * ("123 Main St", "Glendale, CA", "1234 Fake St., Unit 111, Glendale,
 *  CA 91206") all survive the round-trip.
 */
export function AddressFieldGroup({
  value,
  onChange,
  className,
  compact,
}: Props) {
  const [parts, setParts] = useState<AddressParts>(() => parseAddressString(value));
  // Track the LAST string we emitted so we can ignore the echo when the
  // parent re-renders with the same value we just emitted. Without this
  // guard, every parent re-render would re-parse and reset uncommitted
  // field state (e.g., a user mid-typing "CA" gets their input snapped
  // back to just "C" after parse re-runs).
  const lastEmittedRef = useRef<string>(composeAddressParts(parts));

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    setParts(parseAddressString(value));
    lastEmittedRef.current = value;
  }, [value]);

  const emit = (next: AddressParts) => {
    setParts(next);
    const composed = composeAddressParts(next);
    lastEmittedRef.current = composed;
    onChange(composed);
  };

  const labelCls = compact
    ? "text-xs font-semibold text-[var(--text-muted)]"
    : "text-sm font-semibold text-[var(--text-muted)]";
  const inputCls = compact
    ? "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
    : "rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2";

  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <label className="grid gap-1">
          <span className={labelCls}>Address 1</span>
          <input
            className={inputCls}
            onChange={(event) =>
              emit({ ...parts, address1: event.target.value })
            }
            placeholder="Street address"
            value={parts.address1}
          />
        </label>
        <label className="grid gap-1">
          <span className={labelCls}>Address 2</span>
          <input
            className={inputCls}
            onChange={(event) =>
              emit({ ...parts, address2: event.target.value })
            }
            placeholder="Unit / Suite / Apt (optional)"
            value={parts.address2}
          />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-[220px_80px_120px] sm:justify-start">
        <label className="grid gap-1">
          <span className={labelCls}>City</span>
          <input
            className={inputCls}
            onChange={(event) =>
              emit({ ...parts, city: event.target.value })
            }
            placeholder="City"
            value={parts.city}
          />
        </label>
        <label className="grid gap-1">
          <span className={labelCls}>State</span>
          <input
            className={`${inputCls} uppercase`}
            maxLength={2}
            onChange={(event) =>
              emit({
                ...parts,
                state: event.target.value.replace(/[^A-Za-z]/g, "").toUpperCase(),
              })
            }
            placeholder="CA"
            value={parts.state}
          />
        </label>
        <label className="grid gap-1">
          <span className={labelCls}>ZIP</span>
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={10}
            onChange={(event) =>
              emit({
                ...parts,
                zip: event.target.value.replace(/[^\d-]/g, ""),
              })
            }
            placeholder="91206"
            value={parts.zip}
          />
        </label>
      </div>
    </div>
  );
}

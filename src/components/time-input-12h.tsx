"use client";

import { useState } from "react";
import { loadScheduleSettings, type DailyOfficeHours } from "@/lib/schedule-settings";
import { compose24h, inferMeridiem, parseTyped, split24h, type Meridiem } from "@/lib/time-12h";

interface TimeInput12hProps {
  /** Canonical 24h "HH:MM" (or ""). Storage format never changes. */
  value: string;
  onChange: (value24h: string) => void;
  /** Pass for appointment times to get smart AM/PM from business hours. */
  officeHours?: DailyOfficeHours[];
  /** Appointment date (YYYY-MM-DD) so that day's hours are used. */
  dateIso?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Smart AM/PM using the saved office hours (when officeHours isn't passed). */
  smart?: boolean;
  /** Allow clearing to "" (e.g. optional per-day overrides). */
  allowEmpty?: boolean;
}

/**
 * 12-hour time box ("9:30" + AM/PM). Type 930, 9:30, 330p or 1530.
 * When office hours are given and the user hasn't picked AM/PM themselves,
 * the half of the day that's inside business hours is chosen (3:30 -> PM,
 * 9:00 -> AM). If both or neither fit, the current choice is kept.
 */
export function TimeInput12h({
  value,
  onChange,
  officeHours,
  dateIso,
  disabled,
  className,
  inputClassName,
  placeholder = "9:30",
  ariaLabel,
  allowEmpty,
  smart,
}: TimeInput12hProps) {
  const [savedHours] = useState<DailyOfficeHours[] | undefined>(() =>
    smart && !officeHours ? loadScheduleSettings().officeHours : undefined,
  );
  const hours = officeHours ?? savedHours;
  const initial = split24h(value);
  const [display, setDisplay] = useState(initial.display);
  const [meridiem, setMeridiem] = useState<Meridiem>(initial.meridiem);
  const [userPicked, setUserPicked] = useState(false);
  const [lastEmitted, setLastEmitted] = useState(value);

  // Follow outside changes (e.g. a different appointment was opened):
  // adjust state during render instead of in an effect.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== lastEmitted) {
      const next = split24h(value);
      setDisplay(next.display);
      if (next.display) setMeridiem(next.meridiem);
      setUserPicked(false);
    }
    setLastEmitted(value);
  }

  const emit = (d: string, m: Meridiem) => {
    const composed = compose24h(d, m);
    if (composed) {
      setLastEmitted(composed);
      onChange(composed);
    } else if (!d && allowEmpty) {
      setLastEmitted("");
      onChange("");
    }
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <input
        aria-label={ariaLabel}
        className={inputClassName ?? "w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"}
        disabled={disabled}
        inputMode="numeric"
        maxLength={8}
        onChange={(event) => {
          const parsed = parseTyped(event.target.value);
          let m = meridiem;
          if (parsed.meridiem) {
            m = parsed.meridiem;
            setUserPicked(true);
          } else if (!userPicked) {
            m = inferMeridiem(parsed.display, hours, dateIso) ?? meridiem;
          }
          setDisplay(parsed.display);
          setMeridiem(m);
          emit(parsed.display, m);
        }}
        placeholder={placeholder}
        value={display}
      />
      <select
        aria-label={ariaLabel ? `${ariaLabel} AM/PM` : "AM/PM"}
        className={
          inputClassName
            ? `${inputClassName.replace(/\bw-(full|\d+)\b/g, "")} w-auto`
            : "rounded-xl border border-[var(--line-soft)] bg-white px-2 py-2"
        }
        disabled={disabled}
        onChange={(event) => {
          const m = event.target.value as Meridiem;
          setUserPicked(true);
          setMeridiem(m);
          emit(display, m);
        }}
        value={meridiem}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

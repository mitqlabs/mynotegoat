"use client";

export type RecurrenceHolidayRow = {
  key: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  name: string;
  /** e.g. "Mon, Oct 12, 2026". */
  dateLabel: string;
  /** Already a CLOSED key date: follows the closure behaviour, no checkbox. */
  officeClosed: boolean;
  /** Weekday the office is normally closed (Office Hours): no choice. */
  regularDayOff: boolean;
  /** Non-canceled appointments already on this date (all patients). */
  bookedCount: number;
  /** This exact date was kept on schedule in an earlier booking. */
  remembered: boolean;
};

type RecurrenceHolidayTableProps = {
  holidays: RecurrenceHolidayRow[];
  keepScheduleDates: string[];
  /** Keep (true) = book normally; Closed (false, default) = cancel + close. */
  onChooseKeep: (dateIso: string, keep: boolean) => void;
  /** Forget a remembered date (the Keep / Closed choice comes back). */
  onUndoRemembered: (dateIso: string) => void;
};

/**
 * Federal holidays inside a recurring series' range, shown full-width
 * under the Ends By / End Date / Projected row of the New Appointment
 * modal: name | date | Keep / Closed toggle (or a status label).
 * Fixed grid columns on sm+ so rows line up; stacks on narrow screens.
 */
export function RecurrenceHolidayTable({
  holidays,
  keepScheduleDates,
  onChooseKeep,
  onUndoRemembered,
}: RecurrenceHolidayTableProps) {
  if (!holidays.length) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[rgba(201,66,58,0.3)] bg-white">
      <p className="border-b border-[rgba(201,66,58,0.2)] bg-[rgba(201,66,58,0.06)] px-3 py-1.5 text-xs font-semibold text-[#b43b34]">
        Holidays in this range:
      </p>
      <ul className="text-xs">
        {holidays.map((holiday) => (
          <li
            key={holiday.key}
            className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-t border-[rgba(201,66,58,0.12)] min-h-7 px-3 py-1 first:border-t-0 even:bg-[rgba(201,66,58,0.03)] sm:grid-cols-[minmax(0,1fr)_9.5rem_7rem_12rem] sm:items-center"
          >
            <span className="truncate font-semibold text-[#b43b34]" title={holiday.name}>
              {holiday.name}
            </span>
            <span className="whitespace-nowrap tabular-nums text-[#b43b34]">{holiday.dateLabel}</span>
            {/* Already-booked count, open workdays only: many = the office
                was open that day; a few = special overrides. */}
            <span className="whitespace-nowrap tabular-nums text-[var(--text-muted)]">
              {holiday.regularDayOff
                ? ""
                : holiday.bookedCount === 0
                  ? "No appointments"
                  : `${holiday.bookedCount} appointment${holiday.bookedCount === 1 ? "" : "s"}`}
            </span>
            <span className="whitespace-nowrap sm:justify-self-end">
              {holiday.officeClosed ? (
                <span className="text-[var(--text-muted)]">Office closed (Key Date)</span>
              ) : holiday.regularDayOff ? (
                <span className="text-[var(--text-muted)]">Office closed (regular day off)</span>
              ) : holiday.remembered ? (
                <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                  Kept on schedule
                  <button
                    className="text-[11px] font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    onClick={() => onUndoRemembered(holiday.date)}
                    title={`Stop keeping ${holiday.dateLabel} on schedule`}
                    type="button"
                  >
                    Undo
                  </button>
                </span>
              ) : (
                <KeepClosedToggle
                  keep={keepScheduleDates.includes(holiday.date)}
                  label={holiday.name}
                  onChange={(keep) => onChooseKeep(holiday.date, keep)}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact two-option segmented control: Keep | Closed. */
function KeepClosedToggle({
  keep,
  label,
  onChange,
}: {
  keep: boolean;
  label: string;
  onChange: (keep: boolean) => void;
}) {
  const base = "px-2.5 py-0 text-[11px] font-semibold leading-[18px] transition-colors";
  return (
    <span
      aria-label={`${label}: keep on schedule or close the office`}
      className="inline-flex overflow-hidden rounded-full border border-[var(--line-soft)] bg-white"
      role="radiogroup"
    >
      <button
        aria-checked={keep}
        className={`${base} ${
          keep ? "bg-[var(--brand-primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
        }`}
        onClick={() => onChange(true)}
        role="radio"
        type="button"
      >
        Keep
      </button>
      <button
        aria-checked={!keep}
        className={`${base} border-l border-[var(--line-soft)] ${
          !keep ? "bg-[#b43b34] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
        }`}
        onClick={() => onChange(false)}
        role="radio"
        type="button"
      >
        Closed
      </button>
    </span>
  );
}

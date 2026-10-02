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
  /** Kept on schedule in an earlier booking (remembered by name). */
  remembered: boolean;
};

type RecurrenceHolidayTableProps = {
  holidays: RecurrenceHolidayRow[];
  keepScheduleDates: string[];
  onToggleKeepSchedule: (dateIso: string, keep: boolean) => void;
  /** Forget a remembered holiday (the checkbox comes back). */
  onUndoRemembered: (name: string) => void;
};

/**
 * Federal holidays inside a recurring series' range, shown full-width
 * under the Ends By / End Date / Projected row of the New Appointment
 * modal: name | date | "Keep Schedule" checkbox (or "Office closed").
 * Fixed grid columns on sm+ so rows line up; stacks on narrow screens.
 */
export function RecurrenceHolidayTable({
  holidays,
  keepScheduleDates,
  onToggleKeepSchedule,
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
            className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-t border-[rgba(201,66,58,0.12)] min-h-7 px-3 py-1 first:border-t-0 even:bg-[rgba(201,66,58,0.03)] sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem] sm:items-center"
          >
            <span className="truncate font-semibold text-[#b43b34]" title={holiday.name}>
              {holiday.name}
            </span>
            <span className="whitespace-nowrap tabular-nums text-[#b43b34]">{holiday.dateLabel}</span>
            <span className="whitespace-nowrap sm:justify-self-end">
              {holiday.officeClosed ? (
                <span className="text-[var(--text-muted)]">Office closed (Key Date)</span>
              ) : holiday.remembered ? (
                <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                  Kept on schedule
                  <button
                    className="text-[11px] font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
                    onClick={() => onUndoRemembered(holiday.name)}
                    title={`Stop keeping ${holiday.name} on schedule`}
                    type="button"
                  >
                    Undo
                  </button>
                </span>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--text-muted)]">
                  <input
                    checked={keepScheduleDates.includes(holiday.date)}
                    onChange={(event) => onToggleKeepSchedule(holiday.date, event.target.checked)}
                    type="checkbox"
                  />
                  Keep Schedule
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

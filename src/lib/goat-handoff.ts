/**
 * Shift handoff: a short, printable summary of the day for the next person.
 * Built from the schedule, intake, and untouched reminders already on the page.
 */
import type { CloseoutModel } from "@/lib/goat-closeout";
import type { UntouchedItem } from "@/lib/goat-untouched";

export type HandoffBullet = { text: string; children: string[] };

export function buildHandoff(input: {
  officeName: string;
  dateLabel: string;
  seen: number;
  noShows: Array<{ name: string }>;
  intake: Array<{ name: string; missing: string[] }>;
  waiting: UntouchedItem[];
  openings: string[];
  tomorrowClosed: boolean;
  rebooks: Array<{ name: string; when: string }>;
}): { title: string; left: HandoffBullet[]; right: HandoffBullet[] } {
  const left: HandoffBullet[] = [
    {
      text: `Seen: ${input.seen}`,
      children: input.seen === 0 ? ["No one checked out yet"] : [],
    },
    {
      text: `No-shows: ${input.noShows.length}`,
      children: input.noShows.map((row) => row.name),
    },
  ];
  const right: HandoffBullet[] = [
    {
      text: `New patients in intake: ${input.intake.length}`,
      children: input.intake.map((row) =>
        row.missing.length ? `${row.name} — missing ${row.missing.join(", ")}` : row.name,
      ),
    },
    {
      text: `Waiting on: ${input.waiting.length}`,
      children: input.waiting.slice(0, 12).map((row) => `${row.patientName} — ${row.title}`),
    },
    {
      text: input.tomorrowClosed ? "Tomorrow: office closed" : `Tomorrow's openings: ${input.openings.length}`,
      children: input.tomorrowClosed ? [] : input.openings.slice(0, 8),
    },
    {
      text: `Rebooks: ${input.rebooks.length}`,
      children: input.rebooks.map((row) => `${row.name} — ${row.when}`),
    },
  ];
  return {
    title: `${input.officeName || "Office"} handoff — ${input.dateLabel}`,
    left,
    right,
  };
}

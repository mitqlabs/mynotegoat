/**
 * End-of-day closeout from the schedule and notes already saved:
 * unsigned notes from today, checked-in visits with no note, tomorrow's open slots.
 */
import { getOfficeHoursForDate, type ScheduleSettingsConfig } from "@/lib/schedule-settings";
import { to12hLabel } from "@/lib/time-12h";

export type CloseoutVisit = {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  startTime: string;
  status: string;
  appointmentType?: string;
};

export type CloseoutNote = {
  id: string;
  patientId: string;
  patientName?: string;
  encounterDate: string;
  signed: boolean;
  appointmentId?: string;
};

export type CloseoutModel = {
  unsigned: Array<{ id: string; name: string; href: string }>;
  checkedInWithoutNote: Array<{ id: string; name: string; href: string; time: string }>;
  openings: string[];
  tomorrowClosed: boolean;
};

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function noteMatchesDay(encounterDate: string, iso: string): boolean {
  const raw = encounterDate.trim();
  if (raw.startsWith(iso)) return true;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!m) return false;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` === iso;
}

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function slotsBetween(start: string, end: string, step: number): string[] {
  const a = toMin(start);
  const b = toMin(end);
  if (a === null || b === null || step < 5) return [];
  const out: string[] = [];
  for (let t = a; t + step <= b; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

export function buildCloseout(input: {
  todayIso: string;
  appointments: CloseoutVisit[];
  notes: CloseoutNote[];
  settings: Pick<ScheduleSettingsConfig, "officeHours" | "appointmentIntervalMin" | "maxAppointmentsPerSlot">;
}): CloseoutModel {
  const todayNotes = input.notes.filter((note) => noteMatchesDay(note.encounterDate, input.todayIso));
  const unsigned = todayNotes
    .filter((note) => !note.signed)
    .map((note) => ({
      id: note.id,
      name: note.patientName || "Unsigned note",
      href: `/patients/${note.patientId}`,
    }));
  const seen = input.appointments.filter(
    (a) => a.date === input.todayIso && (a.status === "Check In" || a.status === "Check Out"),
  );
  const checkedInWithoutNote = seen
    .filter((visit) => {
      const match = todayNotes.some(
        (note) => note.appointmentId === visit.id || (note.patientId === visit.patientId && noteMatchesDay(note.encounterDate, visit.date)),
      );
      return !match;
    })
    .map((visit) => ({
      id: visit.id,
      name: visit.patientName,
      href: `/patients/${visit.patientId}`,
      time: to12hLabel(visit.startTime),
    }));
  const tomorrow = addDays(input.todayIso, 1);
  const hours = getOfficeHoursForDate(input.settings as ScheduleSettingsConfig, tomorrow);
  if (!hours || !hours.enabled) {
    return { unsigned, checkedInWithoutNote, openings: [], tomorrowClosed: true };
  }
  const step = Math.max(5, input.settings.appointmentIntervalMin || 15);
  const cap = Math.max(1, input.settings.maxAppointmentsPerSlot || 1);
  const slots = [
    ...slotsBetween(hours.start, hours.end, step),
    ...(hours.start2 && hours.end2 ? slotsBetween(hours.start2, hours.end2, step) : []),
  ];
  const booked = input.appointments.filter(
    (a) => a.date === tomorrow && a.status !== "Canceled" && a.status !== "No Show",
  );
  const openings = slots
    .filter((slot) => booked.filter((a) => a.startTime === slot).length < cap)
    .map((slot) => to12hLabel(slot));
  return { unsigned, checkedInWithoutNote, openings, tomorrowClosed: false };
}

/**
 * Pure helpers linking an encounter note to its schedule appointment.
 * (No React / storage, so they are unit-testable.)
 */

export type LinkNote = {
  id: string;
  patientId: string;
  encounterDate: string; // mm/dd/yyyy
  appointmentType: string;
  appointmentId?: string;
};

export type LinkAppointment = {
  id: string;
  patientId: string;
  date: string; // yyyy-mm-dd
  appointmentType: string;
  status?: string;
};

export function usDateFromIso(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

const lc = (s: string) => s.trim().toLowerCase();
const isDead = (a: LinkAppointment) => a.status === "Canceled" || a.status === "No Show";

/** The appointment a note belongs to: the saved appointmentId if present,
 *  else the same-day appointment of the same type, else the only live
 *  same-day appointment. Null when it can't be told apart. */
export function findLinkedAppointment(
  note: LinkNote,
  appointments: LinkAppointment[],
): LinkAppointment | null {
  if (note.appointmentId) {
    const byId = appointments.find((a) => a.id === note.appointmentId);
    if (byId) return byId;
  }
  const sameDay = appointments.filter(
    (a) => a.patientId === note.patientId && usDateFromIso(a.date) === note.encounterDate,
  );
  const byType = sameDay.find((a) => lc(a.appointmentType) === lc(note.appointmentType));
  if (byType) return byType;
  const live = sameDay.filter((a) => !isDead(a));
  return live.length === 1 ? live[0] : null;
}

/** The type to SHOW for a note: its linked appointment's type, falling back
 *  to the type stored on the note. */
export function encounterDisplayType(note: LinkNote, appointments: LinkAppointment[]): string {
  return findLinkedAppointment(note, appointments)?.appointmentType || note.appointmentType;
}

/** When an appointment's type changes from `beforeType`, which note follows
 *  it? By saved appointmentId first, else same patient + date + the OLD type.
 *  Never guesses between several candidates. */
export function findNoteForTypeChange<T extends LinkNote>(
  notes: T[],
  appointment: { id: string; patientId: string; date: string },
  beforeType: string,
): T | null {
  const byId = notes.filter((n) => n.appointmentId === appointment.id);
  if (byId.length === 1) return byId[0];
  const dateUs = usDateFromIso(appointment.date);
  const byType = notes.filter(
    (n) =>
      n.patientId === appointment.patientId &&
      n.encounterDate === dateUs &&
      lc(n.appointmentType) === lc(beforeType),
  );
  return byType.length === 1 ? byType[0] : null;
}

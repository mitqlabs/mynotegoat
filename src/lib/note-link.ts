/**
 * Find the encounter note that belongs to an appointment.
 *
 * The cloud table doesn't store the note's appointment id yet, so after a
 * reload most notes are matched the same way the patient page does it:
 * appointment id → same date + same type → same date.
 */
type LinkableNote = {
  id: string;
  patientId: string;
  encounterDate: string; // MM/DD/YYYY
  appointmentType: string;
  appointmentId?: string;
  signed: boolean;
};

type LinkableAppointment = {
  id: string;
  patientId: string;
  date: string; // YYYY-MM-DD
  appointmentType: string;
};

export function isoToUsDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

export function findLinkedNote<N extends LinkableNote>(
  notes: readonly N[],
  appointment: LinkableAppointment,
): N | null {
  const dateUs = isoToUsDate(appointment.date);
  const type = appointment.appointmentType.trim().toLowerCase();
  let byType: N | null = null;
  let byDate: N | null = null;
  for (const note of notes) {
    if (note.patientId !== appointment.patientId) continue;
    if (note.appointmentId && note.appointmentId === appointment.id) return note;
    if (note.encounterDate !== dateUs) continue;
    if (!byType && note.appointmentType.trim().toLowerCase() === type) byType = note;
    if (!byDate) byDate = note;
  }
  return byType ?? byDate;
}

/** The note linked to this appointment, but only if it exists and is still open. */
export function findOpenLinkedNote<N extends LinkableNote>(
  notes: readonly N[],
  appointment: LinkableAppointment,
): N | null {
  const note = findLinkedNote(notes, appointment);
  return note && !note.signed ? note : null;
}

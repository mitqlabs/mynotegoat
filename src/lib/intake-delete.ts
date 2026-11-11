/**
 * Permanent delete from New Patient Intake. Refuses unless the chart is
 * intake-only and has no case info, notes, or appointments.
 */
import { entriesForPatient, loadCaseNoteEntries } from "@/lib/case-note-entries";
import { getCaseNote } from "@/lib/case-notes";
import { loadEncounterNoteRecords } from "@/lib/encounter-notes";
import { intakeDeleteReason, isInNewPatientIntake } from "@/lib/patient-list-intake";
import { getEncountersByPatientId, getPatientById, permanentlyDeletePatientRecord } from "@/lib/mock-data";
import { loadScheduleAppointments } from "@/lib/schedule-appointments";

/** The line G.O.A.T. Mail stores when it adds a chart. That is not a clinical note. */
const MAIL_STAMP = /^Added from G\.O\.A\.T\. Mail\.( Missing: .*)?$/;

export function intakePatientHasNotes(patientId: string, matrixNotes?: string): boolean {
  const id = patientId.trim();
  if (!id) return false;
  const matrix = (matrixNotes ?? "").trim();
  if (matrix && !MAIL_STAMP.test(matrix)) return true;
  if (getEncountersByPatientId(id).length > 0) return true;
  if (typeof window === "undefined") return false;
  if (loadEncounterNoteRecords().some((note) => note.patientId === id)) return true;
  const caseNote = getCaseNote(id);
  if (caseNote && caseNote.trim()) return true;
  return entriesForPatient(loadCaseNoteEntries(), id).some((entry) => entry.text.trim());
}

/** Tooltip text when Delete must stay off, or null when it is allowed. */
export function intakeDeleteBlock(patientId: string): string | null {
  const patient = getPatientById(patientId);
  const appointmentCount = loadScheduleAppointments().filter((visit) => visit.patientId === patientId).length;
  return intakeDeleteReason({
    inIntake: Boolean(patient && isInNewPatientIntake(patient)),
    hasNotes: intakePatientHasNotes(patientId, patient?.matrix?.notes),
    appointmentCount,
  });
}

/** Deletes the patient row only. Notes and appointments are never removed. */
export function deleteIntakePatient(patientId: string): boolean {
  if (intakeDeleteBlock(patientId)) return false;
  return permanentlyDeletePatientRecord(patientId);
}

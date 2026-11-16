/**
 * Who is still on the New Patient list. This is decided when the screen is
 * drawn. Nothing on the patient row is rewritten to move them.
 *
 * A personal-injury patient stays in New Patient Intake until BOTH are true:
 *   1. Attorney info is set. "Self" / "SELF" counts. A blank attorney does not.
 *   2. An Initial Exam date is saved, or a New Patient visit is booked
 *      (any status except Canceled or No Show — the same visits the Initial
 *      Exam box uses).
 *
 * Attorney alone, or a date of injury alone, does not move them. They were
 * never seen. Cash patients stay on the Patient List. Deleted charts are
 * on neither list. An older onPatientList flag may still be stored; the
 * lists do not read it.
 */
import {
  buildInitialExamIndex,
  patientInitialExamInfo,
  type InitialExamIndex,
  type InitialExamScheduleEntry,
} from "@/lib/initial-exam-date";

/** No date of injury. The New Patient list does not use this. */
export function lacksCaseInfo(patient: {
  isCashPatient?: boolean;
  dateOfLoss?: string;
  deleted?: boolean;
}): boolean {
  if (patient.deleted || patient.isCashPatient) return false;
  return !(patient.dateOfLoss ?? "").trim();
}

/** True when the attorney box has a name. Self counts. Blank does not. */
export function attorneyInfoIsSet(attorney: string | null | undefined): boolean {
  return Boolean((attorney ?? "").trim());
}

export type NewPatientIntakeVisit = {
  patientId?: string;
  patientName?: string;
  appointmentType?: string;
  status?: string;
  date?: string;
};

type IntakePatient = {
  id?: string;
  fullName?: string;
  attorney?: string | null;
  isCashPatient?: boolean;
  deleted?: boolean;
  /** Kept so older rows still type-check. The list does not read this. */
  dateOfLoss?: string;
  /** Kept so older rows still type-check. The list does not read this. */
  onPatientList?: boolean;
  matrix?: { initialExam?: string };
};

function examIndex(visits: NewPatientIntakeVisit[] | InitialExamIndex): InitialExamIndex {
  if (!Array.isArray(visits)) return visits;
  if (visits.length === 0) return buildInitialExamIndex([]);
  const rows: InitialExamScheduleEntry[] = visits.map((visit) => ({
    patientId: visit.patientId ?? "",
    patientName: visit.patientName ?? "",
    appointmentType: visit.appointmentType ?? "",
    status: visit.status ?? "",
    date: visit.date ?? "",
  }));
  return buildInitialExamIndex(rows);
}

/**
 * True while this chart belongs in New Patient Intake (above the Patient List).
 * Pass the schedule (or an index built from it) so a booked New Patient visit
 * counts even when the Initial Exam box has not been typed in.
 */
export function isInNewPatientIntake(
  patient: IntakePatient,
  visits: NewPatientIntakeVisit[] | InitialExamIndex = [],
): boolean {
  if (patient.deleted || patient.isCashPatient) return false;
  if (!attorneyInfoIsSet(patient.attorney)) return true;
  const info = patientInitialExamInfo(
    { id: patient.id ?? "", fullName: patient.fullName ?? "", matrix: patient.matrix },
    examIndex(visits),
  );
  return !info.date;
}

/**
 * Why Delete is unavailable, or null when this intake chart can be removed
 * for good. Leaving the New Patient list, notes, and appointments each block it.
 */
export function intakeDeleteReason(input: {
  inIntake: boolean;
  hasNotes: boolean;
  appointmentCount: number;
}): string | null {
  if (!input.inIntake) return "Only a patient still on the New Patient list can be deleted here.";
  const notes = input.hasNotes;
  const appointments = input.appointmentCount > 0;
  if (notes && appointments) return "This patient has notes and appointments.";
  if (notes) return "This patient has notes.";
  if (appointments) return "This patient has appointments.";
  return null;
}

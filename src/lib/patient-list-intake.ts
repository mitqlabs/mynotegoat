/**
 * New Patient Intake sits above the Patient List for PI patients who do not
 * have case info yet (no date of injury). Cash patients stay on the list.
 * Adding case info (a date of injury) moves them onto the Patient List.
 * Delete permanently removes an intake chart only when it has no case info,
 * notes, or appointments. onPatientList is still stored on the patient row.
 */
export function lacksCaseInfo(patient: {
  isCashPatient?: boolean;
  dateOfLoss?: string;
  deleted?: boolean;
}): boolean {
  if (patient.deleted || patient.isCashPatient) return false;
  return !(patient.dateOfLoss ?? "").trim();
}

export function isInNewPatientIntake(patient: {
  isCashPatient?: boolean;
  dateOfLoss?: string;
  deleted?: boolean;
  onPatientList?: boolean;
}): boolean {
  return lacksCaseInfo(patient) && patient.onPatientList !== true;
}

/**
 * Why Delete is unavailable, or null when this intake chart can be removed
 * for good. Case info, notes, and appointments each block it.
 */
export function intakeDeleteReason(input: {
  inIntake: boolean;
  hasNotes: boolean;
  appointmentCount: number;
}): string | null {
  if (!input.inIntake) return "Only an intake chart with no case info can be deleted here.";
  const notes = input.hasNotes;
  const appointments = input.appointmentCount > 0;
  if (notes && appointments) return "This patient has notes and appointments.";
  if (notes) return "This patient has notes.";
  if (appointments) return "This patient has appointments.";
  return null;
}

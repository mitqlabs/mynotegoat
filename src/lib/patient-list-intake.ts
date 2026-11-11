/**
 * New Patient Intake sits above the Patient List for PI patients who do not
 * have case info yet (no date of injury). Cash patients stay on the list.
 * Adding case info (a date of injury) moves them onto the Patient List.
 * Remove soft-deletes the chart (deleted flag) so it can be restored.
 * onPatientList is still stored on the patient row (patients.on_patient_list).
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

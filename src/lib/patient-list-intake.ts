/**
 * New Patient Intake sits above the Patient List for PI patients who do not
 * have case info yet (no date of injury). Cash patients stay on the list.
 * "Move Patient to Patient List" sets onPatientList, which is stored on the
 * patient row (patients.on_patient_list) so it survives a refresh.
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

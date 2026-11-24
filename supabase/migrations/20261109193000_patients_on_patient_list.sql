-- Patients without case info stay in New Patient Intake until staff move them
-- onto the Patient List. Apply in the Supabase SQL editor (same as the
-- compliance column). The app only writes this column when someone moves a
-- patient, so older saves keep working before this is applied.
alter table public.patients add column if not exists on_patient_list boolean;

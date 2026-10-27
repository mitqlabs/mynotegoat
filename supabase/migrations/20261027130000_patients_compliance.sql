-- Optional per-patient Compliance (New Patient / Yes / No / DNS ATM / Non-Compliant).
-- Nullable text, same sync path as patients.case_status. The app only writes this
-- column once a patient is given a value, and the Compliance column is off by
-- default in Settings — apply this BEFORE turning the column on.
alter table public.patients add column if not exists compliance text;

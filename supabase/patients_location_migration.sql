-- =====================================================================
-- Note Goat — Patient location (multi-location).
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Adds a single nullable column so a patient can be assigned to an office
-- location (OfficeLocation.id). NULL = unassigned. No new table; this
-- mirrors how is_cash_patient was added earlier.
-- =====================================================================

alter table public.patients
  add column if not exists location_id text;

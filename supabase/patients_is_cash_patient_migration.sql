-- Migration: add is_cash_patient column to patients table.
-- Run this in Supabase SQL Editor once. Safe to re-run (IF NOT EXISTS).
--
-- Cash patients are "no-attorney / no-injury / no-case-number" visits.
-- The flag gates hiding the PI-specific sections in the patient file,
-- filtering appointment-type dropdowns, and excluding these patients
-- from the Case Flow queue (no lien/submission lifecycle).

alter table public.patients
  add column if not exists is_cash_patient boolean not null default false;

-- Backfill: existing rows default to PI (false) via the column default,
-- which is what we want — the user will explicitly mark any existing
-- patient as cash via the patient-file toggle if they need to.

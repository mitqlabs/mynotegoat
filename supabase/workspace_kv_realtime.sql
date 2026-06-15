-- Enable Supabase Realtime on the workspace_kv table.
--
-- Required for the cloud-first hook pattern (see src/hooks/
-- use-cloud-key-dates.ts and friends) to receive cross-device
-- updates. Without this, a change made on Device B doesn't push
-- to Device A's open page until the user manually refreshes —
-- which defeats the entire point of the migration.
--
-- Idempotent: safe to run repeatedly. If the publication already
-- has the table, the ALTER is a no-op.
--
-- Run this once in the Supabase SQL Editor.

alter publication supabase_realtime add table public.workspace_kv;

-- Same enablement for the per-record tables that hold the high-stakes
-- data. Encounter notes, appointments, and patients all need realtime
-- for the cross-device sync the user has been asking for.
alter publication supabase_realtime add table public.encounter_notes;
alter publication supabase_realtime add table public.schedule_appointments;
alter publication supabase_realtime add table public.patients;

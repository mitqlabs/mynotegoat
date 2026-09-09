-- =====================================================================
-- REPAIR — grant team members access to their owner's data.
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Symptom this fixes: a team member logs in correctly linked to the owner
-- (console: "[membership] linked as member of owner <id>"), the owner has
-- data (e.g. 451 patients), but the member sees an EMPTY workspace.
--
-- Cause: the per-table SQL files (patients_table.sql, workspace_kv_table.sql,
-- encounter_notes_table.sql, schedule_appointments_table.sql,
-- patient_files_table.sql) define OWNER-ONLY select/insert/update/delete
-- policies with the SAME names the team migration uses. If any of those
-- files was re-run after team_members_and_audit.sql, it reverted those
-- tables to "owner only" (split_part(workspace_id,':',1) = auth.uid()),
-- which blocks members. patient_files was never migrated at all.
--
-- This script re-asserts, in one place:
--   1. can_access_owner() — owner OR a NON-disabled member (SECURITY DEFINER)
--   2. wm_select — non-recursive (member reads own row, owner reads all)
--   3. every shared data table's 4 policies keyed on can_access_owner()
-- =====================================================================

-- 1. Access helper: owner, or a member who is not deactivated.
create or replace function public.can_access_owner(owner_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    owner_uid = auth.uid()::text
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_owner_id::text = owner_uid
        and m.member_user_id = auth.uid()
        and coalesce((m.permissions ->> 'disabled')::boolean, false) = false
    );
$$;

-- 2. Non-recursive roster read (never calls can_access_owner).
drop policy if exists "wm_select" on public.workspace_members;
create policy "wm_select" on public.workspace_members for select to authenticated
using (
  workspace_owner_id = auth.uid()
  or member_user_id = auth.uid()
);

-- 3. Data tables — owner OR member, all four verbs.
-- workspace_kv (office settings, macros, prefs, etc.)
drop policy if exists "workspace_kv_select_owner" on public.workspace_kv;
create policy "workspace_kv_select_owner" on public.workspace_kv for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "workspace_kv_insert_owner" on public.workspace_kv;
create policy "workspace_kv_insert_owner" on public.workspace_kv for insert to authenticated
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "workspace_kv_update_owner" on public.workspace_kv;
create policy "workspace_kv_update_owner" on public.workspace_kv for update to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)))
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "workspace_kv_delete_owner" on public.workspace_kv;
create policy "workspace_kv_delete_owner" on public.workspace_kv for delete to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- patients
drop policy if exists "patients_select_owner" on public.patients;
create policy "patients_select_owner" on public.patients for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patients_insert_owner" on public.patients;
create policy "patients_insert_owner" on public.patients for insert to authenticated
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patients_update_owner" on public.patients;
create policy "patients_update_owner" on public.patients for update to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)))
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patients_delete_owner" on public.patients;
create policy "patients_delete_owner" on public.patients for delete to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- encounter_notes
drop policy if exists "enc_notes_select_owner" on public.encounter_notes;
create policy "enc_notes_select_owner" on public.encounter_notes for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "enc_notes_insert_owner" on public.encounter_notes;
create policy "enc_notes_insert_owner" on public.encounter_notes for insert to authenticated
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "enc_notes_update_owner" on public.encounter_notes;
create policy "enc_notes_update_owner" on public.encounter_notes for update to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)))
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "enc_notes_delete_owner" on public.encounter_notes;
create policy "enc_notes_delete_owner" on public.encounter_notes for delete to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- schedule_appointments
drop policy if exists "sched_appts_select_owner" on public.schedule_appointments;
create policy "sched_appts_select_owner" on public.schedule_appointments for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "sched_appts_insert_owner" on public.schedule_appointments;
create policy "sched_appts_insert_owner" on public.schedule_appointments for insert to authenticated
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "sched_appts_update_owner" on public.schedule_appointments;
create policy "sched_appts_update_owner" on public.schedule_appointments for update to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)))
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "sched_appts_delete_owner" on public.schedule_appointments;
create policy "sched_appts_delete_owner" on public.schedule_appointments for delete to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- patient_files (was never migrated — members could not see files)
drop policy if exists "patient_files_select_owner" on public.patient_files;
create policy "patient_files_select_owner" on public.patient_files for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patient_files_insert_owner" on public.patient_files;
create policy "patient_files_insert_owner" on public.patient_files for insert to authenticated
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patient_files_update_owner" on public.patient_files;
create policy "patient_files_update_owner" on public.patient_files for update to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)))
with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "patient_files_delete_owner" on public.patient_files;
create policy "patient_files_delete_owner" on public.patient_files for delete to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- =====================================================================
-- Note Goat — Team members (multi-user) + audit log
-- Run this in the Supabase SQL Editor.
--
-- WHAT THIS DOES
--   1. Adds a `workspace_members` table: the owner (a paying account)
--      can invite staff (front desk, office manager, ...) who then share
--      the owner's workspace data with per-section permissions.
--   2. Adds an `audit_log` table: who did what (deletes, renames,
--      reschedules, ...) so the owner has accountability.
--   3. Adds two SECURITY DEFINER helper functions that answer "can the
--      current user reach this owner's workspace?" — used to rewrite the
--      row-level-security (RLS) policies on every data table + the file
--      bucket so members can reach the OWNER's data and ONLY that owner's.
--
-- SAFETY
--   The owner-access branch of every policy is byte-for-byte the same as
--   before (`split_part(workspace_id, ':', 1) = auth.uid()`), so existing
--   single-user accounts are unaffected. Member access is strictly
--   ADDITIVE. Nothing here grants cross-account access unless a matching
--   workspace_members row exists.
--
--   This migration is idempotent — safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.workspace_members (
  -- The owner's auth uid — matches the prefix of every workspace_id
  -- (`<owner_uid>:<office_id>`) and the top folder of every file path.
  workspace_owner_id uuid not null,
  -- The staff member's auth uid.
  member_user_id uuid not null,
  -- Free-form role label chosen by the owner ("Front Desk", "Office
  -- Manager", ...). Display only.
  label text not null default 'Team Member',
  -- Per-section access levels: { "patients": "edit", "appointments":
  -- "view", ... }. Missing/absent key = no access. Values: view | edit.
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_owner_id, member_user_id)
);

create index if not exists workspace_members_member_idx
  on public.workspace_members(member_user_id);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Owner's workspace this action belongs to (the `<owner_uid>:<office>`
  -- string, or just the owner uid — we match on the prefix).
  workspace_id text not null,
  actor_user_id uuid not null,
  -- Denormalized so the owner can read the log without a users join.
  actor_email text,
  actor_label text,
  -- e.g. "file.delete", "file.rename", "patient.delete",
  -- "appointment.reschedule", "encounter.delete".
  action text not null,
  -- Human-readable target ("X-Ray Report.pdf", patient name, ...).
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_workspace_idx
  on public.audit_log(workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Access helper functions (SECURITY DEFINER so they can read
--    workspace_members without tripping that table's own RLS, and so the
--    data-table policies stay short + consistent).
-- ---------------------------------------------------------------------

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
    );
$$;

create or replace function public.can_access_workspace(wsid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_owner(split_part(wsid, ':', 1));
$$;

-- ---------------------------------------------------------------------
-- 3. RLS on the two new tables
-- ---------------------------------------------------------------------

alter table public.workspace_members enable row level security;
revoke all on table public.workspace_members from anon;
grant select, insert, update, delete on table public.workspace_members to authenticated;

-- Owner manages their own members; a member may read their own row.
drop policy if exists "wm_select" on public.workspace_members;
create policy "wm_select" on public.workspace_members for select to authenticated
using (workspace_owner_id = auth.uid() or member_user_id = auth.uid());

drop policy if exists "wm_insert" on public.workspace_members;
create policy "wm_insert" on public.workspace_members for insert to authenticated
with check (workspace_owner_id = auth.uid());

drop policy if exists "wm_update" on public.workspace_members;
create policy "wm_update" on public.workspace_members for update to authenticated
using (workspace_owner_id = auth.uid())
with check (workspace_owner_id = auth.uid());

drop policy if exists "wm_delete" on public.workspace_members;
create policy "wm_delete" on public.workspace_members for delete to authenticated
using (workspace_owner_id = auth.uid());

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon;
grant select, insert on table public.audit_log to authenticated;

-- Anyone in the workspace may append a log row (as themselves); only the
-- OWNER may read the log. No update/delete grant → append-only.
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert" on public.audit_log for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and public.can_access_workspace(workspace_id)
);

drop policy if exists "audit_select_owner" on public.audit_log;
create policy "audit_select_owner" on public.audit_log for select to authenticated
using (split_part(workspace_id, ':', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 4. Rewrite data-table policies: owner OR member (via helper).
--    Same 4 verbs per table, all keyed on can_access_owner(prefix).
-- ---------------------------------------------------------------------

-- workspace_kv
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

-- ---------------------------------------------------------------------
-- 5. Storage bucket: files live under `<owner_uid>/...`, so match the
--    first path segment against can_access_owner.
-- ---------------------------------------------------------------------

drop policy if exists "user_files_select_own" on storage.objects;
create policy "user_files_select_own" on storage.objects for select to authenticated
using (bucket_id = 'user-files' and public.can_access_owner((storage.foldername(name))[1]));

drop policy if exists "user_files_insert_own" on storage.objects;
create policy "user_files_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'user-files' and public.can_access_owner((storage.foldername(name))[1]));

drop policy if exists "user_files_update_own" on storage.objects;
create policy "user_files_update_own" on storage.objects for update to authenticated
using (bucket_id = 'user-files' and public.can_access_owner((storage.foldername(name))[1]))
with check (bucket_id = 'user-files' and public.can_access_owner((storage.foldername(name))[1]));

drop policy if exists "user_files_delete_own" on storage.objects;
create policy "user_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'user-files' and public.can_access_owner((storage.foldername(name))[1]));

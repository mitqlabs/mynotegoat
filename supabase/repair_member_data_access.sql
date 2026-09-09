-- =====================================================================
-- REPAIR — grant team members access to their owner's data.
-- Run this in the Supabase SQL Editor. Idempotent + resilient: safe to
-- re-run, and it SKIPS any table that doesn't exist (so a missing
-- patient_files table can't abort the whole script).
--
-- Symptom this fixes: a team member logs in correctly linked to the owner
-- ("[membership] linked as member of owner <id>"), the owner has data,
-- but the member sees an EMPTY workspace.
--
-- Cause: per-table SQL files define OWNER-ONLY policies with the same
-- names as the team migration; re-running any of them reverted those
-- tables to owner-only, blocking members.
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

-- 3. Re-assert owner-OR-member policies on every shared data table.
--    Each table is guarded: if it doesn't exist, it's skipped.
do $do$
declare
  t text;
  pfx text;
  tables text[] := array[
    'workspace_kv', 'patients', 'encounter_notes',
    'schedule_appointments', 'patient_files'
  ];
  prefixes text[] := array[
    'workspace_kv', 'patients', 'enc_notes',
    'sched_appts', 'patient_files'
  ];
  i int;
  cond text := 'public.can_access_owner(split_part(workspace_id, '':'', 1))';
begin
  for i in 1 .. array_length(tables, 1) loop
    t := tables[i];
    pfx := prefixes[i];
    if to_regclass('public.' || t) is null then
      raise notice 'skipping % (table not present)', t;
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', pfx || '_select_owner', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      pfx || '_select_owner', t, cond);

    execute format('drop policy if exists %I on public.%I', pfx || '_insert_owner', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      pfx || '_insert_owner', t, cond);

    execute format('drop policy if exists %I on public.%I', pfx || '_update_owner', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      pfx || '_update_owner', t, cond, cond);

    execute format('drop policy if exists %I on public.%I', pfx || '_delete_owner', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      pfx || '_delete_owner', t, cond);

    raise notice 'repaired policies on %', t;
  end loop;
end
$do$;

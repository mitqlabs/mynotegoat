-- =====================================================================
-- Note Goat — Deactivate a team member (block login) without deleting.
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- A member the owner switches to "Off" (Settings → Team → Active) keeps
-- their record and settings but must no longer reach any workspace data.
-- The app already blocks them at login; this tightens the SAME rule at
-- the database level, so a deactivated member can't read/write even via
-- the API. We do it by teaching can_access_owner() to ignore a member row
-- whose permissions carry `"disabled": true`.
-- =====================================================================

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

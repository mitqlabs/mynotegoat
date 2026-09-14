-- =====================================================================
-- Note Goat — Activity Log (Dashboard).
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Builds on public.audit_log (team_members_and_audit.sql):
--   * adds category + patient columns so the Dashboard can filter
--     (e.g. "Billing only") and show which patient an entry is about;
--   * lets OFFICE ADMINS read the log, not just the owner;
--   * lets the owner / office admins clear old entries, so the log can be
--     emptied by hand or auto-deleted after the retention period. The one
--     entry type that can never be deleted is "log.cleared" — the record
--     of who cleared the log — so clearing can't be used to hide anything.
-- Anyone in the workspace can still append entries (as themselves).
-- =====================================================================

alter table public.audit_log
  add column if not exists category text not null default '',
  add column if not exists patient_id text not null default '',
  add column if not exists patient_name text not null default '';

create index if not exists audit_log_category_idx
  on public.audit_log(workspace_id, category, created_at desc);

-- Owner, or an active member flagged officeAdmin in their permissions.
create or replace function public.is_workspace_admin(owner_uid text)
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
        and coalesce((m.permissions ->> 'officeAdmin')::boolean, false) = true
        and coalesce((m.permissions ->> 'disabled')::boolean, false) = false
    );
$$;

grant select, insert, delete on table public.audit_log to authenticated;

drop policy if exists "audit_select_owner" on public.audit_log;
drop policy if exists "audit_select_admin" on public.audit_log;
create policy "audit_select_admin" on public.audit_log for select to authenticated
using (public.is_workspace_admin(split_part(workspace_id, ':', 1)));

drop policy if exists "audit_delete_admin" on public.audit_log;
create policy "audit_delete_admin" on public.audit_log for delete to authenticated
using (
  public.is_workspace_admin(split_part(workspace_id, ':', 1))
  and action <> 'log.cleared'
);

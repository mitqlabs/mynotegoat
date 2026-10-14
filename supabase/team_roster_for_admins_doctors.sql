-- =====================================================================
-- Team Members list for office admins and doctors (additive, idempotent).
--
-- Before: wm_select let a member read only their OWN workspace_members row,
-- so a doctor / office-admin login saw an empty Team Members list.
--
-- This adds ONE extra SELECT policy (policies are OR'd, so nothing that works
-- today changes). It lets a member read the roster of the workspace they
-- belong to, and only that workspace, when they are:
--   * an office admin (permissions.officeAdmin = true or roleTier = 'admin'), or
--   * on that office's doctor list (office settings doctors[].memberUserId).
-- Disabled members get nothing extra. Insert / update / delete are untouched
-- (still owner-only). The check runs in a SECURITY DEFINER function so the
-- policy never queries workspace_members under RLS (no recursion).
-- =====================================================================

create or replace function public.can_view_team_roster(owner_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_owner_id = owner_uid
      and m.member_user_id = auth.uid()
      and coalesce((m.permissions ->> 'disabled')::boolean, false) = false
      and (
        coalesce((m.permissions ->> 'officeAdmin')::boolean, false) = true
        or coalesce(m.permissions ->> 'roleTier', '') = 'admin'
        or exists (
          select 1 from public.workspace_kv k
          where k.workspace_id = owner_uid::text || ':main-office'
            and k.key = 'casemate.office-settings.v1'
            and jsonb_typeof(k.value -> 'doctors') = 'array'
            and exists (
              select 1 from jsonb_array_elements(k.value -> 'doctors') d
              where d ->> 'memberUserId' = auth.uid()::text
            )
        )
      )
  );
$$;

revoke all on function public.can_view_team_roster(uuid) from public;
grant execute on function public.can_view_team_roster(uuid) to authenticated;

drop policy if exists "wm_select_roster" on public.workspace_members;
create policy "wm_select_roster" on public.workspace_members for select to authenticated
using (public.can_view_team_roster(workspace_owner_id));

-- ---------------------------------------------------------------------
-- Roster for messaging / @mentions / G.O.A.T. "tell Hannah" / signatures.
-- Any active login of a workspace (owner or member) gets the names of the
-- people in THAT workspace only: user id, label (name) and email. No
-- permissions. The workspace is derived from auth.uid() on the server, so a
-- caller can't ask for another office's roster.
-- ---------------------------------------------------------------------
create or replace function public.workspace_team_roster()
returns table (member_user_id uuid, label text, email text, owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select coalesce(
      (select m.workspace_owner_id from public.workspace_members m
        where m.member_user_id = auth.uid()
          and coalesce((m.permissions ->> 'disabled')::boolean, false) = false
        limit 1),
      case when not exists (select 1 from public.workspace_members x where x.member_user_id = auth.uid()) then auth.uid() end
    ) as owner_id
  )
  select m.member_user_id, m.label, m.email, me.owner_id
  from me join public.workspace_members m on m.workspace_owner_id = me.owner_id
  where auth.uid() is not null;
$$;

revoke all on function public.workspace_team_roster() from public;
grant execute on function public.workspace_team_roster() to authenticated;

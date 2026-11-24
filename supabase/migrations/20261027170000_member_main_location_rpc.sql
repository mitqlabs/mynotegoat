-- =====================================================================
-- Let office Admins (not just the owner) set a team member's MAIN LOCATION.
--
-- Why: workspace_members UPDATE is owner-only (policy wm_update). When an Admin
-- member (e.g. roleTier = 'admin' / officeAdmin = true) changed a member's main
-- location, the database silently refused it (0 rows, no error), so it looked
-- saved but reverted on the next reload.
--
-- Rather than widen wm_update (which would let an Admin rewrite ANY permission,
-- including promoting themselves), this adds ONE narrow SECURITY DEFINER function
-- that can change ONLY permissions->'mainLocationId', and only when the caller is
--   * the workspace owner, or
--   * an active (not disabled) member of that workspace who is an Admin
--     (permissions.officeAdmin = true or permissions.roleTier = 'admin').
-- The target must be a member row of that same workspace. Nothing else changes.
--
-- Idempotent. NOT applied automatically: run it in the Supabase SQL editor or
-- via the migration pipeline after review.
-- =====================================================================

create or replace function public.set_member_main_location(target_member uuid, location_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  loc text := nullif(btrim(coalesce(location_id, '')), '');
  new_perms jsonb;
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if loc is not null and (length(loc) > 100 or loc ~ '[[:cntrl:]]') then
    raise exception 'Invalid location' using errcode = '22023';
  end if;

  update public.workspace_members m
     set permissions = case
           when loc is null then m.permissions - 'mainLocationId'
           else jsonb_set(m.permissions, '{mainLocationId}', to_jsonb(loc), true)
         end,
         updated_at = now()
   where m.member_user_id = target_member
     and (
       m.workspace_owner_id = caller
       or exists (
         select 1 from public.workspace_members me
          where me.workspace_owner_id = m.workspace_owner_id
            and me.member_user_id = caller
            and coalesce((me.permissions ->> 'disabled')::boolean, false) = false
            and (
              coalesce((me.permissions ->> 'officeAdmin')::boolean, false) = true
              or coalesce(me.permissions ->> 'roleTier', '') = 'admin'
            )
       )
     )
  returning m.permissions into new_perms;

  if new_perms is null then
    raise exception 'Only the owner or an Admin can change a main location' using errcode = '42501';
  end if;
  return new_perms;
end;
$$;

revoke all on function public.set_member_main_location(uuid, text) from public, anon;
grant execute on function public.set_member_main_location(uuid, text) to authenticated;

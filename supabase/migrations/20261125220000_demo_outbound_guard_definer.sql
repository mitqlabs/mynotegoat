-- Cancel on Recent messages was refused (SQLSTATE 42501 / HTTP 403).
--
-- demo_outbound_blocked() runs before every insert or update on
-- reminder_broadcasts and reminder_broadcast_recipients. It reads
-- demo_workspace_lock, which authenticated cannot select. The function
-- was not security definer, so that read ran as the signed-in office
-- user, the update aborted, and Cancel left the broadcast queued.
--
-- Run the function as its owner, which can read the lock table. Do not
-- grant that table to authenticated. The demo office is still blocked.
-- Other offices can cancel and queue messages again.
--
-- Not applied by this change. Apply it in the Supabase SQL editor or the
-- migration pipeline after review. Do not use it to edit an existing
-- broadcast row.

create or replace function public.demo_outbound_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  locked text;
begin
  select workspace_id into locked from public.demo_workspace_lock where id = 1;
  if locked is not null and new.workspace_id = locked then
    raise exception 'Demo: not sent';
  end if;
  return new;
end;
$$;

create or replace function public.demo_member_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  locked text;
  demo_user text;
begin
  select workspace_id into locked from public.demo_workspace_lock where id = 1;
  if locked is null then
    return new;
  end if;
  demo_user := split_part(locked, ':', 1);
  if new.workspace_owner_id::text = demo_user or new.member_user_id::text = demo_user then
    raise exception 'Demo office cannot join or invite';
  end if;
  return new;
end;
$$;

create or replace function public.demo_admin_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  locked text;
  demo_user text;
begin
  select workspace_id into locked from public.demo_workspace_lock where id = 1;
  if locked is null then
    return new;
  end if;
  demo_user := split_part(locked, ':', 1);
  if new.user_id::text = demo_user and coalesce(new.is_admin, false) then
    raise exception 'Demo office cannot be an admin';
  end if;
  return new;
end;
$$;

revoke all on function public.demo_outbound_blocked() from public, anon;
revoke all on function public.demo_member_blocked() from public, anon;
revoke all on function public.demo_admin_blocked() from public, anon;
grant execute on function public.demo_outbound_blocked() to authenticated;
grant execute on function public.demo_member_blocked() to authenticated;
grant execute on function public.demo_admin_blocked() to authenticated;

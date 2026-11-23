-- Demo office guard.
--
-- Does not read or change any real office's rows. It adds one empty lock
-- table and triggers. The lock row is written later by scripts/seed-demo.ts
-- (the demo workspace id only). Until that row exists, these triggers do nothing.
--
-- Apply this in the Supabase SQL editor for the demo project before the first
-- reseed. Do not run it as part of a production data fix.

create table if not exists public.demo_workspace_lock (
  id integer primary key check (id = 1),
  workspace_id text not null check (
    workspace_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:demo-office$'
  )
);

alter table public.demo_workspace_lock enable row level security;
revoke all on table public.demo_workspace_lock from anon, authenticated;

create or replace function public.demo_outbound_blocked()
returns trigger
language plpgsql
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

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'reminder_devices',
    'reminder_broadcasts',
    'reminder_broadcast_recipients',
    'reminder_log',
    'birthday_text_log',
    'goat_mail_connections',
    'patient_form_requests'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists demo_outbound_%I on public.%I', tbl, tbl);
      execute format(
        'create trigger demo_outbound_%I before insert or update on public.%I for each row execute function public.demo_outbound_blocked()',
        tbl, tbl
      );
    end if;
  end loop;
  if to_regclass('public.workspace_members') is not null then
    drop trigger if exists demo_member_blocked on public.workspace_members;
    create trigger demo_member_blocked
      before insert or update on public.workspace_members
      for each row execute function public.demo_member_blocked();
  end if;
  if to_regclass('public.account_profiles') is not null then
    drop trigger if exists demo_admin_blocked on public.account_profiles;
    create trigger demo_admin_blocked
      before insert or update on public.account_profiles
      for each row execute function public.demo_admin_blocked();
  end if;
end $$;

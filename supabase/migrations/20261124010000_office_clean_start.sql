-- Clean-start flag for offices created after this migration.
-- Existing account_profiles rows stay clean_start = false (the column
-- default). The signup trigger sets true only on a new auth user.
-- This file is not applied by the change that added it.

alter table public.account_profiles
  add column if not exists clean_start boolean not null default false;

comment on column public.account_profiles.clean_start is
  'True only for accounts created after clean start shipped. Existing rows stay false. Decides blank defaults; not a date cutoff.';

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_profiles (user_id, email, approval_status, clean_start)
  values (new.id, coalesce(new.email, ''), 'pending', true)
  on conflict (user_id)
  do update set email = excluded.email;

  return new;
end;
$$;

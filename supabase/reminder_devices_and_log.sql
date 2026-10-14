-- Automatic text reminders: sending devices + send log. ADDITIVE ONLY.
-- A device (e.g. the office iMac) authenticates with a random token; only
-- its SHA-256 hash is stored. The device API runs server-side with the
-- service role and scopes every query to the device's workspace_id.

create table if not exists public.reminder_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null default 'Office Mac',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_run_at timestamptz,
  last_run_summary text,
  revoked_at timestamptz
);
create index if not exists reminder_devices_workspace_idx on public.reminder_devices(workspace_id);

create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  device_id uuid references public.reminder_devices(id) on delete set null,
  appointment_id text not null,
  visit_date text not null,
  phone_last4 text not null default '',
  status text not null check (status in ('sent', 'failed', 'dry-run')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists reminder_log_workspace_created_idx on public.reminder_log(workspace_id, created_at desc);
-- Duplicate prevention: one successful send per appointment per visit date.
create unique index if not exists reminder_log_one_sent_uidx
  on public.reminder_log(workspace_id, appointment_id, visit_date)
  where status = 'sent';

-- Patient opt-out ("no text reminders") was browser-only; the server
-- queue needs it. Nullable, defaults false.
alter table public.patients add column if not exists text_reminders_off boolean not null default false;

alter table public.reminder_devices enable row level security;
alter table public.reminder_log enable row level security;
revoke all on table public.reminder_devices from anon;
revoke all on table public.reminder_log from anon;
grant select, insert, update on table public.reminder_devices to authenticated;
grant select on table public.reminder_log to authenticated;

drop policy if exists "reminder_devices_select_owner" on public.reminder_devices;
create policy "reminder_devices_select_owner" on public.reminder_devices for select to authenticated
  using (split_part(workspace_id, ':', 1) = auth.uid()::text);
drop policy if exists "reminder_devices_insert_owner" on public.reminder_devices;
create policy "reminder_devices_insert_owner" on public.reminder_devices for insert to authenticated
  with check (split_part(workspace_id, ':', 1) = auth.uid()::text);
drop policy if exists "reminder_devices_update_owner" on public.reminder_devices;
create policy "reminder_devices_update_owner" on public.reminder_devices for update to authenticated
  using (split_part(workspace_id, ':', 1) = auth.uid()::text)
  with check (split_part(workspace_id, ':', 1) = auth.uid()::text);

drop policy if exists "reminder_log_select_owner" on public.reminder_log;
create policy "reminder_log_select_owner" on public.reminder_log for select to authenticated
  using (split_part(workspace_id, ':', 1) = auth.uid()::text);

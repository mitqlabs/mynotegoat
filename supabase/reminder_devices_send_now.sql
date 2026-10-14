-- Text reminders: device kind (Mac / iPhone) and "Send Now" requests. ADDITIVE ONLY.
alter table public.reminder_devices add column if not exists kind text not null default 'mac';
alter table public.reminder_devices add column if not exists run_requested_until timestamptz;

-- Primary / backup sender.
alter table public.reminder_devices add column if not exists is_primary boolean not null default false;

-- Per-device leases so two devices (iPhone primary, Mac backup) never send
-- the same reminder. A device only gets items it managed to claim.
create table if not exists public.reminder_claims (
  workspace_id text not null,
  appointment_id text not null,
  visit_date text not null,
  device_id uuid not null references public.reminder_devices(id) on delete cascade,
  claimed_until timestamptz not null,
  primary key (workspace_id, appointment_id, visit_date)
);
alter table public.reminder_claims enable row level security;
revoke all on table public.reminder_claims from anon;
revoke all on table public.reminder_claims from authenticated;

-- Atomically claim the given appointments for one device. Returns the ids
-- this device now holds (new, expired, or already its own).
create or replace function public.claim_reminders(
  p_workspace_id text,
  p_device_id uuid,
  p_visit_date text,
  p_appointment_ids text[],
  p_minutes integer
) returns setof text
language sql
security definer
set search_path = public
as $$
  insert into public.reminder_claims as c (workspace_id, appointment_id, visit_date, device_id, claimed_until)
  select p_workspace_id, id, p_visit_date, p_device_id, now() + make_interval(mins => p_minutes)
  from unnest(p_appointment_ids) as id
  on conflict (workspace_id, appointment_id, visit_date) do update
    set device_id = excluded.device_id, claimed_until = excluded.claimed_until
    where c.claimed_until < now() or c.device_id = excluded.device_id
  returning appointment_id;
$$;
revoke all on function public.claim_reminders(text, uuid, text, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_reminders(text, uuid, text, text[], integer) to service_role;

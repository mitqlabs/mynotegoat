-- Opt-out by reply ("STOP"). ADDITIVE ONLY.
-- The sending device forwards STOP / START replies to /api/reminders/inbound,
-- which flips patients.text_reminders_off (the flag the queue already
-- respects) and logs the change here. No message text or full phone number
-- is stored. Rows are written by the server (service role) or by staff
-- re-enabling a patient from Settings › Text Reminders.

create table if not exists public.reminder_opt_outs (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  patient_id text not null,
  action text not null check (action in ('stop', 'start')),
  phone_last4 text not null default '',
  source text not null default 'staff' check (source in ('mac', 'iphone', 'staff')),
  device_id uuid references public.reminder_devices(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists reminder_opt_outs_workspace_idx
  on public.reminder_opt_outs(workspace_id, created_at desc);

alter table public.reminder_opt_outs enable row level security;
revoke all on table public.reminder_opt_outs from anon;
grant select, insert on table public.reminder_opt_outs to authenticated;

drop policy if exists "reminder_opt_outs_select" on public.reminder_opt_outs;
create policy "reminder_opt_outs_select" on public.reminder_opt_outs for select to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)));
-- Staff can only log a re-enable (opt back in) by hand.
drop policy if exists "reminder_opt_outs_insert" on public.reminder_opt_outs;
create policy "reminder_opt_outs_insert" on public.reminder_opt_outs for insert to authenticated
  with check (public.can_access_owner(split_part(workspace_id, ':', 1)) and source = 'staff' and action = 'start');

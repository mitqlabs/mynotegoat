-- "Message patients" (emergency / closure texts). ADDITIVE ONLY.
-- Office staff queue a message for the patients booked on one day; the
-- office's sending device (iPhone Shortcut / iMac) picks the texts up from
-- /api/reminders/queue and reports back through /api/reminders/ack.
-- Phones are NOT copied here: the server reads them from patients at send time.

create table if not exists public.reminder_broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  message text not null check (char_length(message) between 1 and 640),
  target_date text not null check (target_date ~ '^\d{4}-\d{2}-\d{2}$'),
  exclude_canceled boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  canceled_at timestamptz
);
create index if not exists reminder_broadcasts_workspace_idx
  on public.reminder_broadcasts(workspace_id, created_at desc);

create table if not exists public.reminder_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.reminder_broadcasts(id) on delete cascade,
  workspace_id text not null,
  patient_id text not null,
  appointment_id text,
  phone_last4 text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'dry-run', 'canceled')),
  device_id uuid references public.reminder_devices(id) on delete set null,
  claimed_by uuid references public.reminder_devices(id) on delete set null,
  claimed_until timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (broadcast_id, patient_id)
);
create index if not exists reminder_broadcast_recipients_queue_idx
  on public.reminder_broadcast_recipients(workspace_id, status);

alter table public.reminder_broadcasts enable row level security;
alter table public.reminder_broadcast_recipients enable row level security;
revoke all on table public.reminder_broadcasts from anon;
revoke all on table public.reminder_broadcast_recipients from anon;
grant select, insert, update on table public.reminder_broadcasts to authenticated;
grant select, insert, update on table public.reminder_broadcast_recipients to authenticated;

-- Owner or active team member of the workspace (same helper as other tables).
drop policy if exists "reminder_broadcasts_select" on public.reminder_broadcasts;
create policy "reminder_broadcasts_select" on public.reminder_broadcasts for select to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "reminder_broadcasts_insert" on public.reminder_broadcasts;
create policy "reminder_broadcasts_insert" on public.reminder_broadcasts for insert to authenticated
  with check (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "reminder_broadcasts_update" on public.reminder_broadcasts;
create policy "reminder_broadcasts_update" on public.reminder_broadcasts for update to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)))
  with check (public.can_access_owner(split_part(workspace_id, ':', 1)));

drop policy if exists "reminder_broadcast_recipients_select" on public.reminder_broadcast_recipients;
create policy "reminder_broadcast_recipients_select" on public.reminder_broadcast_recipients for select to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)));
drop policy if exists "reminder_broadcast_recipients_insert" on public.reminder_broadcast_recipients;
create policy "reminder_broadcast_recipients_insert" on public.reminder_broadcast_recipients for insert to authenticated
  with check (public.can_access_owner(split_part(workspace_id, ':', 1)) and status = 'queued');
-- Staff may only cancel queued texts; devices update via the service role.
drop policy if exists "reminder_broadcast_recipients_cancel" on public.reminder_broadcast_recipients;
create policy "reminder_broadcast_recipients_cancel" on public.reminder_broadcast_recipients for update to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)) and status = 'queued')
  with check (public.can_access_owner(split_part(workspace_id, ':', 1)) and status = 'canceled');

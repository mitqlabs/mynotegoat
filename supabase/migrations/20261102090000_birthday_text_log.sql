-- Daily birthday texts. ADDITIVE ONLY (one new table, nothing else touched).
-- During the office's daily reminder run, /api/reminders/queue hands the
-- sending device a birthday text for every active patient whose birthday is
-- today. This table is the "already texted" record: one row per patient per
-- year (the unique key), so nobody gets two birthday texts in a year even if
-- two devices or two runs ask at once.
-- Rows are written only by the server (service role). Staff can read them
-- (Settings > Text Reminders > Birthday texts shows the recent ones).
-- No message text and no full phone number is stored: only the last 4 digits.
-- If this table is missing the queue sends NO birthday texts (it never sends
-- without being able to record it).

create table if not exists public.birthday_text_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  patient_id text not null,
  year integer not null check (year between 2000 and 2200),
  -- claimed = handed to a device, waiting for its answer (never handed out again)
  -- sent / failed = the device's answer; failed may be tried again (see attempts)
  -- dry-run = test mode wrote it; a real send replaces it
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'dry-run')),
  attempts integer not null default 1,
  phone_last4 text not null default '',
  device_id uuid references public.reminder_devices(id) on delete set null,
  error text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, patient_id, year)
);
create index if not exists birthday_text_log_workspace_idx
  on public.birthday_text_log(workspace_id, created_at desc);

alter table public.birthday_text_log enable row level security;
revoke all on table public.birthday_text_log from anon;
grant select on table public.birthday_text_log to authenticated;

drop policy if exists "birthday_text_log_select" on public.birthday_text_log;
create policy "birthday_text_log_select" on public.birthday_text_log for select to authenticated
  using (public.can_access_owner(split_part(workspace_id, ':', 1)));

-- A new shortcut code is stored beside the one already on the phone.
-- The old code stays valid until the new one is used once.
-- Not applied to production by this change.

alter table public.reminder_devices add column if not exists pending_token_hash text;
alter table public.reminder_devices add column if not exists retired_token_hash text;
alter table public.reminder_devices add column if not exists last_rejected_at timestamptz;
alter table public.reminder_devices add column if not exists last_rejected_reason text;

create unique index if not exists reminder_devices_pending_token_uidx
  on public.reminder_devices (pending_token_hash)
  where pending_token_hash is not null;

create unique index if not exists reminder_devices_retired_token_uidx
  on public.reminder_devices (retired_token_hash)
  where retired_token_hash is not null;

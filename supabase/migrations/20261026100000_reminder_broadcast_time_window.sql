-- "Message patients" time window. ADDITIVE ONLY; apply after
-- 20261026090000_reminder_broadcasts.sql. Optional "HH:MM" bounds: only
-- visits at/after start_time (and before end_time) are texted. The server
-- also skips visits already past when the target date is today.
alter table public.reminder_broadcasts
  add column if not exists start_time text check (start_time is null or start_time ~ '^\d{2}:\d{2}$'),
  add column if not exists end_time text check (end_time is null or end_time ~ '^\d{2}:\d{2}$');

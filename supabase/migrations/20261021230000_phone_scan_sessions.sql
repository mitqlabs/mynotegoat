-- =====================================================================
-- Phone hand-off scanning (Patient Files → Scan → "Scan with my phone").
-- Idempotent. Server routes use the service-role key; nobody else can
-- read or write this table (RLS on, no policies, anon/authenticated revoked).
--
--  * token_hash = sha256("scan:" + token). The token itself is never stored.
--  * A link works for 10 minutes and only until one PDF is sent.
--  * The PDF waits in the private user-files bucket at phone-scan/<id>.pdf
--    (service role only; existing user-files policies only allow a user's
--    own <uid>/… folder, so no signed-in user can list or read these),
--    and is deleted as soon as the desktop files it, cancels, or it times out.
-- =====================================================================

create table if not exists public.phone_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_id uuid not null,
  workspace_id text not null,
  patient_id text not null,
  folder_id text not null,
  label text not null default '',
  status text not null default 'waiting'
    check (status in ('waiting', 'uploaded', 'saved', 'revoked')),
  page_count int,
  expires_at timestamptz not null,
  uploaded_at timestamptz,
  saved_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists phone_scan_sessions_creator_idx
  on public.phone_scan_sessions (created_by, status);

alter table public.phone_scan_sessions enable row level security;
revoke all on public.phone_scan_sessions from anon, authenticated;

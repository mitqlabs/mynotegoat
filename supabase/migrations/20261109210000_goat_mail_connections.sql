-- GOAT Mail keeps the Microsoft refresh token on the server.
-- Row level security is on and there are no policies, so a signed-in
-- browser cannot read or write this table. The API uses the service role.
-- GOAT Mail only requests Mail.Read. It never sends, deletes, or changes mail.

create table if not exists public.goat_mail_connections (
  workspace_id text primary key,
  refresh_token text not null,
  account_email text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.goat_mail_connections enable row level security;

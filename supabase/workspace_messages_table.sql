-- =====================================================================
-- Note Goat — Team Messages (Slack-style shared feed)
-- Run this in the Supabase SQL Editor.
--
-- A single shared feed per workspace. Any member of the workspace (owner
-- + team members, gated in-app by the "messages" permission) can post,
-- optionally tag a patient/case, and @mention teammates. Realtime so new
-- messages appear live.
--
-- Uses can_access_owner() (from team_members_and_audit.sql) so team
-- members can read/post in their owner's feed — run that migration first.
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists public.workspace_messages (
  id text not null,
  workspace_id text not null,
  author_user_id uuid not null,
  author_label text not null default '',
  body text not null default '',
  -- Tagged case (optional).
  patient_id text not null default '',
  patient_name text not null default '',
  -- @mentions: [{ "userId": "...", "label": "..." }, ...]
  mentions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists workspace_messages_ws_created_idx
  on public.workspace_messages(workspace_id, created_at desc);
create index if not exists workspace_messages_ws_patient_idx
  on public.workspace_messages(workspace_id, patient_id);

alter table public.workspace_messages enable row level security;
revoke all on table public.workspace_messages from anon;
revoke all on table public.workspace_messages from authenticated;
grant select, insert, delete on table public.workspace_messages to authenticated;

-- Anyone in the workspace may read the feed and post (as themselves).
drop policy if exists "wsm_select" on public.workspace_messages;
create policy "wsm_select" on public.workspace_messages for select to authenticated
using (public.can_access_owner(split_part(workspace_id, ':', 1)));

drop policy if exists "wsm_insert" on public.workspace_messages;
create policy "wsm_insert" on public.workspace_messages for insert to authenticated
with check (
  author_user_id = auth.uid()
  and public.can_access_owner(split_part(workspace_id, ':', 1))
);

-- A member may delete their OWN message; the owner may delete any.
drop policy if exists "wsm_delete" on public.workspace_messages;
create policy "wsm_delete" on public.workspace_messages for delete to authenticated
using (
  author_user_id = auth.uid()
  or split_part(workspace_id, ':', 1) = auth.uid()::text
);

-- Realtime.
do $$
begin
  begin
    alter publication supabase_realtime add table public.workspace_messages;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------
-- NOTE: an earlier version of this file widened wm_select to call
-- can_access_owner() so members could read the full roster for @mentions.
-- That RECURSED (can_access_owner reads workspace_members) and locked
-- members out of all data. Do NOT reintroduce that. wm_select stays the
-- original non-recursive rule (see supabase/fix_member_access_recursion.sql):
--   using (workspace_owner_id = auth.uid() or member_user_id = auth.uid())
-- The @mention roster falls back to the owner + self for a member view.
-- ---------------------------------------------------------------------

-- =====================================================================
-- Note Goat — Eyes Only messages + delete a whole thread.
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- 1. Eyes Only: a message can be private to a list of people
--    (visible_to). The database itself hides it from everyone else —
--    including the workspace owner and office admins, by design. Replies
--    in a private thread carry the same visible_to.
-- 2. Threads: every message records the root of its reply chain
--    (thread_root_id), so the person who started a thread can delete the
--    whole thread, replies from other people included.
-- =====================================================================

alter table public.workspace_messages
  add column if not exists thread_root_id text not null default '',
  add column if not exists is_private boolean not null default false,
  add column if not exists visible_to uuid[] not null default '{}';

-- Backfill thread_root_id for existing messages by walking reply chains.
-- Replies whose parent was already deleted keep '' and act as their own root.
with recursive chain as (
  select workspace_id, id, id as root
  from public.workspace_messages
  where reply_to_id = ''
  union all
  select m.workspace_id, m.id, c.root
  from public.workspace_messages m
  join chain c on m.workspace_id = c.workspace_id and m.reply_to_id = c.id
)
update public.workspace_messages w
set thread_root_id = c.root
from chain c
where w.workspace_id = c.workspace_id
  and w.id = c.id
  and w.thread_root_id = '';

create index if not exists workspace_messages_thread_idx
  on public.workspace_messages(workspace_id, thread_root_id);

-- Is the current user the author of this thread's root message?
-- SECURITY DEFINER so the delete policy can look up the root row without
-- re-entering RLS on the same table (avoids policy recursion).
create or replace function public.is_message_thread_starter(ws text, root_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_messages r
    where r.workspace_id = ws
      and r.id = root_id
      and r.author_user_id = auth.uid()
  );
$$;

-- Read: everyone in the workspace sees normal messages; Eyes Only
-- messages are visible ONLY to the people listed (the author is always
-- included by the app, and allowed here as a safety net).
drop policy if exists "wsm_select" on public.workspace_messages;
create policy "wsm_select" on public.workspace_messages for select to authenticated
using (
  public.can_access_owner(split_part(workspace_id, ':', 1))
  and (
    not is_private
    or author_user_id = auth.uid()
    or auth.uid() = any(visible_to)
  )
);

-- Post: as yourself, and a private message must include you.
drop policy if exists "wsm_insert" on public.workspace_messages;
create policy "wsm_insert" on public.workspace_messages for insert to authenticated
with check (
  author_user_id = auth.uid()
  and public.can_access_owner(split_part(workspace_id, ':', 1))
  and (not is_private or auth.uid() = any(visible_to))
);

-- Delete: your own message; the owner may delete any; the person who
-- started a thread may delete every message in it.
drop policy if exists "wsm_delete" on public.workspace_messages;
create policy "wsm_delete" on public.workspace_messages for delete to authenticated
using (
  author_user_id = auth.uid()
  or split_part(workspace_id, ':', 1) = auth.uid()::text
  or (
    thread_root_id <> ''
    and public.is_message_thread_starter(workspace_id, thread_root_id)
  )
);

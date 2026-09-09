-- =====================================================================
-- Note Goat — Message replies (quote-reply in the team feed).
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Adds reply metadata to workspace_messages so a message can quote the
-- one it's replying to (author + short excerpt), Slack-style. Stored
-- inline (denormalized) so rendering never needs a second lookup.
-- =====================================================================

alter table public.workspace_messages
  add column if not exists reply_to_id text not null default '',
  add column if not exists reply_to_author text not null default '',
  add column if not exists reply_to_excerpt text not null default '';

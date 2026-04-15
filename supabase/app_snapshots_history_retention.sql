-- ============================================================================
-- App Snapshots History: Automatic Retention Policy
-- ============================================================================
-- On 2026-04-14 the `app_snapshots_history` table grew to 1.4 GB (3,165 rows)
-- with no retention policy. Every autosave wrote a full ~400 KB snapshot copy,
-- and with the `encounterNotes` flag flipped to `true` the blob started
-- shrinking as entities migrated to dedicated tables — which tripped the
-- destructive-write guard on every save, logging a rejection row to history
-- AND blocking the write. Result: 1.4 GB of redundant backups and a
-- database that ran out of resources.
--
-- This migration adds a retention trigger: after each insert into
-- `app_snapshots_history`, delete the oldest rows for that workspace so only
-- the most recent N remain. Self-maintaining, per-workspace, no pg_cron
-- required.
--
-- Default retention: 50 rows per workspace. Tune via the `keep` parameter
-- at the top of the function if you need longer/shorter history.
--
-- Run this in the Supabase SQL Editor. Safe to run repeatedly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Retention trigger function
-- ----------------------------------------------------------------------------
-- Runs AFTER INSERT on app_snapshots_history. Deletes any rows belonging to
-- the same workspace beyond the most recent `keep` count. `security definer`
-- so it can bypass the RLS policies (history is read-only to users; only
-- triggers can mutate it).
create or replace function public.prune_app_snapshots_history_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keep constant int := 50;  -- rows retained per workspace
begin
  delete from public.app_snapshots_history
  where workspace_id = NEW.workspace_id
    and id not in (
      select id
      from public.app_snapshots_history
      where workspace_id = NEW.workspace_id
      order by recorded_at desc
      limit keep
    );
  return null;  -- AFTER trigger, result ignored
end;
$$;

drop trigger if exists app_snapshots_history_prune on public.app_snapshots_history;
create trigger app_snapshots_history_prune
  after insert on public.app_snapshots_history
  for each row execute function public.prune_app_snapshots_history_row();

-- ----------------------------------------------------------------------------
-- One-time cleanup: trim any existing workspace to the retention limit NOW.
-- The trigger only runs on future inserts; this catches anything already
-- piled up. Idempotent — running it twice is a no-op.
-- ----------------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (partition by workspace_id order by recorded_at desc) as rn
  from public.app_snapshots_history
)
delete from public.app_snapshots_history
where id in (select id from ranked where rn > 50);

-- ----------------------------------------------------------------------------
-- Report current state so you can verify the cleanup.
-- ----------------------------------------------------------------------------
select
  workspace_id,
  count(*) as rows,
  pg_size_pretty(sum(pg_column_size(snapshot))::bigint) as logical_size,
  min(recorded_at) as oldest,
  max(recorded_at) as newest
from public.app_snapshots_history
group by workspace_id
order by rows desc;

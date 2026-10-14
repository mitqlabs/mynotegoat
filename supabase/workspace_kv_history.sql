-- Version history for workspace_kv (ADDITIVE ONLY: new table, function,
-- trigger, index, policy. Nothing existing is altered or dropped.)
--
-- Every UPDATE/DELETE of a workspace_kv row saves the PREVIOUS value here,
-- so any setting/list can be restored. Kept 30 days.
-- To keep storage sane during rapid autosaves, a save that happens within
-- 20 seconds of the last history entry for the same key is skipped —
-- UNLESS the new value is smaller than the old one (a shrink is how data
-- loss looks), which is always recorded.

create table if not exists public.workspace_kv_history (
  id bigserial primary key,
  workspace_id text not null,
  key text not null,
  value jsonb,
  op text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index if not exists workspace_kv_history_ws_key_at
  on public.workspace_kv_history (workspace_id, key, changed_at desc);

alter table public.workspace_kv_history enable row level security;

drop policy if exists workspace_kv_history_select_owner on public.workspace_kv_history;
create policy workspace_kv_history_select_owner on public.workspace_kv_history
  for select using (can_access_owner(split_part(workspace_id, ':', 1)));

create or replace function public.workspace_kv_record_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_at timestamptz;
  shrank boolean;
begin
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return new;
  end if;
  shrank := tg_op = 'DELETE' or length(coalesce(new.value::text, '')) < length(coalesce(old.value::text, ''));
  if not shrank then
    select max(changed_at) into last_at from public.workspace_kv_history
      where workspace_id = old.workspace_id and key = old.key;
    if last_at is not null and last_at > now() - interval '20 seconds' then
      return coalesce(new, old);
    end if;
  end if;
  insert into public.workspace_kv_history (workspace_id, key, value, op)
    values (old.workspace_id, old.key, old.value, lower(tg_op));
  delete from public.workspace_kv_history
    where workspace_id = old.workspace_id and key = old.key
      and changed_at < now() - interval '30 days';
  return coalesce(new, old);
end;
$$;

drop trigger if exists workspace_kv_history_trg on public.workspace_kv;
create trigger workspace_kv_history_trg
  after update or delete on public.workspace_kv
  for each row execute function public.workspace_kv_record_history();

-- One-time baseline copy of every current value (only if history is empty).
insert into public.workspace_kv_history (workspace_id, key, value, op, changed_by)
  select workspace_id, key, value, 'baseline', null from public.workspace_kv
  where not exists (select 1 from public.workspace_kv_history);

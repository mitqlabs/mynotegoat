-- Staff can record a hand-added opt-out (action stop), not only turning texts back on.
-- ADDITIVE: replaces the insert policy. Do not apply until go-live.

drop policy if exists "reminder_opt_outs_insert" on public.reminder_opt_outs;
create policy "reminder_opt_outs_insert" on public.reminder_opt_outs for insert to authenticated
  with check (
    public.can_access_owner(split_part(workspace_id, ':', 1))
    and source = 'staff'
    and action in ('stop', 'start')
  );

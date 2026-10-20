-- SECURITY (NOT YET APPLIED — needs owner approval):
-- app_snapshots has policies letting the public "anon" role (the key that
-- ships in every browser) SELECT and UPDATE every row (qual = true), and
-- INSERT. Snapshots hold whole workspaces. Only signed-in owners may touch
-- their own row; the authenticated owner policies already cover the app.
drop policy if exists app_snapshots_select_anon on public.app_snapshots;
drop policy if exists app_snapshots_update_anon on public.app_snapshots;
drop policy if exists app_snapshots_insert_anon on public.app_snapshots;
revoke select, insert, update, delete on public.app_snapshots from anon;

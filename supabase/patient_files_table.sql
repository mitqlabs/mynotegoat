-- Patient Files table: one row per uploaded file (kills the single-blob file
-- index that was orphaning uploads). Run this in the Supabase SQL Editor BEFORE
-- flipping the `patientFiles` feature flag. Mirrors patients_table.sql exactly:
-- same workspace scoping, RLS, and updated_at trigger.
--
-- Workspace id format: <auth_user_id>:<office_id>  (e.g. 8e66...:main-office)

create table if not exists public.patient_files (
  id text not null,
  workspace_id text not null,
  folder_id text not null default '',
  name text not null default '',
  storage_path text not null default '',
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  deleted boolean not null default false,
  deleted_at text not null default '',
  created_at_record text not null default '',
  updated_at_record text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists patient_files_workspace_idx
  on public.patient_files(workspace_id);

create index if not exists patient_files_workspace_folder_idx
  on public.patient_files(workspace_id, folder_id);

alter table public.patient_files enable row level security;

revoke all on table public.patient_files from anon;
revoke all on table public.patient_files from authenticated;
grant select, insert, update, delete on table public.patient_files to authenticated;

drop policy if exists "patient_files_select_owner" on public.patient_files;
create policy "patient_files_select_owner"
on public.patient_files
for select
to authenticated
using (split_part(workspace_id, ':', 1) = auth.uid()::text);

drop policy if exists "patient_files_insert_owner" on public.patient_files;
create policy "patient_files_insert_owner"
on public.patient_files
for insert
to authenticated
with check (split_part(workspace_id, ':', 1) = auth.uid()::text);

drop policy if exists "patient_files_update_owner" on public.patient_files;
create policy "patient_files_update_owner"
on public.patient_files
for update
to authenticated
using (split_part(workspace_id, ':', 1) = auth.uid()::text)
with check (split_part(workspace_id, ':', 1) = auth.uid()::text);

drop policy if exists "patient_files_delete_owner" on public.patient_files;
create policy "patient_files_delete_owner"
on public.patient_files
for delete
to authenticated
using (split_part(workspace_id, ':', 1) = auth.uid()::text);

-- Auto-bump updated_at on every UPDATE so freshness compares are reliable.
create or replace function public.patient_files_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patient_files_set_updated_at_trg on public.patient_files;
create trigger patient_files_set_updated_at_trg
before update on public.patient_files
for each row execute procedure public.patient_files_set_updated_at();

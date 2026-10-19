-- =====================================================================
-- Patient questionnaire links (Settings → Forms, patient file → Send form).
-- Run once in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Security model
--  * Patients never touch this table directly. The public page talks only
--    to /api/forms/public/<token>, which runs on the server with the
--    service-role key and reads/writes the ONE row whose token_hash matches
--    sha256(token). The token itself is never stored.
--  * anon has no access at all. Staff (owner, or a non-disabled team
--    member) can READ their own office's rows through RLS; every change
--    (send, revoke, insert, dismiss) goes through server routes that check
--    the caller's session and write an audit_log row.
--  * form_rate_hit() is a fixed-window rate limiter used by those routes.
-- =====================================================================

create table if not exists public.patient_form_requests (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_id uuid not null,
  workspace_id text not null,
  patient_id text not null,
  form_id text not null,
  form_name text not null,
  office_name text not null default '',
  -- Questions + options frozen at send time (from the Objective macros).
  snapshot jsonb not null,
  -- Save-as-you-go draft, then the final answers.
  answers jsonb not null default '{}'::jsonb,
  step int not null default 0,
  -- sent → started → submitted   (or revoked)
  status text not null default 'sent'
    check (status in ('sent', 'started', 'submitted', 'revoked')),
  -- Raw submission, written once on submit and never changed.
  raw_submission jsonb,
  submitted_at timestamptz,
  -- Staff review of a submitted form: new → inserted | dismissed
  review_status text not null default 'new'
    check (review_status in ('new', 'inserted', 'dismissed')),
  reviewed_by uuid,
  reviewed_by_label text,
  reviewed_at timestamptz,
  inserted_encounter_id text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid not null,
  created_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz,
  save_count int not null default 0
);

create index if not exists patient_form_requests_ws_patient_idx
  on public.patient_form_requests (workspace_id, patient_id, created_at desc);
create index if not exists patient_form_requests_ws_review_idx
  on public.patient_form_requests (workspace_id, status, review_status);

alter table public.patient_form_requests enable row level security;
revoke all on table public.patient_form_requests from anon;
revoke all on table public.patient_form_requests from authenticated;
-- Staff read only; token_hash stays server-side.
grant select (
  id, owner_id, workspace_id, patient_id, form_id, form_name, office_name, snapshot,
  answers, step, status, raw_submission, submitted_at, review_status, reviewed_by,
  reviewed_by_label, reviewed_at, inserted_encounter_id, expires_at, revoked_at,
  revoked_by, created_by, created_by_label, created_at, updated_at, last_saved_at
) on public.patient_form_requests to authenticated;

drop policy if exists "pfr_select_staff" on public.patient_form_requests;
create policy "pfr_select_staff" on public.patient_form_requests
  for select to authenticated
  using (public.can_access_owner(owner_id::text));

-- Fixed-window rate limiter (server routes only).
create table if not exists public.form_rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table public.form_rate_limits enable row level security;
revoke all on table public.form_rate_limits from anon, authenticated;

create or replace function public.form_rate_hit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into public.form_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.form_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.form_rate_hit(text, int, int) to service_role;

-- Old buckets are useless after their window; keep the table small.
delete from public.form_rate_limits where window_start < now() - interval '1 day';

-- Realtime (optional): lets the patient file show "Questionnaire received"
-- without a refresh. RLS still applies to what each staff member receives.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'patient_form_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.patient_form_requests';
  end if;
exception when others then
  raise notice 'realtime publication not changed: %', sqlerrm;
end $$;

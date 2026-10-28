-- =====================================================================
-- Roles & Permissions: only the OWNER (or an Admin, when the owner has allowed it) may
-- change the role definitions row.
--
-- The role grid (what Staff / Manager / Admin may open, add, edit and delete) is stored
-- in public.workspace_kv under the key 'casemate.role-settings.v1', one row per office.
-- Every office member can read and write workspace_kv (that is how the app syncs), so
-- without a guard a Staff member could rewrite the grid. This trigger guards ONLY that
-- one key. Every other key is untouched.
--
-- Who may write the row:
--   * the office owner (the id before the ':' in workspace_id is the caller), or
--   * an active Admin member (permissions.roleTier = 'admin' or officeAdmin = true) -- but
--     only while the stored row already says "adminsCanEditRoles": true, and an Admin can
--     never change that switch itself (only the owner can),
--   * the database itself (auth.uid() is null: SQL editor, migrations, service role).
-- Anyone else: the write is silently skipped (the trigger returns NULL) instead of
-- raising an error, so one refused row can never fail a whole batch of other settings.
-- The app reads the row back after saving and tells the person "Not saved".
--
-- What this does NOT do: it does not stop a member from reading or changing office DATA
-- (patients, contacts...). Per-feature rules such as "Staff can't edit contacts" are
-- enforced in the app only; contacts are a single document in workspace_kv so the
-- database cannot tell an add from an edit.
--
-- Idempotent. NOT applied automatically: run it in the Supabase SQL editor or via the
-- migration pipeline after review.
-- =====================================================================

create or replace function public.workspace_kv_role_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ws text := coalesce(new.workspace_id, old.workspace_id);
  owner_part text := split_part(ws, ':', 1);
  stored jsonb;
  is_admin boolean := false;
begin
  -- Only the role-settings row is guarded.
  if coalesce(new.key, old.key) <> 'casemate.role-settings.v1' then
    return coalesce(new, old);
  end if;

  -- SQL editor / migrations / service role.
  if caller is null then
    return coalesce(new, old);
  end if;

  -- The owner may always change it.
  if owner_part = caller::text then
    return coalesce(new, old);
  end if;

  -- What the row holds right now (an upsert reaches the INSERT trigger even when the row exists).
  select k.value into stored
    from public.workspace_kv k
   where k.workspace_id = ws and k.key = 'casemate.role-settings.v1';

  -- Admins may only change it once the owner switched "Let Admins change roles" on...
  if stored is not null and coalesce(stored ->> 'adminsCanEditRoles', 'false') = 'true' then
    select exists (
      select 1 from public.workspace_members m
       where m.workspace_owner_id::text = owner_part
         and m.member_user_id = caller
         and coalesce((m.permissions ->> 'disabled')::boolean, false) = false
         and (
           coalesce((m.permissions ->> 'officeAdmin')::boolean, false) = true
           or coalesce(m.permissions ->> 'roleTier', '') = 'admin'
         )
    ) into is_admin;

    if is_admin then
      -- ...and never change that switch themselves, or remove the row.
      if tg_op = 'DELETE' then
        return null;
      end if;
      if coalesce(new.value ->> 'adminsCanEditRoles', 'false') = 'true' then
        return new;
      end if;
      return null;
    end if;
  end if;

  -- Everyone else: skip the write quietly.
  return null;
end;
$$;

revoke all on function public.workspace_kv_role_settings_guard() from public, anon;

-- Named so it fires before the history / updated_at triggers (BEFORE triggers run in name order):
-- a refused write must not leave a history row behind.
drop trigger if exists workspace_kv_0_role_guard_trg on public.workspace_kv;
create trigger workspace_kv_0_role_guard_trg
before insert or update or delete on public.workspace_kv
for each row execute function public.workspace_kv_role_settings_guard();

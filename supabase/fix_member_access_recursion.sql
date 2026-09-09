-- =====================================================================
-- URGENT FIX — team members saw an empty workspace (no patients/settings).
-- Run this in the Supabase SQL Editor. Idempotent: safe to re-run.
--
-- Cause: an earlier migration changed the workspace_members SELECT policy
-- (wm_select) to call can_access_owner(). But can_access_owner() itself
-- SELECTs from workspace_members, so for a MEMBER the policy recursed and
-- errored — which made every data table keyed on can_access_owner()
-- (patients, workspace_kv, etc.) return nothing. Owners were unaffected
-- because their branch of can_access_owner() passes before the recursive
-- lookup runs.
--
-- Fix: restore the original, NON-recursive wm_select. A member can read
-- their own row (needed to resolve which owner's workspace they belong to)
-- and the owner can read all of their members' rows. Nothing here touches
-- can_access_owner(), so no recursion.
--
-- Trade-off: a member no longer reads the FULL member roster, so the
-- Messages @mention picker will only list the owner + that member for a
-- member's own view (owners still see everyone). Data access is far more
-- important than that; we can revisit the roster with a non-recursive
-- approach later.
-- =====================================================================

drop policy if exists "wm_select" on public.workspace_members;
create policy "wm_select" on public.workspace_members for select to authenticated
using (
  workspace_owner_id = auth.uid()
  or member_user_id = auth.uid()
);

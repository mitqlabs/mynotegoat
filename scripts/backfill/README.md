# Workspace starter: how existing practices are protected

New practices start blank (no pre-made templates, texts, macros, CPT prices or Dx folders).
Practices that already exist must see exactly what they see today.

**Approach used: gating, not a backfill.**

- A workspace is "blank" only if it has the cloud key `casemate.workspace-starter.v1` = `{ "starter": "blank" }`.
- That marker is written once, at first load, and only when **all** of these are true: the user is the owner,
  the account was created on/after `BLANK_STARTER_CUTOFF_ISO` (src/lib/workspace-starter.ts), the cloud could be read,
  and the workspace has no saved data yet.
- Every other workspace (no marker, or any unexpected value) takes the old code path with the old defaults, unchanged.
- `scripts/tests/workspace-starter.test.ts` compares every default-bearing setting for an existing workspace to a
  snapshot taken from `main` (`scripts/tests/fixtures/legacy-effective-defaults.json`). It must stay identical.

Why not a backfill alone: several settings merge code defaults into saved data on every load (e.g. missing Dx codes,
empty lists, missing office-hours days), so copying today's defaults into the database would not capture the full
effective settings. Gating keeps the code path itself identical, with zero writes to existing workspaces.

## Optional backfill (not needed, not run)

`legacy-defaults-backfill.ts` prints a dry-run of which keys each workspace would get, and writes review SQL.
The SQL is INSERT-only (`on conflict do nothing`) and logs each inserted row in `workspace_kv_history`
(op `backfill-insert`) so it can be undone. Do not run it without the owner's OK.

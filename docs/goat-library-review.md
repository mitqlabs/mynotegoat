# G.O.A.T. Library: reviewing and promoting learned phrases

G.O.A.T. maps wording to actions in three steps, in this order:

1. **Learned in your office.** Saved per workspace in Supabase (below). Deletable in Settings → G.O.A.T. → G.O.A.T. Library.
2. **Built in: reviewed phrases.** `GOAT_BUILTIN_PHRASES` in `src/lib/goat-library-builtin.ts`.
3. **Built in: trigger rules.** `GOAT_ACTIONS` in the same file (trigger words, required details, the one short question per missing detail, and examples).

An office phrase that maps to the same action as a built-in phrase is merged away. It isn't shown, and it isn't saved again.

## Where office-learned phrases are stored

- **Table:** `public.workspace_kv`. The schema is in `supabase/workspace_kv_table.sql`.
  - Primary key: `(workspace_id, key)`.
  - Row-level security allows the row only when `split_part(workspace_id, ':', 1) = auth.uid()`.
- **Row:** `workspace_id = <the office's workspace id>`, `key = 'casemate.goat-learned.v1'`.
- **Column:** `value` (jsonb).
- **Write path:**
  - `saveLearned()` in `src/lib/goat-learned.ts` re-reads the current copy and merges into it.
  - It then writes the browser cache (localStorage, same key) and calls `dualWriteKv(key, "tasks", value)`.
  - That becomes `upsertKvValue()` in `src/lib/kv-cloud.ts`, an upsert on `workspace_id,key`.
- **Read path:** `src/lib/cloud-state.ts` pulls the key on boot. The key is in `UNION_MERGE_KEYS`, so the cloud and local copies are union-merged by `id`.
- **Registry:** `src/lib/cloud-key-registry.ts` has `"casemate.goat-learned.v1": "workspace"`.

### JSON shape of `value`

```json
{
  "phrases": [
    { "id": "{patient} the usual {date} {time}", "action": "book", "count": 2, "updatedAt": "2026-10-20T23:10:00.000Z" },
    { "id": "pull {patient}", "action": "open", "count": 1, "updatedAt": "2026-10-20T23:12:00.000Z", "deleted": true }
  ],
  "misses": [
    { "id": "blorp the thing for {patient}|reply", "template": "blorp the thing for {patient}", "did": "reply", "updatedAt": "2026-10-20T23:05:00.000Z" }
  ]
}
```

- `phrases[].id` is the template: lowercase, with these slots:
  - `{patient}` / `{name}`: patient, contact and attorney names
  - `{date}`
  - `{time}`
  - `{n}`: numbers
- `phrases[].action` is one of the `ActionId` values in `goat-library-builtin.ts`.
- `misses[]` are replies marked 👎. `did` is what G.O.A.T. did (an action id, `om:<kind>`, or `reply`), never the reply text.
- `deleted: true` is a tombstone, so a delete on one computer isn't undone by another computer's older copy. Skip these when reviewing.
- Limits: 500 phrases and 300 misses (newest kept).

### Pull them for review (SQL editor, service role)

```sql
select workspace_id,
       p->>'id'        as template,
       p->>'action'    as action,
       (p->>'count')::int as uses,
       p->>'updatedAt' as updated_at
from public.workspace_kv,
     jsonb_array_elements(value->'phrases') p
where key = 'casemate.goat-learned.v1'
  and coalesce((p->>'deleted')::boolean, false) = false
order by uses desc, updated_at desc;
```

To see the misses, use `jsonb_array_elements(value->'misses')`.

## How to promote a phrase

1. Pick phrases that are clearly right, that several offices share or that have a high `uses` count, and that contain **no names or real data**. Templates should already be name-free; double-check anyway, because this repo is public.
2. Add each one to the end of `GOAT_BUILTIN_PHRASES` in `src/lib/goat-library-builtin.ts`:
   ```ts
   { template: "{patient} the usual {date} {time}", action: "book", source: "reviewed from office learning, PR #NNN" },
   ```
3. Add the wording, with a mock name, to a test in `scripts/tests/goat-library.test.ts` (or the phrase sets in `goat-understand.test.ts`).
4. Run `npx tsx scripts/tests/goat-library.test.ts`, `npx tsx scripts/tests/goat-understand.test.ts`, `npx tsc --noEmit -p .` and `npx next build`.
5. Open a PR. Offices that learned the same wording see it merged away from their "Learned in your office" list automatically. There's no data migration; their cloud rows stay as they are.

If an office phrase maps the same wording to a **different** action than a built-in one, the office's choice wins for that office. Review these before promoting anything that conflicts.

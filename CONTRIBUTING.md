# Contributing to NoteGoat

## G.O.A.T. rules
- Rules-based only: no cloud AI, ever.
- All data cloud-backed (keys registered in `src/lib/cloud-key-registry.ts`).
- Every data change goes through ONE confirm card; ask when unsure instead of guessing.
- Mock data only in tests and the repo (the repo is public). Use fictional names and firms.
- **Every new or changed G.O.A.T. feature must update the Handbook → G.O.A.T. chapter**
  (`src/lib/handbook-goat.ts`) in the same PR, in plain words with an example.
  `npm run sanity` (Rule 7) fails when G.O.A.T. code changes without it.
  New `/` commands go in `SLASH_COMMANDS` (`src/lib/goat-briefs.ts`); the Handbook
  and the "what can you do?" answer list them automatically.
- Add eval tests under `scripts/tests/goat-eval/`.

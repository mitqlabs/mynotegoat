/** Dirty-key bookkeeping behind Save to Cloud. Run: npx tsx scripts/tests/dirty-keys.test.ts */
import assert from "node:assert/strict";
import { markKeyDirty, markKeyClean, getDirtyKeys, resetDirtyKeysForTests } from "../../src/lib/dirty-keys";
resetDirtyKeysForTests();
markKeyDirty("k", 100); markKeyDirty("k", 200);
assert.equal(getDirtyKeys().get("k"), 100);
markKeyClean("k", 50); assert.equal(getDirtyKeys().has("k"), true); // write started before the edit
markKeyClean("k", 150); assert.equal(getDirtyKeys().has("k"), false);
console.log("ok");

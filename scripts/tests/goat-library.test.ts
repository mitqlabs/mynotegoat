/** G.O.A.T. Library: built-in data file, use order, and merge of office duplicates. */
import assert from "node:assert/strict";
import { builtinMap, GOAT_ACTIONS, GOAT_BUILTIN_PHRASES } from "../../src/lib/goat-library-builtin";
import { phraseTemplate, understand, type UContext } from "../../src/lib/goat-understand";
import { emptyLearned, isBuiltinDuplicate, learnedMap, officePhrases, safeTemplate, withPhrase } from "../../src/lib/goat-learned";

const ctx: UContext = { today: "2026-10-20", patients: [{ id: "P1", fullName: "Smith, John" }, { id: "P2", fullName: "Rivera, Ana" }] };

// Built-in phrases are valid, name-free templates for real actions.
const ids = new Set(GOAT_ACTIONS.map((a) => a.id));
for (const p of GOAT_BUILTIN_PHRASES) {
  assert.ok(safeTemplate(p.template), `unsafe built-in template: ${p.template}`);
  assert.ok(ids.has(p.action), `unknown action: ${p.action}`);
}
assert.equal(Object.keys(builtinMap()).length, GOAT_BUILTIN_PHRASES.length, "duplicate built-in templates");

// Built-in phrases work, with any patient.
assert.equal(understand("ana rivera the usual friday 3", ctx)?.action, "book");
assert.equal(understand("smith ghosted", ctx)?.action, "noShow");
assert.equal(understand("pull ana", ctx)?.action, "open");
assert.equal(phraseTemplate("john smith the usual friday 3", ctx.patients, ctx.today), "{patient} the usual {date} {time}");

// Office duplicates of a built-in are not saved and not shown.
const dup = "{patient} ghosted";
assert.ok(isBuiltinDuplicate(dup, "noShow"));
const l1 = withPhrase(emptyLearned(), dup, "noShow");
assert.equal(l1.phrases.length, 0);
const old = { phrases: [{ id: dup, action: "noShow" as const, count: 3, updatedAt: "2026-10-01T00:00:00Z" }, { id: "squish {patient} in {date}", action: "book" as const, count: 1, updatedAt: "2026-10-02T00:00:00Z" }], misses: [] };
assert.deepEqual(officePhrases(old).map((p) => p.id), ["squish {patient} in {date}"]);
assert.equal(learnedMap(old)[dup], undefined);

// Office learning comes first, even over a built-in (different action).
const over = withPhrase(emptyLearned(), "{patient} ghosted", "cancel");
assert.equal(officePhrases(over).length, 1);
assert.equal(understand("smith ghosted", { ...ctx, learned: learnedMap(over) })?.action, "cancel");
assert.equal(understand("squish ana in tmrw", { ...ctx, learned: learnedMap(old) })?.action, "book");

console.log(`goat-library ok (${GOAT_ACTIONS.length} actions, ${GOAT_BUILTIN_PHRASES.length} built-in phrases)`);

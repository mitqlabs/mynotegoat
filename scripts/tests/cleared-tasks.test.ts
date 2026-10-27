/**
 * "Clear task" (ignore, not Done) — records, merge, Case Flow filter. Mock data only.
 * Run: npx tsx scripts/tests/cleared-tasks.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearedIdSet, followUpClearId, mergeClearedRecords, setCleared, taskClearId } from "../../src/lib/cleared-tasks";
import { buildFollowUpItems } from "../../src/lib/follow-up-queue";
import { unionMerge } from "../../src/lib/kv-merge";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${n}: ${(e as Error).message.split("\n")[0]}`); } };

const a = setCleared([], followUpClearId("p1", "Lien / LOP"), true, "Hannah", "2026-10-15T20:00:00.000Z", "Lien · Mock A");
check("clear records who/when", () => { assert.equal(a[0].by, "Hannah"); assert.equal(a[0].updatedAt, "2026-10-15T20:00:00.000Z"); assert.ok(clearedIdSet(a).has("fu:p1|Lien / LOP")); });
const r = setCleared(a, "fu:p1|Lien / LOP", false, "Ann", "2026-10-15T21:00:00.000Z");
check("restore keeps the record (not deleted), label kept", () => { assert.equal(r.length, 1); assert.equal(r[0].cleared, false); assert.equal(r[0].label, "Lien · Mock A"); assert.equal(clearedIdSet(r).size, 0); });
check("merge: newer restore beats older clear", () => assert.equal(clearedIdSet(mergeClearedRecords(a, r)).size, 0));
check("merge: newer clear beats older restore", () => { const later = setCleared(r, "fu:p1|Lien / LOP", true, "Bo", "2026-10-15T22:00:00.000Z"); assert.equal(clearedIdSet(mergeClearedRecords(r, later)).size, 1); });
check("merge: other device's clears kept", () => { const b = setCleared([], taskClearId("t9"), true, "Bo", "2026-10-15T20:30:00.000Z"); assert.deepEqual([...clearedIdSet(mergeClearedRecords(a, b))].sort(), ["fu:p1|Lien / LOP", "task:t9"]); });
check("boot union-merge agrees", () => { const b = setCleared([], taskClearId("t9"), true, "Bo", "2026-10-15T20:30:00.000Z"); assert.equal((unionMerge(a, b) as unknown[]).length, 2); });

const pt = { id: "p1", fullName: "Mock A", dob: "01/01/1980", phone: "555-000-0000", attorney: "Mock Law", caseStatus: "Active", dateOfLoss: "01/01/2026", lastUpdate: "2026-10-01", priority: "Normal", matrix: { initialExam: "01/05/2026" } } as never;
const base = buildFollowUpItems([pt], { clearedIds: new Set() });
const cat = base[0]?.category;
check("fixture yields Case Flow rows", () => assert.ok(base.length > 0));
const ids = clearedIdSet(setCleared([], followUpClearId("p1", cat), true, "Hannah", "2026-10-15T20:00:00.000Z"));
check("cleared row gone (Case Flow + counts), others stay", () => { const left = buildFollowUpItems([pt], { clearedIds: ids }); assert.equal(left.filter((i) => i.category === cat).length, 0); assert.equal(left.length, base.length - base.filter((i) => i.category === cat).length); });
check("not regenerated when the stage changes (id is case+category)", () => assert.equal(followUpClearId("p1", cat), `fu:p1|${cat}`));
check("includeCleared shows it again", () => assert.equal(buildFollowUpItems([pt], { clearedIds: ids, includeCleared: true }).length, base.length));

const page = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
check("Case Flow + To-Do have Clear task + Show cleared", () => { assert.ok((page.match(/Clear task/g) ?? []).length >= 2); assert.match(page, /Show cleared/); assert.match(page, /appConfirm\(`Clear/); });
check("Case Flow passes cleared ids", () => assert.match(page, /effectiveInitialExam: [^\n]+\n\s+clearedIds,/));
check("To-Do filters cleared", () => assert.match(page, /clearedIds\.has\(taskClearId\(task\.id\)\)/));
const goat = readFileSync("src/components/global-goat.tsx", "utf8");
check("G.O.A.T. drops cleared to-dos", () => assert.match(goat, /loadTasks\(\)\.filter\(\(t\) => !c\.has\(taskClearId\(t\.id\)\)\)/));
const cs = readFileSync("src/lib/cloud-state.ts", "utf8");
check("cloud: union-merged + pulled on boot", () => assert.equal((cs.match(/casemate\.cleared-tasks\.v1/g) ?? []).length, 2));
console.log(`cleared-tasks: ${pass}/${pass + fail} passed (mock data only)`);
if (fail) process.exit(1);

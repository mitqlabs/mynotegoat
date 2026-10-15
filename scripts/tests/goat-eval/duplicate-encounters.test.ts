/**
 * G.O.A.T. duplicate encounters: detection, "real data" pick, merge plans, and
 * backup bookkeeping. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/duplicate-encounters.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EncounterNoteRecord } from "../../../src/lib/encounter-notes";
import { findDuplicateEncounters, fullness, plainText, planMerge } from "../../../src/lib/encounter-dupes";
import { markRestored, withBackup, type EncounterMergeBackup } from "../../../src/lib/encounter-merge-backups";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const E = (id: string, date: string, over: Partial<EncounterNoteRecord> = {}): EncounterNoteRecord => ({
  id, patientId: "p1", patientName: "Mock, Patient", provider: "Dr. Mock", appointmentType: "Follow-Up Visit", encounterDate: date, startTime: "",
  soap: { subjective: "", objective: "", assessment: "", plan: "" }, macroRuns: [], diagnoses: [], charges: [], signed: false, signedAt: "",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
});
const ch = (id: string, procedureCode: string, name: string) => ({ id, name, procedureCode, unitPrice: 50, units: 1 }) as EncounterNoteRecord["charges"][number];
const dx = (id: string, code: string) => ({ id, code, description: code, source: "manual" });

const full = E("full", "10/14/2026", { soap: { subjective: "<p>Neck pain 6/10</p>", objective: "<p>Tender C5-C6</p>", assessment: "Improving", plan: "" }, charges: [ch("c1", "98940", "CMT 1-2"), ch("c2", "97014", "E-stim")], diagnoses: [dx("d1", "S13.4XXA")], signed: true });
const thin = E("thin", "10/14/2026", { appointmentType: "Re-Exam", soap: { subjective: "", objective: "", assessment: "", plan: "<p>RTC 1 wk</p>" }, charges: [ch("c3", "98940", "CMT 1-2"), ch("c4", "97110", "Ther ex")], diagnoses: [dx("d2", "S13.4XXA"), dx("d3", "M54.2")], appointmentId: "appt-9" });
const empty = E("empty", "2026-10-14");
const other = E("other", "10/07/2026", { soap: { subjective: "x", objective: "", assessment: "", plan: "" } });
const someoneElse = E("se", "10/14/2026", { patientId: "p2" });
const all = [thin, other, empty, full, someoneElse];

check("plainText", () => assert.equal(plainText("<p>A&nbsp;&amp; B</p><br/>C"), "A & B C"));
check("fullness empty", () => assert.equal(fullness(empty).score, 0));
check("fullness order", () => assert.ok(fullness(full).score > fullness(thin).score && fullness(thin).score > 0));
check("fullness counts", () => assert.deepEqual({ ...fullness(full), score: 0, chars: 0 }, { score: 0, chars: 0, sections: 3, diagnoses: 1, charges: 2, macroRuns: 0, signed: true }));
const groups = findDuplicateEncounters(all, "p1");
check("one group", () => assert.equal(groups.length, 1));
check("group date", () => assert.equal(groups[0].date, "10/14/2026"));
check("mixed date formats grouped", () => assert.deepEqual(groups[0].encounters.map((e) => e.id), ["full", "thin", "empty"]));
check("other patient excluded", () => assert.ok(!groups[0].encounters.some((e) => e.id === "se")));
check("single date not flagged", () => assert.ok(!groups.some((g) => g.date === "10/07/2026")));
check("no dupes", () => assert.deepEqual(findDuplicateEncounters([full, other], "p1"), []));
check("tie → newest", () => {
  const a = E("a", "10/01/2026", { updatedAt: "2026-10-02T00:00:00Z" }), b = E("b", "10/01/2026", { updatedAt: "2026-10-03T00:00:00Z" });
  assert.equal(findDuplicateEncounters([a, b], "p1")[0].encounters[0].id, "b");
});
check("newest date group first", () => {
  const g = findDuplicateEncounters([...all, E("x1", "10/20/2026"), E("x2", "10/20/2026")], "p1");
  assert.deepEqual(g.map((x) => x.date), ["10/20/2026", "10/14/2026"]);
});

const keep = planMerge(groups[0], "keepFuller");
check("keepFuller keeps", () => { assert.equal(keep.keep.id, "full"); assert.equal(keep.merged, full); assert.deepEqual(keep.remove.map((r) => r.id), ["thin", "empty"]); assert.deepEqual(keep.changes, []); });
const uni = planMerge(groups[0], "union");
check("union keeps id", () => assert.equal(uni.merged.id, "full"));
check("union plan filled", () => assert.equal(uni.merged.soap.plan, "<p>RTC 1 wk</p>"));
check("union subjective untouched", () => assert.equal(uni.merged.soap.subjective, "<p>Neck pain 6/10</p>"));
check("union charges dedupe by CPT", () => assert.deepEqual(uni.merged.charges.map((c) => c.procedureCode), ["98940", "97014", "97110"]));
check("union dx dedupe", () => assert.deepEqual(uni.merged.diagnoses.map((d) => d.code), ["S13.4XXA", "M54.2"]));
check("union appointment link", () => assert.equal(uni.merged.appointmentId, "appt-9"));
check("union changes words", () => assert.deepEqual(uni.changes, ["Plan filled in", "Diagnosis M54.2", "Charge 97110 Ther ex"]));
check("union does not mutate input", () => { assert.equal(full.soap.plan, ""); assert.equal(full.charges.length, 2); });
check("union appends different text", () => {
  const a = E("a", "10/02/2026", { soap: { subjective: "Low back pain", objective: "", assessment: "", plan: "" }, charges: [ch("c", "98940", "CMT")] });
  const b = E("b", "10/02/2026", { soap: { subjective: "Also headache", objective: "", assessment: "", plan: "" } });
  const p = planMerge(findDuplicateEncounters([a, b], "p1")[0], "union");
  assert.equal(p.merged.soap.subjective, "Low back pain\nAlso headache");
  assert.deepEqual(p.changes, ["Subjective text added"]);
});
check("union skips contained text", () => {
  const a = E("a", "10/03/2026", { soap: { subjective: "Neck pain and stiffness", objective: "", assessment: "", plan: "" } });
  const b = E("b", "10/03/2026", { soap: { subjective: "<p>Neck pain</p>", objective: "", assessment: "", plan: "" } });
  assert.deepEqual(planMerge(findDuplicateEncounters([a, b], "p1")[0], "union").changes, []);
});

// Backups
const bk = (id: string): EncounterMergeBackup => ({ id, at: "2026-10-15T10:00:00Z", by: "G.O.A.T.", patientId: "p1", patientName: "Mock, Patient", date: "10/14/2026", mode: "union", keptBefore: full, removed: [thin, empty], movedCashPayments: [] });
check("withBackup newest first", () => assert.deepEqual(withBackup([bk("a")], bk("b")).map((x) => x.id), ["b", "a"]));
check("withBackup replaces same id", () => assert.equal(withBackup([bk("a")], bk("a")).length, 1));
check("withBackup cap", () => assert.equal(withBackup(Array.from({ length: 250 }, (_, i) => bk(`x${i}`)), bk("n")).length, 200));
check("markRestored", () => assert.deepEqual(markRestored([bk("a"), bk("b")], "b", "T").map((x) => x.restoredAt), [undefined, "T"]));
check("backup keeps full copies", () => assert.equal(bk("a").removed[0].soap.plan, "<p>RTC 1 wk</p>"));

// Wiring guards: never auto-merge, backup before delete, cloud key registered.
const ui = readFileSync("src/components/goat-duplicate-encounters.tsx", "utf8");
check("merge only from confirm click", () => { assert.match(ui, /onClick=\{\(\) => void merge\(group\)\}/); assert.equal((ui.match(/void merge\(/g) ?? []).length, 1); });
check("backup awaited before delete", () => assert.ok(ui.indexOf("await saveMergeBackupOrThrow") < ui.indexOf("deleteEncounter(r.id)")));
check("no effect merges", () => assert.doesNotMatch(ui.slice(ui.indexOf("useEffect("), ui.indexOf("}, [patientId]);")), /merge|deleteEncounter|putEncounterRecords/));
check("key registered", () => assert.match(readFileSync("src/lib/cloud-key-registry.ts", "utf8"), /"casemate\.encounter-merge-backups\.v1": "workspace"/));
check("no browser storage", () => assert.doesNotMatch(readFileSync("src/lib/encounter-merge-backups.ts", "utf8"), /localStorage|sessionStorage/));

console.log(`duplicate-encounters: ${pass}/${pass + fail} passed (mock data only)`);
if (fail) process.exit(1);

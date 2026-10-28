/**
 * G.O.A.T. notes save as quick-note entries (casemate.case-note-entries.v1): date + author stamped,
 * wording tidied, merge-safe with other people's notes. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/goat-note-entries.test.ts
 */
import assert from "node:assert/strict";
import { CASE_NOTE_ENTRIES_KEY, addEntry, entriesForPatient, entryFromGoatNote, formatEntryDate, mergeEntries, normalizeEntries } from "../../../src/lib/case-note-entries";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const at = new Date(2026, 9, 27, 14, 5);

check("key is the quick-notes key", () => assert.equal(CASE_NOTE_ENTRIES_KEY, "casemate.case-note-entries.v1"));
const e = entryFromGoatNote({ patientId: "p1", text: "  spoke to atty about reduction  ", author: "Dr. Mike", authorUserId: "u1", now: at })!;
check("stamped with today's date and the author", () => { assert.equal(e.date, "2026-10-27"); assert.equal(e.author, "Dr. Mike"); assert.equal(e.authorUserId, "u1"); assert.equal(formatEntryDate(e.date), "10/27/26"); });
check("text kept without the old signature/date prefix", () => assert.equal(e.text, "Spoke to atty about reduction"));
check("empty note or no patient → no entry", () => { assert.equal(entryFromGoatNote({ patientId: "p1", text: "   ", author: "x" }), null); assert.equal(entryFromGoatNote({ patientId: "", text: "hi", author: "x" }), null); });
check("shows up in that patient's Notes log only", () => { const all = addEntry([], e); assert.equal(entriesForPatient(all, "p1").length, 1); assert.equal(entriesForPatient(all, "p2").length, 0); });
check("a second note never overwrites the first", () => { const e2 = entryFromGoatNote({ patientId: "p1", text: "left vm", author: "Hannah M.", now: new Date(2026, 9, 27, 15, 0) })!; const all = addEntry(addEntry([], e), e2); assert.equal(entriesForPatient(all, "p1").length, 2); assert.notEqual(e.id, e2.id); });
check("merge with a teammate's cloud notes keeps both", () => { const theirs = entryFromGoatNote({ patientId: "p1", text: "their note", author: "Hannah M." })!; const merged = mergeEntries([e], [theirs]); assert.equal(merged.length, 2); });
check("survives normalize (cloud round-trip)", () => assert.deepEqual(normalizeEntries(JSON.parse(JSON.stringify([e]))), [e]));
// Wiring: the G.O.A.T. save step uses the entries store, not the old free-form note text.
const src = readFileSync("src/components/global-goat.tsx", "utf8");
const save = src.slice(src.indexOf("const saveNote = "), src.indexOf("const pickTime = "));
check("saveNote writes entries", () => { assert.match(save, /entryFromGoatNote/); assert.match(save, /saveCaseNoteEntries/); assert.doesNotMatch(save, /setCaseNote\(/); });

console.log(`goat-note-entries: ${pass}/${pass + fail} passed (mock data only)`);
process.exit(fail ? 1 : 0);

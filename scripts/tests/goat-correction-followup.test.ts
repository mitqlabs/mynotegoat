import assert from "node:assert/strict";
import { followUpFor, lastActSummary, type LastAct } from "../../src/lib/goat-memory";
import { batchCategory, buildImportRows, categoryFromRequest, guessCategory, parseContactPaste } from "../../src/lib/goat-contacts-import";

// Mock data only.
const today = "2026-10-20";
const imp: LastAct = { kind: "contactImport", msgId: "m1", ids: ["c1", "c2"], category: "Acute Care" };
const kind = (t: string, l: LastAct = imp) => followUpFor(t, l, today);

// Follow-ups about the last import refer to it.
assert.deepEqual(kind("you put them under acute care"), { kind: "importRecat", to: "" }, "complaint, no target → ask");
assert.deepEqual(kind("wrong category"), { kind: "importRecat", to: "" });
assert.deepEqual(kind("they should be attorneys"), { kind: "importRecat", to: "Attorney" });
assert.deepEqual(kind("you put them under acute care, they're attorneys"), { kind: "importRecat", to: "Attorney" });
assert.deepEqual(kind("change them to Imaging Center"), { kind: "importRecat", to: "Imaging Center" });
assert.deepEqual(kind("those are pain management"), { kind: "importRecat", to: "Specialist" });
assert.deepEqual(kind("fix the category"), { kind: "importRecat", to: "" });
assert.deepEqual(kind("undo that"), { kind: "importUndo" });
assert.deepEqual(kind("undo the import"), { kind: "importUndo" });
assert.deepEqual(kind("you did it wrong"), { kind: "correct" });
assert.deepEqual(kind("that's wrong"), { kind: "correct" });
assert.deepEqual(kind("no"), { kind: "correct" });
assert.deepEqual(kind("leave it"), { kind: "leave" });
assert.equal(kind("what's Carr's balance?"), null, "an unrelated question routes normally");
assert.equal(lastActSummary(imp), "Last I added 2 contacts under Acute Care.");

// Other last actions get the same correction handling.
const note: LastAct = { kind: "note", msgId: "n1", patientId: "P1", patientName: "Mock, Pat", line: "10/20/26 - called" };
assert.deepEqual(kind("you did it wrong", note), { kind: "correct" });
assert.deepEqual(kind("not that", note), { kind: "correct" });
assert.deepEqual(kind("undo that", note), { kind: "noteDelete" }, "existing note undo kept");
const booking: LastAct = { kind: "booking", msgId: "b1", state: "booked" };
assert.deepEqual(kind("that's not right", booking), { kind: "correct" });
assert.deepEqual(kind("make it 2pm instead", booking), { kind: "bookingTime", time: "2pm" }, "existing booking follow-up kept");
const todo: LastAct = { kind: "todo", msgId: "t1", title: "Call Mock Law" };
assert.deepEqual(kind("wrong", todo), { kind: "correct" });
assert.equal(followUpFor("you did it wrong", null, today), null, "nothing done yet → no correction");

// Category detection: law-firm signals win; contact names never count as the "request".
const attorneys = `Miller & Baker Injury Lawyers\n818-555-0101\n\nRyder Accident Attorneys, APC\n818-555-0102\n\nCarter Care Law Group\n818-555-0103\n\nWalker Legal\n818-555-0104\n\nHunter Firm LLP\n818-555-0105`;
assert.equal(categoryFromRequest(attorneys), "", "names like Miller/Baker no longer read as 'ER'");
assert.equal(batchCategory(parseContactPaste(attorneys)), "Attorney");
for (const r of buildImportRows(parseContactPaste(attorneys), [], "")) assert.equal(r.category, "Attorney", r.name);
assert.equal(guessCategory("Downtown Accident & Injury Care Esq."), "Attorney");
assert.equal(guessCategory("Valley Urgent Care"), "Acute Care");
assert.equal(categoryFromRequest(`add these attorneys as contacts\n${attorneys}`), "Attorney");
assert.equal(categoryFromRequest(`Imaging:\nMock Open MRI\n818-555-0110`), "Imaging Center");
// Unsure → no guess (the card asks for the category before importing).
assert.equal(batchCategory(parseContactPaste("Mock Center One\n818-555-0120\n\nMock Center Two\n818-555-0121")), "");
console.log("goat-correction-followup ok");

import assert from "node:assert/strict";
import { correctionReply, followUpFor, importUndoText, lastActSummary, recatAsk, recatConfirmText, clarifyFor, type LastAct } from "../../src/lib/goat-memory";
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
assert.equal(lastActSummary(imp), "I added those 2 under Acute Care.");
assert.deepEqual(kind("pick another category"), { kind: "importRecat", to: "", noSuggest: true });

// Human wording: short, warm, uses context, only fitting buttons.
const imp22: Extract<LastAct, { kind: "contactImport" }> = { kind: "contactImport", msgId: "m2", ids: Array.from({ length: 22 }, (_, i) => `c${i}`), category: "Acute Care" };
const cats = ["Attorney", "Imaging Center", "Specialist", "Acute Care", "Insurance Agent"];
const ask = recatAsk(imp22, "Attorney", cats);
assert.equal(ask.say, "Oops, my bad — those 22 should be Attorneys, right? Want me to switch them?");
assert.deepEqual(ask.choices.map((c) => c.label), ["Yes, switch them", "Pick another"]);
assert.equal(ask.choices[0].question, "change them to Attorney");
const ask2 = recatAsk(imp22, "", cats);
assert.equal(ask2.say, "Oops, sorry! What should those 22 be?");
assert.ok(!ask2.choices.some((c) => c.label === "Acute Care"), "current category not offered");
assert.equal(recatConfirmText(22, "Acute Care", "Attorney"), "Switch those 22 from Acute Care to Attorneys?");
assert.equal(importUndoText(22), "Want me to take out the 22 I just added?");
const noteFix = correctionReply({ kind: "note", msgId: "n", patientId: "P", patientName: "Mock, Pat", line: "called back" });
assert.equal(noteFix.say, `Sorry about that! I added "called back" to Pat's notes. Want me to change it or take it out?`);
const bookFix = correctionReply({ kind: "booking", msgId: "b", state: "booked" });
assert.deepEqual(bookFix.choices.map((c) => c.label), ["Change the time", "It's fine"], "no Undo offered where there is none");
for (const r of [correctionReply(imp22), noteFix, bookFix]) {
  for (const c of r.choices) assert.ok(!/look up the bill|book an appointment|add as a note/i.test(c.label), `no generic patient menu: ${c.label}`);
}
assert.match(clarifyFor(imp22), /^Sorry, I didn't quite get that\./);

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

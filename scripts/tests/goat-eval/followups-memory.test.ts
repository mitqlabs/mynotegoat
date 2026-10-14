/**
 * Multi-turn eval: conversation memory for follow-ups (note, message, booking)
 * and team messages with no / one / ambiguous patient. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/followups-memory.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_CAUGHT, clarifyFor, editNoteLine, followUpFor, noteDateIn, withNoteDate, withNoteText, type LastAct } from "../../../src/lib/goat-memory";
import { parseTell, patientsMentionedInMessage } from "../../../src/lib/goat-message";
import { appendNote } from "../../../src/lib/goat-notes";

const TODAY = "2026-10-14";
let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

const note: LastAct = { kind: "note", msgId: "m1", patientId: "p-collin", patientName: "Collin Elliott", line: "10/14/26 - Spoke to atty about red req -Dr. Mike" };
const ask: LastAct = { kind: "msgAsk", msgId: "m2", toLabel: "Hannah", text: "hey how are you" };
const msg: LastAct = { kind: "message", msgId: "m3", toLabel: "Hannah", text: "call kara back", state: "sent" };
const book: LastAct = { kind: "booking", msgId: "m4", state: "booked" };
const bookOpen: LastAct = { kind: "booking", msgId: "m5", state: "open" };

// 1. Note follow-ups — exact cases first.
const NOTE_DATE: Array<[string, string]> = [
  ["can you add it with yesterday's date", "2026-10-13"], ["change the date to yesterday", "2026-10-13"], ["change the date to 10/12", "2026-10-12"],
  ["change the date to 10/13/26", "2026-10-13"], ["make it yesterday's date", "2026-10-13"], ["put yesterday's date on it", "2026-10-13"],
  ["date it 10/12", "2026-10-12"], ["it should have been yesterday", "2026-10-13"], ["use 10/11 for the date", "2026-10-11"],
  ["fix the date, it was yesterday", "2026-10-13"], ["can you change the date to 10/12/2026", "2026-10-12"], ["set the date to 2 days ago", "2026-10-12"],
  ["backdate it to yesterday", "2026-10-13"], ["switch the date to 10/10", "2026-10-10"],
];
for (const [q, iso] of NOTE_DATE) check(`note date: ${q}`, () => assert.deepEqual(followUpFor(q, note, TODAY), { kind: "noteDate", iso }));
for (const q of ["undo that", "delete it", "undo", "remove it", "delete that", "scratch that", "oops, delete that note", "take it out", "remove the note"]) check(`note undo: ${q}`, () => assert.deepEqual(followUpFor(q, note, TODAY), { kind: "noteDelete" }));
for (const [q, t] of [["change it to spoke to atty, faxed red req", "spoke to atty, faxed red req"], ["it should say called atty, LVM", "called atty, LVM"], ["edit it to: atty wants updated bill", "atty wants updated bill"], ["change that to left vm for atty", "left vm for atty"]] as const) check(`note replace: ${q}`, () => assert.deepEqual(followUpFor(q, note, TODAY), { kind: "noteReplace", text: t }));
for (const [q, t] of [["also add that she called back", "she called back"], ["also add atty wants records", "atty wants records"], ["and also add faxed bill 10/14", "faxed bill 10/14"], ["add that we faxed the bill too", "we faxed the bill too"], ["also faxed the lien", "faxed the lien"]] as const) check(`note append: ${q}`, () => assert.deepEqual(followUpFor(q, note, TODAY), { kind: "noteAppend", text: t }));
check("bare date → context clarify", () => { const r = followUpFor("10/13?", note, TODAY); assert.equal(r?.kind, "clarify"); assert.match((r as { say: string }).say, /change the date on the note I just added to 10\/13\/26\?/); });
check("new patient note is not an append", () => assert.equal(followUpFor("add a note for kara smith: called", note, TODAY), null));

// Note line edits.
check("redate line", () => assert.equal(withNoteDate(note.line, "2026-10-13"), "10/13/26 - Spoke to atty about red req -Dr. Mike"));
check("retext line keeps date+sig", () => assert.equal(withNoteText(note.line, "i faxed red req"), "10/14/26 - Faxed red req -Dr. Mike"));
check("retext keeps -First L.", () => assert.equal(withNoteText("10/14/26 - Old -Hannah M.", "new"), "10/14/26 - New -Hannah M."));
const notes = appendNote("10/01/26 - Old -Dr. Mike", note.line);
check("edit in place", () => assert.equal(editNoteLine(notes, note.line, withNoteDate(note.line, "2026-10-13")), "10/01/26 - Old -Dr. Mike\n10/13/26 - Spoke to atty about red req -Dr. Mike"));
check("undo removes only that line", () => assert.equal(editNoteLine(notes, note.line, null), "10/01/26 - Old -Dr. Mike"));
check("missing line → null (no blind edit)", () => assert.equal(editNoteLine("x", note.line, null), null));
check("yesterday parse", () => assert.equal(noteDateIn("yesterday", TODAY), "2026-10-13"));

// 2. After "Which patient is this about?".
for (const q of ["no patient", "none", "not about a patient", "no", "nobody", "it's not about a patient", "just a general message", "general", "n/a", "no patients", "not for a patient", "just send it"]) check(`no patient: ${q}`, () => assert.deepEqual(followUpFor(q, ask, TODAY), { kind: "generalMessage" }));
check("a name after which-patient is not 'none'", () => assert.equal(followUpFor("kara smith", ask, TODAY), null));

// 3. After a message.
for (const [q, to, mode] of [["send it to Greg instead", "Greg", "instead"], ["also tell Abi", "Abi", "also"], ["greg instead", "greg", "instead"], ["actually send it to greg instead", "greg", "instead"], ["and tell abi too", "abi", "also"], ["cc greg", "greg", "also"], ["also send it to greg", "greg", "also"], ["send it to abi too", "abi", "also"], ["abi too", "abi", "also"], ["no, tell greg instead", "greg", "instead"]] as const) check(`message: ${q}`, () => assert.deepEqual(followUpFor(q, msg, TODAY), { kind: "messageTo", to, mode }));

// 4. After booking.
for (const [q, t] of [["make it 2pm instead", "2pm"], ["2pm instead", "2pm"], ["change it to 3:30", "3:30"], ["move it to 10am", "10am"], ["how about 4", "4"], ["actually make it 9:15am", "9:15am"]] as const) {
  check(`booked: ${q}`, () => assert.deepEqual(followUpFor(q, book, TODAY), { kind: "bookingTime", time: t }));
  check(`open: ${q}`, () => assert.deepEqual(followUpFor(q, bookOpen, TODAY), { kind: "bookingTime", time: t }));
}

// 5. No generic file fallback for non-file chatter.
check("clarify after note", () => assert.match(clarifyFor(note), /note I just added for Collin Elliott/));
check("plain didn't-catch", () => assert.equal(clarifyFor(null), NOT_CAUGHT));
check("source: routing guard before startAnswer", () => {
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.includes("isClearFileQuestion(question)") && g.includes("clarifyFor(lastAct())"));
});

// Team messages: no patient / patient / ambiguous.
const pool = [
  { id: "d", fullName: "Destiny Greer", caseStatus: "Active" },
  { id: "k1", fullName: "Kara Smith", caseStatus: "Active" },
  { id: "k2", fullName: "Kara Jones", caseStatus: "Active" },
  { id: "c", fullName: "Collin Elliott", caseStatus: "Active" },
  { id: "h", fullName: "Howard Testa", caseStatus: "Active" },
];
const ids = (q: string) => { const t = parseTell(q); assert.ok(t, `not a tell: ${q}`); return patientsMentionedInMessage(t!.text, pool).map((p) => p.id); };
for (const q of ["message Hannah hey how are you, just testing this new feature out", "tell hannah good morning!", "message greg can you lock up tonight", "tell hannah thanks for today", "msg greg are we still on for lunch", "tell hannah the fax machine is jammed", "message hannah testing testing", "tell greg how's it going", "tell hannah to order more paper", "message hannah hello"]) check(`no patient: ${q}`, () => assert.deepEqual(ids(q), []));
for (const [q, id] of [["tell hannah collin elliott called", "c"], ["message hannah destiny greer needs a ride", "d"], ["tell greg to call kara smith back", "k1"], ["msg hannah collin's atty called", "c"]] as const) check(`patient: ${q}`, () => assert.deepEqual(ids(q), [id]));
for (const q of ["tell hannah kara called", "message greg call kara back"]) check(`ambiguous: ${q}`, () => assert.deepEqual(ids(q).sort(), ["k1", "k2"]));

console.log(`followups-memory: ${pass}/${pass + fail} passed (mock data only)`);
if (fail) process.exit(1);

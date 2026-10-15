/**
 * "/" command step-by-step flows (/note, /todo, /contact). Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/slash-flows.test.ts
 */
import assert from "node:assert/strict";
import { breaksFlow, continueFlow, startFlow, TOKEN, type FlowCtx, type FlowTurn } from "../../../src/lib/goat-slash-flow";
import { parseSlash, slashQuery } from "../../../src/lib/goat-briefs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const ctx: FlowCtx = {
  today: "2026-10-15",
  patients: [
    { id: "js1", fullName: "John Mocksmith", caseStatus: "Active" },
    { id: "js2", fullName: "John Mocksmith", caseStatus: "Paid" },
    { id: "ann", fullName: "Ann Sample", caseStatus: "Submitted" },
  ],
  contacts: [
    { id: "c1", name: "Ward Mock Law Firm", category: "Attorney", phone: "817-555-0100" },
    { id: "c2", name: "Mock Open MRI", category: "Imaging Center" },
  ],
  openPatientId: null,
};
const start = (t: string) => { const s = parseSlash(t)!; return startFlow(s.cmd, s.rest, ctx); };
const step = (t: string, prev: FlowTurn | null, c: FlowCtx = ctx) => continueFlow(t, prev?.pending ?? null, c);
const tok = (turn: FlowTurn | null, i = 0) => turn!.choices![i].token;

// "/" only at the very start
check("slash first char", () => assert.equal(slashQuery("/"), ""));
check("mid-sentence slash", () => { assert.equal(slashQuery("on 10/"), null); assert.equal(parseSlash("see you 10/20"), null); assert.equal(parseSlash("10/20 appt"), null); });

// /note
const n0 = start("/note");
check("/note asks which case", () => { assert.match(n0!.say, /Which case/); assert.deepEqual(n0!.pending, { k: "notePick" }); });
check("/note with open patient offers it", () => assert.equal(startFlow("note", "", { ...ctx, openPatientId: "ann" })!.choices![0].token, `${TOKEN}note-case ann`));
const n1 = step("john mocksmith", n0);
check("/note picker lists both cases, active first", () => { assert.equal(n1!.choices!.length, 2); assert.match(n1!.choices![0].label, /Active/); assert.match(n1!.say, /Which case\? \(2 match\)/); });
const n2 = step(tok(n1), n1);
check("/note case picked → asks text", () => { assert.match(n2!.say, /What should the note for John Mocksmith say/); assert.deepEqual(n2!.pending, { k: "noteText", patientId: "js1" }); });
const n3 = step("spoke to atty about reduction", n2);
check("/note text → confirm action", () => { assert.deepEqual(n3!.action, { type: "noteConfirm", patientId: "js1", text: "spoke to atty about reduction" }); assert.equal(n3!.pending, null); });
check("/note name only → picker", () => assert.equal(start("/note ann")!.choices![0].token, `${TOKEN}note-case ann`));
check("/note single match asks to verify", () => assert.match(start("/note ann")!.say, /Is this the case/));
check("/note name: text → one-shot path", () => assert.equal(start("/note ann: called"), null));
check("/note unknown name", () => { const t = step("zelda", n0); assert.match(t!.say, /couldn't find/); assert.deepEqual(t!.pending, { k: "notePick" }); });
check("cancel", () => { const t = step("cancel", n2); assert.equal(t!.pending, null); assert.match(t!.say, /cancel/i); });
check("new command replaces step", () => assert.equal(step("/todo", n2), null));

// /todo
const t0 = start("/todo");
check("/todo asks kind", () => { assert.match(t0!.say, /Just a to-do, or add it to a case/); assert.deepEqual(t0!.choices!.map((c) => c.label), ["Just a to-do", "Add to a case"]); });
const tp = step(tok(t0, 0), t0);
check("just a to-do → text", () => assert.deepEqual(tp!.pending, { k: "todoText" }));
check("plain todo confirm", () => assert.deepEqual(step("order supplies friday", tp)!.action, { type: "todoConfirm", title: "order supplies", due: "2026-10-16", patientId: undefined }));
const tc = step(tok(t0, 1), t0);
check("add to case → which case", () => assert.deepEqual(tc!.pending, { k: "todoPick" }));
const tc2 = step(tok(step("ann", tc)), tc);
check("case picked → text", () => assert.deepEqual(tc2!.pending, { k: "todoText", patientId: "ann" }));
check("case todo confirm", () => assert.deepEqual(step("request records tomorrow", tc2)!.action, { type: "todoConfirm", title: "request records", due: "2026-10-16", patientId: "ann" }));
check("typed 'add to a case'", () => assert.deepEqual(step("add to a case", t0)!.pending, { k: "todoPick" }));
check("typed 'just a todo'", () => assert.deepEqual(step("just a todo", t0)!.pending, { k: "todoText" }));
check("/todo with text → one-shot", () => assert.equal(start("/todo call atty"), null));
check("empty todo text re-asks", () => assert.deepEqual(step("tomorrow", tp)!.pending, { k: "todoText" }));

// /contact
const c0 = start("/contact");
check("/contact asks add or edit", () => { assert.equal(c0!.say, "Add or edit?"); assert.deepEqual(c0!.choices!.map((c) => c.label), ["Add", "Edit"]); });
const ca = step(tok(c0, 0), c0);
check("add → prompt", () => { assert.match(ca!.say, /one contact .* or paste a list/); assert.deepEqual(ca!.pending, { k: "contactAdd" }); });
check("add single → paste action", () => assert.deepEqual(step("Mock Legal, 817-555-0111, 1 Main St, Fort Worth, TX 76102", ca)!.action, { type: "contactPaste", text: "Mock Legal, 817-555-0111, 1 Main St, Fort Worth, TX 76102" }));
check("add list → paste action", () => assert.equal(step("A Mock Law\n817-555-0001\n\nB Mock Law\n817-555-0002", ca)!.action!.type, "contactPaste"));
check("/contact + pasted list → straight to review", () => assert.equal(start("/contact A Mock Law\n817-555-0001")!.action!.type, "contactPaste"));
const ce = step(tok(c0, 1), c0);
check("edit → which contact", () => assert.deepEqual(ce!.pending, { k: "contactPick" }));
const ce2 = step("ward", ce);
check("edit picker", () => assert.equal(tok(ce2), `${TOKEN}contact-pick c1`));
check("edit pick → edit card", () => assert.deepEqual(step(tok(ce2), ce2)!.action, { type: "contactEdit", contactId: "c1" }));
check("edit no match", () => assert.match(step("zzz", ce)!.say, /No contact matches/));
check("/contact edit mri", () => assert.equal(tok(start("/contact edit mri")), `${TOKEN}contact-pick c2`));
check("/contact add", () => assert.deepEqual(start("/contact add")!.pending, { k: "contactAdd" }));
check("stale token ignored", () => assert.equal(step(`${TOKEN}contact-pick nope`, null), null));
check("no pending → not a flow", () => assert.equal(step("hello", null), null));

// Live bug 10/15: chips typed/tapped during a waiting step were treated as a patient name.
for (const [name, prev] of [["/note picker", n0], ["/note text", n2], ["/todo kind", t0], ["/todo case pick", tc], ["/todo text", tp], ["/contact kind", c0], ["/contact add", ca], ["/contact edit pick", ce]] as const) {
  for (const chip of ["Morning Rundown", "Appointment Check", "Quick Biz", "appointment check", "how's business", "help", "what can you do?", "@hannah call kara", "/todo", "/contact"]) {
    check(`${name} + "${chip}" breaks out`, () => assert.equal(step(chip, prev), null));
  }
}
check("breaksFlow chips", () => { for (const c of ["Morning Rundown", "Appointment Check", "Quick Biz"]) assert.ok(breaksFlow(c)); });
check("breaksFlow not names", () => { for (const c of ["john mocksmith", "ann", "spoke to atty", "order supplies friday"]) assert.equal(breaksFlow(c), false); });
check("breaksFlow pasted list", () => assert.ok(breaksFlow("A Mock Law\n817-555-0001\n1 Main St, Fort Worth, TX 76102\n\nB Mock Law\n817-555-0002")));
check("tokens never break", () => assert.equal(breaksFlow(`${TOKEN}note-case ann`), false));
check("picker gives up on a question", () => { assert.equal(step("how many submitted cases do we have?", n0), null); assert.equal(step("what's on the schedule today", tc), null); });
check("picker still takes a name", () => assert.ok(step("ann sample", n0)!.choices));
check("abandon then switch: /note → /todo", () => { assert.equal(step("/todo", n0), null); assert.match(start("/todo")!.say, /Just a to-do/); });
check("chip token after reload (no pending) still works", () => assert.deepEqual(step(`${TOKEN}note-case ann`, null)!.pending, { k: "noteText", patientId: "ann" }));
check("typed text after reload (no pending) is not swallowed", () => assert.equal(step("Appointment Check", null), null));

// Wiring guards in the chat component.
const ui = readFileSync("src/components/global-goat.tsx", "utf8");
const sendSrc = ui.slice(ui.indexOf("const send = (raw: string"));
check("send: briefs before flows", () => assert.ok(sendSrc.indexOf("detectBrief(question)") < sendSrc.indexOf("tryFlow(question)")));
check("send: new request resets flow first", () => assert.ok(sendSrc.indexOf("breaksFlow(question, flowRef.current)) flowRef.current = null") < sendSrc.indexOf('question.startsWith("@")')));
check("chips dispatch directly", () => { assert.match(ui, /onClick=\{\(\) => runChip\(c\)\}/); assert.match(ui, /const runChip = [\s\S]{0,80}flowRef\.current = null/); });
check("clear chat resets flow + dialog", () => assert.match(ui, /clearChat\(\);[\s\S]{0,200}flowRef\.current = null;[\s\S]{0,60}dialogRef\.current = emptyDialog\(\)/));
check("flow state not persisted", () => assert.doesNotMatch(ui, /localStorage[^\n]*flow|dualWriteKv[^\n]*flow/i));
check("import double-click guard", () => assert.match(ui, /importingRef\.current\.has\(msg\.id\)/));
console.log(`slash-flows: ${pass}/${pass + fail} passed (mock data only)`);
if (fail) process.exit(1);

/**
 * Eval: reminders that name a contact, law firm, patient or phone stay to-dos.
 * "remind me to call Vaz MKLX new case 555-310-0199" must never turn into
 * "Which contact did you mean?" (contact lookup) or a patient lookup.
 * Mock data only. Run: npx tsx scripts/tests/goat-eval/reminder-names.test.ts
 */
import assert from "node:assert/strict";
import { detectPlainTodo } from "../../../src/lib/goat-intents";
import { parseTodo } from "../../../src/lib/goat-briefs";
import { detectPracticeIntent, type PracticeData } from "../../../src/lib/goat-practice";
import { answerOffice } from "../../../src/lib/goat-office";
import { breaksFlow, startFlow, type FlowCtx } from "../../../src/lib/goat-slash-flow";
import { isNoPatientName } from "../../../src/lib/goat-intents";
import { parseSlash } from "../../../src/lib/goat-briefs";
import { readFileSync } from "node:fs";

const TODAY = "2026-10-19";
const data: PracticeData = {
  today: TODAY,
  patients: [
    { id: "p1", fullName: "Mary Mockton", caseStatus: "Active", attorney: "Mock Law", listYear: 2026 },
    { id: "p2", fullName: "Collin Sample", caseStatus: "Active", attorney: "MKLX", listYear: 2026 },
  ] as PracticeData["patients"],
  tasks: [],
  appointments: [],
  contacts: [
    { id: "c1", name: "MKLX", phone: "555-999-4903" },
    { id: "c2", name: "Mock & Partners Law", phone: "555-0100" },
    { id: "c3", name: "Sample Imaging Center", phone: "555-0101", fax: "555-0102" },
  ] as never,
};

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

const CASES: Array<[string, string]> = [
  ["remind me to call Vaz MKLX new case 555-310-0199", "Call Vaz MKLX new case 555-310-0199"],
  ["remind me to call MKLX about the reduction", "Call MKLX about the reduction"],
  ["remind me to get the fax number for Sample Imaging Center", "Get the fax number for Sample Imaging Center"],
  ["remind me to call Mock & Partners Law for Mary Mockton 555-0100", "Call Mock & Partners Law for Mary Mockton 555-0100"],
  ["add to-do call Mock & Partners Law phone number 555-222-0101", "Call Mock & Partners Law phone number 555-222-0101"],
  ["todo: text Collin Sample new case MKLX", "Text Collin Sample new case MKLX"],
  ["remind me to email MKLX how many cases are submitted", "Email MKLX how many cases are submitted"],
  ["add a task to call Mary Mockton 555-444-1212", "Call Mary Mockton 555-444-1212"],
];
for (const [q, want] of CASES) {
  check(`todo text: ${q}`, () => {
    const t = detectPlainTodo(q);
    assert.ok(t, "not a to-do");
    assert.equal(parseTodo(t.text, TODAY).title, want);
  });
  check(`no contact/office hijack: ${q}`, () => {
    assert.equal(detectPracticeIntent(q), null);
    assert.equal(answerOffice(q, data), null);
  });
  check(`ends a waiting step: ${q}`, () => assert.equal(breaksFlow(q, { k: "contactPick" } as never), true));
}
// /todo + the "No patient" chip: "none" is reserved, never fuzzy-matched to a patient named Nune.
const fctx: FlowCtx = {
  today: TODAY,
  patients: [
    { id: "n1", fullName: "Nune Mockyan", caseStatus: "Active" }, { id: "n2", fullName: "Nune Samplian", caseStatus: "Paid" }, { id: "n3", fullName: "Nune Fakeyan", caseStatus: "Active" },
    { id: "v1", fullName: "Vaz Mockerian", caseStatus: "Active" }, { id: "v2", fullName: "Vaz Samplov", caseStatus: "Discharged" },
  ],
  contacts: [{ id: "c1", name: "MKLX", category: "Attorney", phone: "555-999-4903" }],
  openPatientId: null,
};
const slashFlow = (t: string) => { const s = parseSlash(t)!; return startFlow(s.cmd, s.rest, fctx); };
for (const w of ["none", "None", "no patient", "general", "no case"]) {
  check(`reserved: ${w}`, () => assert.ok(isNoPatientName(w)));
  check(`chip tap /todo ${w}: … → no case picker`, () => assert.equal(slashFlow(`/todo ${w}: call Vaz MKLX new case 555-310-0199`), null));
}
for (const w of ["Nune", "nune mockyan", "Vaz"]) check(`not reserved: ${w}`, () => assert.ok(!isNoPatientName(w)));
check("chip text keeps the to-do", () => { const t = parseTodo("none: call Vaz MKLX new case 555-310-0199", TODAY); assert.ok(isNoPatientName(t.name)); assert.equal(t.title, "call Vaz MKLX new case 555-310-0199"); });
check("/todo call Vaz … (first name inside) → no case picker", () => assert.equal(slashFlow("/todo call Vaz MKLX new case 555-310-0199"), null));
check("/todo Nune Mockyan: … still picks Nune's case", () => assert.ok(slashFlow("/todo Nune Mockyan: request records")));
const ui = readFileSync("src/components/global-goat.tsx", "utf8");
check("UI: no forced 'Which patient is this to-do for?'", () => assert.ok(!ui.includes("Which patient is this to-do for?")));
check("UI: reserved names skip the patient match", () => assert.ok((ui.match(/isNoPatientName\(t\.name\)/g) ?? []).length >= 3));

// Lookups still work when it isn't a reminder.
check("MKLX number is a lookup", () => assert.match(answerOffice("MKLX number", data)?.text ?? "", /555-999-4903/));
check("show my todos is the list", () => assert.equal(detectPracticeIntent("show my todos")?.kind, "todo"));

console.log(`reminder-names: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

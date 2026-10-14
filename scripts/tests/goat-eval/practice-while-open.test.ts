/**
 * Eval: practice-wide questions asked WHILE a patient's file is open (Mary
 * Hardin), plus signatures from the login and the Case Notes line format.
 * Mock data only. Run: npx tsx scripts/tests/goat-eval/practice-while-open.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import { isPracticeWide, type PracticeData } from "../../../src/lib/goat-practice";
import { answerOffice } from "../../../src/lib/goat-office";
import { appendNote, formatNote, signatureFor, signerFromLogin, stripNameTokens } from "../../../src/lib/goat-notes";
import { planAddNote } from "../../../src/lib/goat-commands";

const TODAY = "2026-10-14";
const sub = (i: number, year: number, cash = false) => ({ id: `s${year}-${i}`, fullName: `Mock Submitted${i} Y${year}${cash ? "c" : ""}`, caseStatus: "Submitted", attorney: "Mock Law", listYear: year, cash });
const data: PracticeData = {
  today: TODAY,
  patients: [
    { id: "p-mary", fullName: "Mary Hardin", caseStatus: "Active", attorney: "Mock Law", listYear: 2026 },
    { id: "p-collin", fullName: "Collin Elliott", caseStatus: "Active", attorney: "Sample Law", listYear: 2026 },
    { id: "p-dave", fullName: "Dave Casey", caseStatus: "Active", attorney: "", listYear: 2026 },
    ...Array.from({ length: 43 }, (_, i) => sub(i, 2026)),
    ...Array.from({ length: 5 }, (_, i) => sub(i, 2025)),
    sub(0, 2026, true),
  ] as PracticeData["patients"],
  tasks: [{ id: "t1", title: "Call Mock Law", done: false, dueDate: TODAY } as never],
  appointments: [{ id: "a1", patientId: "p-mary", patientName: "Mary Hardin", provider: "", location: "Hulen", appointmentType: "Follow-Up Visit", caseLabel: "", room: "", date: TODAY, startTime: "09:00", durationMin: 15, status: "Scheduled", note: "", overrideOfficeHours: false } as never],
  contacts: [{ id: "c1", name: "Mock Imaging Center", phone: "555-0100", fax: "555-0101", email: "img@example.com" } as never],
};
const ctx: DialogCtx = { data, team: [{ firstName: "Hannah", label: "Hannah" }], openPatientId: "p-mary", settings: getDefaultScheduleSettings() };

const SUBMITTED = [
  "how many submitted cases do we have", "how many submitted cases do we have?", "how many submitted do we have", "How many submitted cases?",
  "how many cases are submitted", "how many submitted files do we have", "how many checks are we waiting on", "how many checks waiting",
  "what checks are pending", "do we have any submitted cases", "how many of our cases are submitted", "how many submitted patients do we have",
  "submitted cases count", "how many submited cases do we have", "how many cases have we submitted", "count submitted cases",
];
const OTHER_OFFICE: Array<[string, RegExp]> = [
  ["how many active cases do we have", /Active/], ["how many open cases do we have", /Active/], ["how many cases do we have", /Active cases/],
  ["how many patients do we have", /Active cases|appointment/], ["whats on our to do list", /to-do|Call Mock Law/i], ["what's on the todo list", /to-do|Call Mock Law/i],
  ["show me our tasks", /to-do|Call Mock Law/i], ["any to dos today", /to-do|Call Mock Law/i], ["whats on the schedule today", /Mary Hardin|9:00/],
  ["who's coming in today", /Mary Hardin|9:00/], ["how many visits do we have today", /1 appointment/], ["how many appointments today", /1 appointment|Mary/],
  ["what's our schedule tomorrow", /Nothing|tomorrow/i], ["mock imaging center fax", /555-0101/], ["what's the phone number for mock imaging", /555-0100/],
  ["mock imaging center email", /img@example/], ["how many ready to submit cases do we have", /Ready To Submit/], ["how many discharged cases do we have", /Discharged/],
  ["how many dropped cases", /Dropped/], ["how many paid cases do we have", /Paid/], ["list submitted cases", /Submitted/], ["which cases are submitted", /Submitted/],
  ["how many cases do we have open", /Active/], ["do we have many submitted cases", /Submitted/], ["how many have we made submitted", /Submitted|help/i],
];

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

for (const q of SUBMITTED) check(q, () => {
  const r = goatTurn(q, emptyDialog(), ctx).reply;
  assert.equal(r.kind, "office", `${r.kind}: ${r.say}`);
  assert.match(r.say, /Submitted.*in 2026: 43\b/, r.say);
  assert.match(r.say, /Patients list/);
  assert.ok(!/hidden/i.test(r.say));
});
for (const [q, want] of OTHER_OFFICE) check(q, () => {
  const r = goatTurn(q, emptyDialog(), ctx).reply;
  assert.ok(r.kind === "office" || r.kind === "help", `${r.kind}: ${r.say}`);
  if (r.kind === "office") assert.match(r.say, want, r.say);
  assert.ok(!("patientId" in r && r.patientId === "p-mary"), "answered from Mary's file");
  assert.ok(!/hidden for your account/i.test(r.say));
});
// Practice-wide wording never turns into a file question on the open patient.
for (const q of [...SUBMITTED, ...OTHER_OFFICE.map((x) => x[0])]) check(`wide:${q}`, () => {
  const r = goatTurn(q, emptyDialog(), ctx).reply;
  assert.notEqual(r.kind, "fileQuestion");
});
// But real patient questions still go to the patient.
check("patient q still works", () => assert.equal(goatTurn("when is mary's next visit?", emptyDialog(), ctx).reply.kind, "fileQuestion"));
check("her visits not practice-wide", () => assert.ok(!isPracticeWide("how many visits does she have")));
check("scope stated + cash excluded", () => assert.match(answerOffice("how many submitted cases", data)!.text, /in 2026: 43\. \(Same as the Patients list, PI tab, 2026, Status Submitted\. All years: 49\.\)/));
check("source routes wide before open patient", () => {
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.indexOf("if (isPracticeWide(question))") > 0 && g.indexOf("if (isPracticeWide(question))") < g.indexOf("startAnswer(p, question, Boolean(current));"));
});

// Signatures from the login.
check("doctor member", () => assert.equal(signatureFor(signerFromLogin({ userId: "u1", isMember: true, memberLabel: "Mike Galstyan", ownerName: "", doctors: [{ name: "Dr. Mike Galstyan", memberUserId: "u1" }] })!), "-Dr. Mike"));
check("staff member", () => assert.equal(signatureFor(signerFromLogin({ userId: "u2", isMember: true, memberLabel: "Hannah Mitchell", ownerName: "", doctors: [] })!), "-Hannah M."));
check("owner fallback", () => assert.equal(signatureFor(signerFromLogin({ userId: "o", isMember: false, memberLabel: "", ownerName: "Dr. Abi Mock", doctors: [] })!), "-Dr. Abi"));
check("role label falls back to doctor list", () => assert.equal(signatureFor(signerFromLogin({ userId: "u3", isMember: true, memberLabel: "Front Desk", ownerName: "", doctors: [{ name: "Dr. Greg Test", memberUserId: "u3" }] })!), "-Dr. Greg"));
check("no setup prompt", () => assert.ok(!readFileSync("src/components/global-goat.tsx", "utf8").includes("No signature set up")));

// Note line format and name stripping.
const at = new Date(2026, 9, 14, 1, 32);
const mike = { firstName: "Mike", doctor: true };
check("collin eliliot note", () => {
  const step = planAddNote("note for collin eliliot i spoke to atty about red req", data.patients.map((p) => ({ id: p.id, fullName: p.fullName, active: true })), null);
  assert.equal(step?.kind, "confirm");
  const s = step as { patient: { id: string; fullName: string }; text: string };
  assert.equal(s.patient.id, "p-collin");
  assert.equal(formatNote(stripNameTokens(s.text, s.patient.fullName), mike, at), "10/14/26 - Spoke to atty about red req -Dr. Mike");
});
check("strip all name tokens", () => assert.equal(stripNameTokens("collin eliliot i spoke to atty", "Collin Elliott"), "i spoke to atty"));
check("no time, date only", () => assert.ok(!/AM|PM/.test(formatNote("called", mike, at))));
check("appended on a new line", () => assert.equal(appendNote("10/01/26 - Old -Dr. Mike\n", "10/14/26 - New -Dr. Mike"), "10/01/26 - Old -Dr. Mike\n10/14/26 - New -Dr. Mike"));
check("written to Case Notes store", () => assert.match(readFileSync("src/components/global-goat.tsx", "utf8"), /setCaseNote\(d\.patientId, appendNote\(existing, line\)\)/));
check("many is not Mary", () => assert.notEqual(goatTurn("how many cases do we have", emptyDialog(), { ...ctx, openPatientId: null }).reply.kind, "fileQuestion"));

const phr = SUBMITTED.length + OTHER_OFFICE.length;
console.log(`practice-while-open: ${pass}/${pass + fail} checks passed (${phr} phrasings asked with Mary Hardin open)`);
if (fail) process.exit(1);

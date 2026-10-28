/**
 * Handbook + G.O.A.T. for today's features. Mock data only (no patient data).
 *  1. how-to questions land on the right Handbook section with the real labels
 *  2. "set compliance for X to Yes" → one confirm plan; ambiguity asks; column off / no edit access say so
 *  3. "how many patients non-compliant", breakdown, Not set
 *  4. "what notes does X have" reads the quick-notes log + Earlier notes
 *  5. stale Handbook text is gone
 * Run: npx tsx scripts/tests/goat-eval/handbook-today.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerHowToFull } from "../../../src/lib/goat-howto-handbook";
import { getDefaultComplianceOptions, addComplianceOption, setComplianceOptionShown } from "../../../src/lib/compliance";
import { understandCompliance, type ComplianceCtx } from "../../../src/lib/goat-compliance";
import type { CaseNoteEntry } from "../../../src/lib/case-note-entries";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const admin = { admin: true, manager: true };

// ── 1. how-to ──
for (const [q, must] of [
  ["where do I set the delete password", /Patient-Delete Password/],
  ["how do I change the delete password", /Patient-Delete Password/],
  ["how do I turn on the compliance column", /Compliance column/],
  ["how do I add a compliance option", /New Compliance Option/],
  ["how do I rename a compliance category", /Compliance Categories/],
  ["how do I filter by compliance", /Compliance filter/],
  ["how do I add a note to a patient", /Add note/],
  ["how do I change the date on a note", /Only the Owner and Admins see the Date box/],
  ["what are earlier notes", /Earlier notes/],
  ["how do I set a team member's main location", /Main location/],
  ["how do I filter the activity log by person", /Person/],
  ["how do I add a team member", /Settings → Office tab → Team Members/],
  ["how do I change the case number format", /Case number format/],
  ["how do I change a patient's office", /No office set/],
  ["how do I use the ask calculator", /Ask calculator/],
  ["what is the percent paid and percent disc", /% Disc\./],
] as Array<[string, RegExp]>) {
  check(`how-to: ${q}`, () => { const a = answerHowToFull(q, admin); assert.ok(a.found, a.text); assert.match(a.text, must); assert.ok(a.links.length >= 1); });
}
check("how-to: G.O.A.T. can answer 'how do I use /note and /todo'", () => { const a = answerHowToFull("how do I use the /todo command", admin); assert.match(a.text, /\/note|\/todo/); });
check("how-to: timeframe ask is explained", () => { const a = answerHowToFull("why does goat ask for which time frame", admin); assert.match(a.text, /time frame/i); });

// ── 5. stale text gone ──
const hb = readFileSync("src/lib/handbook-content.ts", "utf8");
check("Team Members path updated", () => { assert.doesNotMatch(hb, /Settings → Team Members → \+ Team Member/); });
check("delete password explained as ONE cloud password", () => { assert.match(hb, /same single password/); assert.match(hb, /same on every computer and for every team member/); });

// ── 2–4. compliance + notes ──
const options = getDefaultComplianceOptions();
const patients = [
  { id: "p1", fullName: "Testerson, Mockly", dob: "1980-01-02", dateOfLoss: "2026-05-01", caseStatus: "Active", compliance: "Non-Compliant" },
  { id: "p2", fullName: "Fakename, Pat", dob: "1975-03-04", dateOfLoss: "2026-06-01", caseStatus: "Active", compliance: "Yes" },
  { id: "p3", fullName: "Sample, Sam", dob: "1990-05-06", dateOfLoss: "2026-04-01", caseStatus: "Discharged", compliance: "Non-Compliant" },
  { id: "p4", fullName: "Dummy, Dana", dob: "1991-07-08", dateOfLoss: "2026-03-01", caseStatus: "Active", compliance: "" },
  { id: "p5", fullName: "Placeholder, Lee", dob: "1982-09-10", dateOfLoss: "2026-02-01", caseStatus: "Active" },
  { id: "p6", fullName: "Mockman, Joe", dob: "1960-01-01", dateOfLoss: "2026-01-01", caseStatus: "Active", compliance: "DNS ATM" },
  { id: "p7", fullName: "Mockman, Jane", dob: "1962-02-02", dateOfLoss: "2026-01-02", caseStatus: "Active", compliance: "Yes" },
];
const note = (id: string, patientId: string, date: string, author: string, text: string): CaseNoteEntry =>
  ({ id, patientId, text, date, author, authorUserId: "u", createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z` });
const notes: CaseNoteEntry[] = [
  note("n1", "p1", "2026-10-01", "Dr. Mock", "Called about missed visit"),
  note("n2", "p1", "2026-10-20", "Hannah Example", "Rescheduled for Friday"),
  { ...note("n3", "p1", "2026-10-25", "Dr. Mock", "deleted one"), deleted: true },
];
const ctx = (over: Partial<ComplianceCtx> = {}): ComplianceCtx => ({
  patients, options, enabled: true, canEdit: true, canViewPatients: true,
  notesFor: (id) => ({ entries: notes.filter((n) => n.patientId === id), legacy: id === "p1" ? "Old typed note about the lawyer." : "" }),
  ...over,
});
const U = (q: string, c = ctx()) => understandCompliance(q, c);
const plan = (q: string, c = ctx()) => { const r = U(q, c); assert.ok(r && r.kind === "plan", `${q} → ${JSON.stringify(r)}`); return r.plan; };
const say = (q: string, c = ctx()) => { const r = U(q, c); assert.ok(r && r.kind === "say", `${q} → ${JSON.stringify(r)}`); return r.text; };

check("set compliance for X to Yes → one plan, old → new", () => {
  const p = plan("set compliance for Dana Dummy to Yes");
  assert.equal(p.kind, "compliance"); assert.equal(p.patientId, "p4"); assert.equal(p.compliance, "Yes");
  assert.match(p.summary, /Set Dana Dummy's compliance to Yes\? \(was not set\)/);
});
check("last, first order and 'update … to'", () => { const p = plan("update compliance of Mockly Testerson to DNS ATM"); assert.equal(p.patientId, "p1"); assert.equal(p.compliance, "DNS ATM"); assert.match(p.summary, /was Non-Compliant/); });
check("mark X non-compliant / compliant", () => {
  assert.equal(plan("mark Pat Fakename as non-compliant").compliance, "Non-Compliant");
  assert.equal(plan("mark Dana Dummy compliant").compliance, "Yes");
  assert.equal(plan("change Lee Placeholder's compliance to new patient").compliance, "New Patient");
});
check("'no' is an option here, not a stop word", () => assert.equal(plan("set compliance for Pat Fakename to No").compliance, "No"));
check("already that value → says so, no card", () => assert.match(say("set compliance for Pat Fakename to Yes"), /already Yes/));
check("clear compliance → plan with empty value", () => { const p = plan("clear compliance for Pat Fakename"); assert.equal(p.compliance, ""); assert.match(p.summary, /Clear Pat Fakename's compliance\? \(was Yes\)/); });
check("two patients match → asks, never picks", () => { const t = say("set compliance for Mockman to Yes"); assert.match(t, /More than one patient/); assert.match(t, /Joe Mockman/); assert.match(t, /Jane Mockman/); });
check("no such patient → asks which patient", () => assert.match(say("set compliance for Zzyzx Nobody to Yes"), /Which patient/));
check("unknown option → lists the office's options", () => assert.match(say("set compliance for Pat Fakename to maybe"), /Your options: New Patient, Yes, No, DNS ATM, Non-Compliant/));
check("column off → says how to turn it on, no card", () => { const r = U("set compliance for Pat Fakename to No", ctx({ enabled: false })); assert.ok(r && r.kind === "say"); assert.match(r.text, /Compliance column/); assert.ok(r.links?.[0].href.includes("caseStatuses")); });
check("no edit access → can't change", () => assert.match(say("set compliance for Pat Fakename to No", ctx({ canEdit: false })), /can't edit patients/));
check("a custom option the office added works", () => {
  const opts = addComplianceOption(options, "Needs Follow-up", "#ff8800", "2026-10-27T00:00:00Z", "c-mock1");
  const p = plan("set compliance for Dana Dummy to needs follow-up", ctx({ options: opts }));
  assert.equal(p.compliance, "c-mock1");
});
check("a hidden option is not offered", () => {
  const opts = setComplianceOptionShown(options, "DNS ATM", false, "2026-10-27T00:00:00Z");
  assert.match(say("set compliance for Dana Dummy to DNS ATM", ctx({ options: opts })), /hidden/);
});
check("never mistakes a normal question for a set", () => { assert.equal(U("how do I set compliance"), null); assert.equal(U("what time is my next patient"), null); assert.equal(U("add a note for Dana Dummy: set compliance"), null); });

check("how many patients are non-compliant → count + names + link", () => {
  const r = U("how many patients are non-compliant")!;
  assert.ok(r.kind === "say"); assert.match(r.text, /^2 patients are marked Non-Compliant \(1 with an active case\)/); assert.match(r.text, /Mockly Testerson/); assert.match(r.text, /Sam Sample/); assert.equal(r.links?.[0].href, "/patients");
});
check("who is non-compliant / not compliant / noncompliant", () => { for (const q of ["who is non-compliant", "who's not compliant", "list noncompliant patients"]) assert.match(say(q), /Mockly Testerson/, q); });
check("how many are compliant → Yes", () => assert.match(say("how many patients are compliant"), /^2 patients are marked Yes/));
check("how many have DNS ATM", () => assert.match(say("how many patients have DNS ATM"), /^1 patient is marked DNS ATM/));
check("no compliance set → Not set list", () => { const t = say("how many patients have no compliance set"); assert.match(t, /^2 patients are without a Compliance value/); assert.match(t, /Dana Dummy/); assert.match(t, /Lee Placeholder/); });
check("compliance breakdown", () => { const t = say("compliance breakdown"); assert.match(t, /across 7 patients/); assert.match(t, /Non-Compliant: 2/); assert.match(t, /Yes: 2/); assert.match(t, /Not set: 2/); });
check("count with the column off → says it's off", () => assert.match(say("how many patients are non-compliant", ctx({ enabled: false })), /turned off/));
check("what is X's compliance", () => { assert.match(say("what's Mockly Testerson's compliance"), /Non-Compliant/); assert.match(say("what is Dana Dummy's compliance"), /no Compliance value/); });

check("what notes does X have → newest first, author, Earlier notes", () => {
  const r = U("what notes does Mockly Testerson have")!; assert.ok(r.kind === "say");
  assert.match(r.text, /2 notes plus Earlier notes/);
  assert.ok(r.text.indexOf("Rescheduled for Friday") < r.text.indexOf("Called about missed visit"), "newest first");
  assert.match(r.text, /10\/20\/26 · Hannah Example/); assert.match(r.text, /Earlier notes: Old typed note about the lawyer\./);
  assert.doesNotMatch(r.text, /deleted one/); assert.equal(r.links?.[0].href, "/patients/p1");
});
check("show X's notes / read notes", () => { for (const q of ["show Mockly Testerson's notes", "read the notes for Mockly Testerson", "any notes on Mockly Testerson"]) assert.match(say(q), /Rescheduled for Friday/, q); });
check("no notes yet → says so and points to /note", () => assert.match(say("what notes does Pat Fakename have"), /has no notes yet.*\/note/));
check("notes: two matches → asks; no access → refuses", () => { assert.match(say("what notes does Mockman have"), /More than one patient/); assert.match(say("what notes does Mockly Testerson have", ctx({ canViewPatients: false })), /doesn't have access/); });
check("ADDING a note is not handled here (that is /note)", () => { for (const q of ["add a note for Mockly Testerson: called", "write a note on Mockly Testerson", "/note Mockly Testerson hi"]) assert.equal(U(q), null, q); });
check("notes question with no patient falls through", () => assert.equal(U("what notes do I have"), null));

// Wiring: the chat asks BEFORE the general understanding step, and confirm saves through the patient save path.
const src = readFileSync("src/components/global-goat.tsx", "utf8");
check("chat runs understandCompliance before runUnderstand", () => { const a = src.indexOf("understandCompliance(question"); const b = src.indexOf("const u = runUnderstand(question)"); assert.ok(a > 0 && b > a); });
check("confirming a compliance card saves via updatePatientRecordById", () => { const i = src.indexOf('plan.kind === "compliance"'); assert.ok(i > 0); assert.match(src.slice(i, i + 400), /updatePatientRecordById\(plan\.patientId, \{ compliance:/); });
check("a set is never applied without the card (understandCompliance is pure)", () => assert.doesNotMatch(readFileSync("src/lib/goat-compliance.ts", "utf8"), /updatePatientRecord|localStorage|fetch\(/));

console.log(`handbook-today: ${pass}/${pass + fail} passed (mock data only)`);
process.exit(fail ? 1 : 0);

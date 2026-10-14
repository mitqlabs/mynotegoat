/**
 * Add-note (name matching, signatures, append) and patient follow-ups. Mock data only.
 * Run:  npx tsx scripts/tests/goat-notes-followup.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendNote, defaultSigner, formatNote, isAddNoteRequest, matchPatientsByName, parseAddNote, signatureFor } from "../../src/lib/goat-notes";
import { expandFollowUp } from "../../src/lib/goat-followup";
import { findPatientsInQuestion } from "../../src/lib/goat-ai/global-chat";
import { isPatientSpecific } from "../../src/lib/goat-practice";
import { answerOffice } from "../../src/lib/goat-office";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const pts = [
  { id: "p1", fullName: "Kara Testpatient" },
  { id: "p2", fullName: "Jane Sample" },
  { id: "p3", fullName: "Jane Example" },
  { id: "p4", fullName: "Bob Sample" },
];

test("parse add-note requests", () => {
  assert.deepEqual(parseAddNote("add note to kara's file: spoke to atty waiting for reduction."), { name: "kara", text: "spoke to atty waiting for reduction." });
  assert.deepEqual(parseAddNote("Add a note to Testpatient: called, left VM"), { name: "Testpatient", text: "called, left VM" });
  assert.deepEqual(parseAddNote("note for jane sample - mri scheduled"), { name: "jane sample", text: "mri scheduled" });
  assert.ok(isAddNoteRequest("add note to kara"));
  assert.ok(!isAddNoteRequest("what notes does kara have"));
});
test("match by first or last name; several → ask which", () => {
  assert.deepEqual(matchPatientsByName("kara", pts).map((p) => p.id), ["p1"]);
  assert.deepEqual(matchPatientsByName("testpatient", pts).map((p) => p.id), ["p1"]);
  assert.deepEqual(matchPatientsByName("testpatiant", pts).map((p) => p.id), ["p1"]);
  assert.deepEqual(matchPatientsByName("jane", pts).map((p) => p.id), ["p2", "p3"]);
  assert.deepEqual(matchPatientsByName("sample", pts).map((p) => p.id), ["p2", "p4"]);
  assert.deepEqual(matchPatientsByName("jane sample", pts).map((p) => p.id), ["p2"]);
  assert.deepEqual(matchPatientsByName("zed", pts), []);
});
test("signatures: -Dr. First for doctors, -First L. for others", () => {
  assert.equal(signatureFor({ firstName: "Mike", doctor: true }), "-Dr. Mike");
  assert.equal(signatureFor({ firstName: "Dr. abi Smith", doctor: true }), "-Dr. Abi");
  assert.equal(signatureFor({ firstName: "Hannah Lee", doctor: false }), "-Hannah L.");
  const at = new Date(2026, 9, 13, 14, 53);
  assert.equal(formatNote("spoke to atty waiting for reduction.", { firstName: "Mike", doctor: true }, at), "10/13/26 - Spoke to atty waiting for reduction. -Dr. Mike");
  assert.equal(formatNote("called", { firstName: "Greg", doctor: false }, at), "10/13/26 - Called -Greg");
  assert.equal(appendNote("old line\n\n", "new"), "old line\nnew");
  assert.equal(appendNote("", "new"), "new");
});
test("signer: linked login wins, else the last pick", () => {
  const list = [{ id: "a", firstName: "Mike", doctor: true, userId: "u1" }, { id: "b", firstName: "Hannah", doctor: false }];
  assert.deepEqual(defaultSigner(list, "u1", "b"), { signer: list[0], linked: true });
  assert.deepEqual(defaultSigner(list, "u9", "b"), { signer: list[1], linked: false });
  assert.deepEqual(defaultSigner(list, null, null), { signer: null, linked: false });
});
test("patient follow-ups keep the patient and swap the topic", () => {
  assert.equal(expandFollowUp("and the MRI?", "when was her x-ray"), "when was her MRI?");
  assert.equal(expandFollowUp("what about pm", "when was the ortho referral"), "when was the pm referral?");
  assert.equal(expandFollowUp("and the balance?", "what was her dob"), "what was her balance?");
  assert.equal(expandFollowUp("and the MRI?", null), null);
  assert.equal(expandFollowUp("when is her next visit", "when was her x-ray"), null);
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.includes("expandFollowUp(question") && g.includes("patientById(lastMentioned)"));
});
test("quick lookups from anywhere: bill/balance routes to the patient, not the office", () => {
  const f = findPatientsInQuestion("what's kara testpatient's balance", pts.map((p) => ({ ...p, dob: "", caseStatus: "Active" })) as never);
  assert.equal(f.confident?.patient.id, "p1");
  assert.ok(isPatientSpecific("what's her balance") && isPatientSpecific("bill for kara"));
  assert.equal(answerOffice("what's kara's balance", { patients: [], tasks: [], appointments: [], contacts: [], today: "2026-10-13" }), null);
});
test("notes save through the Notes store only after Confirm", () => {
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.includes("setCaseNote(d.patientId, appendNote(existing, line))"));
  assert.ok(g.indexOf("setCaseNote(") > g.indexOf("const saveNote"));
  assert.ok(!/isAddNoteRequest[\s\S]{0,1500}setCaseNote/.test(g.slice(g.indexOf("if (isAddNoteRequest"), g.indexOf("if (isAddNoteRequest") + 1500)));
});
console.log(`${passed} passed`);

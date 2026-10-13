/**
 * "tell <team member> <message> for <patient>" and whole-word / active-first name matching.
 * Mock data only.  Run:  npx tsx scripts/tests/goat-messages-matching.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTeam, isTellRequest, matchRecipient, messageBody, parseTell } from "../../src/lib/goat-message";
import { findPatientsInQuestion, type ChatPatient } from "../../src/lib/goat-ai/global-chat";
import { activeFirst, nameSearchMatches } from "../../src/lib/patient-name-match";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const P = (id: string, fullName: string, caseStatus = "Active"): ChatPatient => ({ id, fullName, dob: "1980-01-01", dateOfLoss: "2026-06-01", caseStatus });

test("parse tell requests", () => {
  assert.deepEqual(parseTell("tell hanna i need notes for John"), { to: "hanna", text: "i need notes for John", patientName: "John" });
  assert.deepEqual(parseTell("tell greg to call the atty about john smith"), { to: "greg", text: "call the atty about john smith", patientName: "john smith" });
  assert.deepEqual(parseTell("let hannah know the MRI came in for Kara"), { to: "hannah", text: "the MRI came in for Kara", patientName: "Kara" });
  assert.equal(parseTell("tell me kara's balance"), null);
  assert.ok(isTellRequest("tell hanna hi") && isTellRequest("let greg know x") && !isTellRequest("what did kara tell the doctor"));
});
test("recipient by first name from signatures + logins", () => {
  const team = buildTeam(
    [{ firstName: "Hannah", userId: "u2" }, { firstName: "Mike", doctor: true, userId: "u1" }, { firstName: "Greg" }],
    [{ userId: "u1", label: "Owner", email: "" }, { userId: "u3", label: "Front Desk", email: "sara.m@example.com" }, { userId: "u2", label: "Hannah B", email: "" }],
  );
  assert.deepEqual(matchRecipient("hanna", team).map((p) => p.userId), ["u2"]);
  assert.deepEqual(matchRecipient("mike", team).map((p) => p.label), ["Dr. Mike"]);
  assert.deepEqual(matchRecipient("sara", team).map((p) => p.userId), ["u3"]);
  assert.equal(matchRecipient("greg", team)[0].userId, undefined);
  assert.deepEqual(matchRecipient("zed", team), []);
  assert.equal(messageBody({ firstName: "Hannah", label: "Hannah" }, "i need notes for John", "-Dr. Mike"), "@Hannah i need notes for John -Dr. Mike");
});
test("trailing space = whole word (search boxes)", () => {
  assert.ok(nameSearchMatches("Armen Sample", "armen "));
  assert.ok(!nameSearchMatches("Armenuhi Sample", "armen "));
  assert.ok(nameSearchMatches("Armenuhi Sample", "armen"));
  assert.ok(nameSearchMatches("Sample, Armen", "armen sam"));
  assert.ok(!nameSearchMatches("Sample, Armenuhi", "armen sam"));
  assert.ok(nameSearchMatches("Doe, John", "john doe"));
});
test("trailing space = whole word (G.O.A.T.)", () => {
  const pts = [P("a", "Sample, Armen"), P("b", "Testyan, Armenuhi")];
  assert.equal(findPatientsInQuestion("armen next visit", pts).confident?.patient.id, "a");
  assert.equal(findPatientsInQuestion("next visit armen ", pts).confident?.patient.id, "a");
  assert.deepEqual(findPatientsInQuestion("next visit for armen", pts).candidates.map((c) => c.patient.id).sort(), ["a", "b"]);
});
test("Did you mean: every active match (no cap), inactive held back", () => {
  const pts = [...Array.from({ length: 9 }, (_, i) => P(`j${i}`, `Smith${String.fromCharCode(97 + i)}, John`)), P("x", "Doe, John", "Discharged"), P("y", "Roe, John", "Paid")];
  const r = findPatientsInQuestion("john last visit", pts);
  assert.equal(r.confident, null);
  assert.equal(r.candidates.length, 9);
  assert.deepEqual(r.inactive.map((c) => c.patient.id).sort(), ["x", "y"]);
  const onlyInactive = findPatientsInQuestion("john last visit", [P("x", "Doe, John", "Discharged"), P("y", "Roe, John", "Paid")]);
  assert.equal(onlyInactive.candidates.length, 2);
  assert.deepEqual(activeFirst([1, 2, 3], (n) => n === 2), { shown: [2], hidden: [1, 3] });
});
test("wiring: confirm-first message via the Messages save path; show inactive", () => {
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.includes("const ok = await postMessage({"));
  assert.ok(g.indexOf("postMessage({") > g.indexOf("function OpenMessageCard"));
  assert.ok(g.includes("Show inactive ("));
  for (const f of ["src/app/(portal)/patients/page.tsx", "src/app/(portal)/appointments/page.tsx", "src/components/new-appointment-modal.tsx", "src/components/patient-case-file.tsx"]) assert.ok(readFileSync(f, "utf8").includes("nameSearchMatches("), f);
});
console.log(`${passed} passed`);

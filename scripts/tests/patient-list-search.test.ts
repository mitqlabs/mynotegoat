/**
 * Patient List and Case List share matchesPatientListQuery.
 * Run: npx tsx scripts/tests/patient-list-search.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesPatientListQuery, nameSearchMatches } from "../../src/lib/patient-name-match";

const johan = "Gallardo, Johan";
const angelina = "Gallardo, Angelina";
const finds = (query: string, name: string) => matchesPatientListQuery(query, [name]);

for (const query of ["gallardo j", "johan g", "j gallardo", "gallardo, johan", "johan gallardo", "GALLARDO, JOHAN"]) {
  assert.equal(finds(query, johan), true, `${query} finds Johan`);
  assert.equal(finds(query, angelina), false, `${query} does not find Angelina`);
}
assert.equal(finds("gallardo", johan), true);
assert.equal(finds("gallardo", angelina), true, "last name alone still finds both");
assert.equal(finds("gallardo a", angelina), true, "last letter still being typed");

// A finished word stays whole. A one-letter word alone stays whole too.
assert.equal(nameSearchMatches("Sample, Armenuhi", "armen "), false);
assert.equal(nameSearchMatches("Sample, Armen", "armen "), true);
assert.equal(matchesPatientListQuery("armen sam", ["Sample, Armenuhi"]), false);
assert.equal(matchesPatientListQuery("armen sam", ["Sample, Armen"]), true);
assert.equal(finds("j ", johan), false, "a one-letter word by itself is whole");
assert.equal(finds("j ", "J, Someone"), true);

// Fields the lists already searched stay searchable.
assert.equal(
  matchesPatientListQuery("555-0199", ["Gallardo, Johan", "11/02/1988", "(323) 555-0199"]),
  true,
  "phone",
);
assert.equal(
  matchesPatientListQuery("11/02/1988", ["Gallardo, Johan", "11/02/1988", "(323) 555-0199"]),
  true,
  "dob",
);
assert.equal(matchesPatientListQuery("#1031", ["Gallardo, Johan", "Benson Legal Group", "#1031"]), true, "case number");
assert.equal(matchesPatientListQuery("benson", ["Gallardo, Johan", "Benson Legal Group"]), true, "attorney");
assert.equal(matchesPatientListQuery("   ", [johan]), true, "blank query matches");
assert.equal(matchesPatientListQuery("nobody", [johan]), false);

const folderList = readFileSync("src/components/patient-folder-views.tsx", "utf8");
const patientsPage = readFileSync("src/app/(portal)/patients/page.tsx", "utf8");
const schedule = readFileSync("src/app/(portal)/appointments/page.tsx", "utf8");
assert.match(folderList, /matchesPatientListQuery\(query, \[row\.name, row\.dob, row\.phone\]\)/);
assert.match(folderList, /matchesPatientListQuery\(query, \[row\.name, row\.attorney, row\.caseNumber, row\.phone, row\.address\]\)/);
assert.match(patientsPage, /matchesPatientListQuery\(searchDraft, \[patient\.fullName, patient\.attorney\]\)/);
assert.match(schedule, /matchesPatientListQuery\(schedulePatientSearch, \[appointment\.patientName\]\)/);
assert.match(schedule, /matchesPatientListQuery\(patientSearchDraft, \[patient\.fullName\]\)/);
assert.match(readFileSync("src/components/new-appointment-modal.tsx", "utf8"), /matchesPatientListQuery\(patientSearchDraft, \[patient\.fullName\]\)/);
assert.match(readFileSync("src/components/new-patient-case-popup.tsx", "utf8"), /matchesPatientListQuery\(q, \[person\.name\]\)/);
assert.match(readFileSync("src/components/patient-case-file.tsx", "utf8"), /matchesPatientListQuery\(relatedCaseDraft, \[entry\.fullName\]\)/);
assert.doesNotMatch(folderList, /toLowerCase\(\)\.includes\(q\)/);

console.log("patient-list-search ok");

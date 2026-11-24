import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeNotesByNewest,
  pickSaltSource,
  priorEncountersByVisitDate,
  sectionMatchesSource,
  sectionsSafeToResalt,
} from "../../src/lib/salt-source";

const soap = (s: string) => ({ subjective: s, objective: s, assessment: s, plan: s });
const run = (section: string, macroId: string, answers: Record<string, string>) => ({ section, macroId, answers });
// Mock patient: Initial Exam 04/02 was reopened most recently (latest updatedAt).
const notes = [
  { id: "ie", patientId: "p1", encounterDate: "04/02/2026", updatedAt: "2026-10-26T20:00:00Z", soap: soap("IE: Cervical 9, MVC HX") },
  { id: "rx", patientId: "p1", encounterDate: "05/04/2026", updatedAt: "2026-05-04T18:00:00Z", soap: soap("ReExam: Cervical 8") },
  { id: "blank", patientId: "p1", encounterDate: "05/05/2026", updatedAt: "2026-10-26T21:00:00Z", soap: soap("") },
  { id: "future", patientId: "p1", encounterDate: "05/10/2026", updatedAt: "2026-10-26T22:00:00Z", soap: soap("future") },
  { id: "new", patientId: "p1", encounterDate: "05/07/2026", updatedAt: "2026-10-26T23:00:00Z", soap: soap("") },
  { id: "other", patientId: "p2", encounterDate: "05/06/2026", updatedAt: "2026-10-26T23:30:00Z", soap: soap("other patient") },
];
assert.equal(pickSaltSource(notes, "p1", "05/07/2026", "new")?.id, "rx");
assert.deepEqual(priorEncountersByVisitDate(notes, "p1", "05/07/2026", "new").map((n) => n.id), ["blank", "rx", "ie"]);
assert.equal(pickSaltSource(notes, "p1", "04/02/2026", "ie"), null);
assert.equal(pickSaltSource(notes, "p1", "05/04/2026", "rx")?.id, "ie");
assert.equal(pickSaltSource(notes, "p1", "05/07/2026", "new", ["subjective"])?.id, "rx");

// A closed Re-Exam on 05/07 is the source for 05/11, even though an older visit was edited later.
const reexam = {
  id: "reexam",
  patientId: "gonzalez",
  encounterDate: "05/07/2026",
  updatedAt: "2026-05-07T18:00:00Z",
  soap: {
    subjective: 'Headaches <span data-macro-run-id="h1">7</span> for <span data-macro-run-id="h1">30-60 mins</span>. Cervical 8. Thoracic 7. Lumbar 8. Shoulder L 5 Intermittent. Knee L 8.',
    objective: "re",
    assessment: "re",
    plan: "re",
  },
  macroRuns: [run("subjective", "complaints", { headaches: "7", headache_duration: "30-60 mins", cervical: "8", thoracic: "7", lumbar: "8", shoulder: "5", knee: "8" })],
};
const older = {
  id: "older",
  patientId: "gonzalez",
  encounterDate: "2026-05-04",
  updatedAt: "2026-11-11T18:00:00Z",
  soap: {
    subjective: 'Headaches <span data-macro-run-id="old">9</span> for <span data-macro-run-id="old">60-120 mins</span>. Cervical 9. Thoracic 9. Lumbar 9. Shoulder L 8. Knee L 9.',
    objective: "old",
    assessment: "old",
    plan: "old",
  },
  macroRuns: [run("subjective", "complaints", { headaches: "9", headache_duration: "60-120 mins", cervical: "9", thoracic: "9", lumbar: "9", shoulder: "8", knee: "9" })],
};
const open = {
  id: "open",
  patientId: "gonzalez",
  encounterDate: "05/11/2026",
  updatedAt: "2026-05-11T15:00:00Z",
  soap: {
    subjective: older.soap.subjective.replace('data-macro-run-id="old"', 'data-macro-run-id="copied"'),
    objective: "old",
    assessment: "old",
    plan: "old",
  },
  macroRuns: older.macroRuns.map((entry) => ({ ...entry })),
};
assert.equal(pickSaltSource([reexam, older, open], "gonzalez", "05/11/2026", "open")?.id, "reexam");
assert.deepEqual(sectionsSafeToResalt(open, [reexam, older], ["subjective", "objective", "assessment", "plan"]), [
  "subjective",
  "objective",
  "assessment",
  "plan",
]);
assert.equal(sectionMatchesSource(open, reexam, "subjective"), false);
assert.equal(sectionMatchesSource(open, older, "subjective"), true);

const edited = {
  ...open,
  soap: { ...open.soap, subjective: "Headaches 4. Patient added this by hand." },
  macroRuns: [run("subjective", "complaints", { headaches: "4" })],
};
assert.deepEqual(sectionsSafeToResalt(edited, [reexam, older], ["subjective", "objective"]), ["objective"]);

const staleLocal = { ...reexam, updatedAt: "2026-05-07T12:00:00Z", soap: { ...reexam.soap, subjective: "Headaches 9" } };
assert.equal(mergeNotesByNewest([staleLocal], [reexam])[0].soap.subjective.includes("7"), true);

const workspace = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
assert.doesNotMatch(workspace, /sectionsSafeToResalt/);
assert.doesNotMatch(workspace, /Replace this note with \$\{source\.encounterDate\}\? This replaces what is on the note now\./);
assert.match(workspace, /selectPriorEncounter/);
assert.match(workspace, /aria-label="View prior encounter"/);
assert.match(workspace, /Replace current \$\{sectionLabels\[activeSection\]\} text with the selected prior encounter note\?/);
assert.match(workspace, /Replace ALL current SOAP sections with the notes from/);
assert.doesNotMatch(workspace, /Auto-Salt: an open/);

console.log("salt-source ok");

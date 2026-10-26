import assert from "node:assert/strict";
import { pickSaltSource, priorEncountersByVisitDate } from "../../src/lib/salt-source";

const soap = (s: string) => ({ subjective: s, objective: s, assessment: s, plan: s });
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
console.log("salt-source ok");

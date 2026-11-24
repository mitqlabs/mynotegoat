/**
 * G.O.A.T. asked from a patient page: actions default to that patient (mock data only).
 * Run: npx tsx scripts/tests/goat-page-patient.test.ts
 */
import assert from "node:assert/strict";
import { understand, type UContext } from "../../src/lib/goat-understand";
import { planAddNote } from "../../src/lib/goat-commands";

const patients = [
  { id: "P1", fullName: "Sample, Adam", caseStatus: "Active" },
  { id: "P2", fullName: "Doe, Jane", caseStatus: "Active" },
];
const onPage: UContext = { today: "2026-10-23", patients, pagePatientId: "P1" };

// The reported bug: no name, on Adam's page → a note for Adam, no "Which patient?".
const u = understand("add note signed and send RR", onPage)!;
assert.equal(u.action, "note");
assert.equal(u.patient?.id, "P1");
assert.equal(u.ask, null);
assert.match(u.text, /signed and send RR/);

// Off a patient page it still asks.
assert.ok(understand("add note signed and send RR", { today: "2026-10-23", patients })!.ask);

// Naming someone else wins over the page patient.
assert.equal(understand("add note for jane doe signed", onPage)!.patient?.id, "P2");

// To-dos and pronoun follow-ups stay on the page patient.
const todo = understand("remind me to call his lawyer tomorrow", onPage)!;
assert.equal(todo.action, "todo");
assert.equal(todo.patient?.id, "P1");

// Command layer also default to the open patient.
const step = planAddNote("add note signed and send RR", patients, patients[0]);
assert.equal(step?.kind, "confirm");

console.log("goat-page-patient: all passed");

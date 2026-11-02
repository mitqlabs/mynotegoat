/**
 * Old notes must not vanish from a hook instance when ANOTHER instance saves,
 * real deletes must still remove notes everywhere, nothing duplicates, and a
 * note follows its appointment's type. Pure functions, mock data only.
 *
 * Run:  npx tsx scripts/tests/encounter-old-notes.test.ts
 */
import assert from "node:assert/strict";
import {
  __resetDeletedEncounterIdsForTest,
  markEncounterDeleted,
  mergeNewerById,
  mergePatientCloudNotes,
  unmarkEncounterDeleted,
} from "../../src/lib/encounter-merge";
import { encounterDisplayType, findLinkedAppointment, findNoteForTypeChange } from "../../src/lib/encounter-link";
import { answerFromHandbook, searchHandbook } from "../../src/lib/handbook-search";
import type { EncounterNoteRecord } from "../../src/lib/encounter-notes";

let passed = 0;
const test = (name: string, fn: () => void) => {
  __resetDeletedEncounterIdsForTest();
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const note = (id: string, over: Partial<EncounterNoteRecord> = {}): EncounterNoteRecord => ({
  id,
  patientId: "p-1",
  patientName: "Sample, Pat",
  provider: "Dr. Mock",
  appointmentType: "Office Visit",
  encounterDate: "02/16/2026",
  startTime: "",
  soap: { subjective: "s", objective: "o", assessment: "a", plan: "p" },
  macroRuns: [],
  diagnoses: [],
  charges: [],
  signed: false,
  signedAt: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const ids = (l: EncounterNoteRecord[]) => l.map((n) => n.id).sort();

const old = note("old");
const recent = note("recent", { updatedAt: "2026-10-30T00:00:00.000Z" });

test("an older note (not in the pruned cache) survives another instance saving", () => {
  const local = [old, recent]; // this instance holds both (cloud-loaded)
  const stored = [recent]; // the other instance wrote only the pruned slice
  const out = mergeNewerById(local, stored, Date.parse("2026-11-01T00:00:00Z"));
  assert.deepEqual(ids(out), ["old", "recent"]);
});

test("same old note is kept even when it was last edited long ago (no 15s window)", () => {
  const out = mergeNewerById([old], [], Date.parse("2030-01-01T00:00:00Z"));
  assert.deepEqual(ids(out), ["old"]);
});

test("returns the same array reference when nothing changed", () => {
  const local = [old, recent];
  assert.equal(mergeNewerById(local, [recent]), local);
});

test("a real delete removes the note from other instances", () => {
  markEncounterDeleted("old");
  const out = mergeNewerById([old, recent], [recent]);
  assert.deepEqual(ids(out), ["recent"]);
});

test("a real delete is not undone by a stale stored copy that still lists it", () => {
  markEncounterDeleted("old");
  const out = mergeNewerById([recent], [old, recent]);
  assert.deepEqual(ids(out), ["recent"]);
});

test("a deleted note that was edited seconds ago is still removed", () => {
  const fresh = note("fresh", { updatedAt: new Date().toISOString() });
  markEncounterDeleted("fresh");
  assert.deepEqual(ids(mergeNewerById([fresh, recent], [recent])), ["recent"]);
});

test("a restored (un-deleted) note comes back", () => {
  markEncounterDeleted("old");
  unmarkEncounterDeleted("old");
  assert.deepEqual(ids(mergeNewerById([old], [recent])), ["old", "recent"]);
});

test("newer copy wins per id; incoming-only notes are added", () => {
  const edited = note("old", { updatedAt: "2026-10-31T00:00:00.000Z", soap: { subjective: "NEW", objective: "", assessment: "", plan: "" } });
  const out = mergeNewerById([old], [edited, recent]);
  assert.deepEqual(ids(out), ["old", "recent"]);
  assert.equal(out.find((n) => n.id === "old")?.soap.subjective, "NEW");
  const keepLocal = mergeNewerById([edited], [old]);
  assert.equal(keepLocal[0].soap.subjective, "NEW");
});

test("no duplicates, even with duplicate ids on either side and repeated merges", () => {
  let cur = [old, recent];
  for (let i = 0; i < 5; i++) cur = mergeNewerById(cur, [recent, recent, note("x")]);
  assert.deepEqual(ids(cur), ["old", "recent", "x"]);
  const dupLocal = mergeNewerById([old, old], [recent]);
  assert.equal(dupLocal.filter((n) => n.id === "old").length, 1);
});

test("patient cloud notes: older visit appears, in-memory newer copy wins, no duplicates", () => {
  const mem = [recent, note("m", { updatedAt: "2026-10-31T00:00:00.000Z", soap: { subjective: "LOCAL", objective: "", assessment: "", plan: "" } })];
  const cloud = [old, note("m", { updatedAt: "2026-10-01T00:00:00.000Z" }), note("other", { patientId: "p-2" })];
  const out = mergePatientCloudNotes(mem, cloud, "p-1");
  assert.deepEqual(ids(out), ["m", "old", "recent"]);
  assert.equal(out.find((n) => n.id === "m")?.soap.subjective, "LOCAL");
  // merging again changes nothing / adds nothing
  assert.deepEqual(ids(mergePatientCloudNotes(out, cloud, "p-1")), ["m", "old", "recent"]);
});

test("patient cloud notes: strictly newer cloud copy replaces in-memory one", () => {
  const cloud = [note("recent", { updatedAt: "2026-11-01T00:00:00.000Z", signed: true })];
  const out = mergePatientCloudNotes([recent], cloud, "p-1");
  assert.equal(out.length, 1);
  assert.equal(out[0].signed, true);
});

test("patient cloud notes: a note deleted on this page never comes back from a stale snapshot", () => {
  markEncounterDeleted("old");
  const out = mergePatientCloudNotes([recent], [old], "p-1");
  assert.deepEqual(ids(out), ["recent"]);
  assert.equal(out.length, 1);
});

test("patient cloud notes: empty / fetch failure leaves the in-memory list untouched", () => {
  const mem = [recent];
  assert.equal(mergePatientCloudNotes(mem, [], "p-1"), mem);
});

// ── type follows the appointment ──
const apt = (over: Partial<{ id: string; date: string; appointmentType: string; status: string }> = {}) => ({
  id: "a1",
  patientId: "p-1",
  date: "2026-02-16",
  appointmentType: "New Patient",
  status: "Check Out",
  ...over,
});

test("dropdown shows the linked appointment's type, not the stale note type", () => {
  assert.equal(encounterDisplayType(note("n"), [apt()]), "New Patient"); // sole same-day appt
  assert.equal(encounterDisplayType(note("n", { appointmentId: "a1" }), [apt(), apt({ id: "a2", appointmentType: "Follow-Up" })]), "New Patient");
  assert.equal(encounterDisplayType(note("n"), []), "Office Visit"); // no appointment: keep note type
});

test("display never guesses between several same-day appointments", () => {
  const two = [apt({ id: "a1" }), apt({ id: "a2", appointmentType: "Follow-Up" })];
  assert.equal(encounterDisplayType(note("n", { appointmentType: "Other" }), two), "Other");
  assert.equal(encounterDisplayType(note("n", { appointmentType: "follow-up" }), two), "Follow-Up");
  assert.equal(findLinkedAppointment(note("n", { appointmentType: "Other" }), two), null);
});

test("type change finds the note by saved link, else by date + OLD type; never guesses", () => {
  const a = { id: "a1", patientId: "p-1", date: "2026-02-16" };
  assert.equal(findNoteForTypeChange([note("n")], a, "Office Visit")?.id, "n");
  assert.equal(findNoteForTypeChange([note("n", { appointmentId: "a1", appointmentType: "Zzz" })], a, "Office Visit")?.id, "n");
  assert.equal(findNoteForTypeChange([note("n"), note("m")], a, "Office Visit"), null); // ambiguous
  assert.equal(findNoteForTypeChange([note("n", { encounterDate: "02/17/2026" })], a, "Office Visit"), null);
  assert.equal(findNoteForTypeChange([note("n", { patientId: "p-2" })], a, "Office Visit"), null);
});

test("Handbook teaches the missing-older-visit and type-follow answers", () => {
  const reader = { admin: true, manager: true };
  const q1 = searchHandbook("older visit missing from the encounters list", reader)[0];
  assert.match(q1.task.heading, /older visit is missing/i);
  const q2 = searchHandbook("change a visit type note follow", reader)[0];
  assert.match(q2.task.heading, /visit's type/i);
  assert.equal(answerFromHandbook("my older visit is missing from the encounters list", reader).kind, "answer");
});

console.log(`\n${passed} passed`);

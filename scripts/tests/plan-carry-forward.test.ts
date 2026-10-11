/**
 * "…for the rest of this plan?": which already-open later notes get their
 * Plan rebuilt (future, open, not checked out, untouched), and the prompt text.
 * Pure functions only: no network, no database.
 *
 * Run:  npx tsx scripts/tests/plan-carry-forward.test.ts
 */
import assert from "node:assert/strict";
import { carryForwardNoteText, decideOpenNoteUpdate, planTextFingerprint } from "../../src/lib/plan-carry-forward";

let pass = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name);
    throw e;
  }
}

// What the plan prefilled (two snippets, as appended into the note).
const prefilled =
  '<p>Cervical: <span data-macro-run-id="run_a" data-prompt-id="q1">Adjustment, EMS</span> to the neck.</p>' +
  '<p>Spinal decompression at <span data-macro-run-id="run_b" data-prompt-id="w">40</span> lbs.</p>';
// The same text as saved in the note: other run ids, editor spacing/&nbsp;.
const savedUntouched =
  '<p>Cervical:&nbsp;<span data-macro-run-id="run_x" data-prompt-id="q1">Adjustment, EMS</span> to the neck.</p>\n' +
  '<p>Spinal decompression at <span data-macro-run-id="run_y" data-prompt-id="w">40</span> lbs.</p>';
// Adjustment unticked by hand until the x-ray is reviewed.
const savedEdited =
  '<p>Cervical: <span data-macro-run-id="run_x" data-prompt-id="q1">EMS</span> to the neck.</p>' +
  '<p>Spinal decompression at <span data-macro-run-id="run_y" data-prompt-id="w">40</span> lbs.</p>';

const base = {
  currentIso: "2026-10-13",
  signed: false,
  appointmentStatus: "Check In" as string | null,
  planHtml: savedUntouched,
  prefilledPlanHtml: prefilled,
};

test("fingerprint ignores run ids, tags, &nbsp; and spacing", () => {
  assert.equal(planTextFingerprint(prefilled), planTextFingerprint(savedUntouched));
  assert.notEqual(planTextFingerprint(prefilled), planTextFingerprint(savedEdited));
  assert.equal(planTextFingerprint("<p><br></p>"), "");
});

test("future, open, checked in, untouched: update", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15" }), "update");
});
test("future, open, scheduled (not checked out), untouched: update", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", appointmentStatus: "Scheduled" }), "update");
});
test("future, open, no visit found, untouched: update", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", appointmentStatus: null }), "update");
});
test("edited by hand: never overwritten (listed as edited)", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-17", planHtml: savedEdited }), "edited");
});
test("extra text typed by hand: edited", () => {
  assert.equal(
    decideOpenNoteUpdate({ ...base, dateIso: "2026-10-17", planHtml: savedUntouched + "<p>Hold adjustment until x-ray reviewed.</p>" }),
    "edited",
  );
});
test("same day as the note being edited: never", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-13" }), null);
});
test("earlier date: never", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-08" }), null);
});
test("closed note: never (not even listed)", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", signed: true }), null);
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", signed: true, planHtml: savedEdited }), null);
});
test("checked-out visit with an open note: never", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", appointmentStatus: "Check Out" }), null);
});
test("canceled / no show: never", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", appointmentStatus: "Canceled" }), null);
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", appointmentStatus: "No Show" }), null);
});
test("empty Plan: left to auto-fill on open", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", planHtml: "<p><br></p>" }), null);
});
test("plan prefills nothing for that day but note has text: edited", () => {
  assert.equal(decideOpenNoteUpdate({ ...base, dateIso: "2026-10-15", prefilledPlanHtml: "" }), "edited");
});

const PLAN_LINE = "\n\nThis changes the treatment plan for visits that aren't charted yet. ";
test("prompt: updates plus one edited", () => {
  assert.equal(
    carryForwardNoteText(["10/15/2026", "10/22/2026"], ["10/17/2026"]),
    PLAN_LINE +
      "Also updates 2 open notes (10/15, 10/22). 10/17 was edited by hand and won't change. Closed and checked-out notes are never changed.",
  );
});
test("prompt: one update, singular", () => {
  assert.equal(
    carryForwardNoteText(["10/15/2026"], []),
    PLAN_LINE + "Also updates 1 open note (10/15). Closed and checked-out notes are never changed.",
  );
});
test("prompt: only edited notes", () => {
  assert.equal(
    carryForwardNoteText([], ["10/17/2026", "10/20/2026"]),
    PLAN_LINE +
      "10/17, 10/20 were edited by hand and won't change. Notes already written (including closed and checked-out ones) are not changed.",
  );
});
test("prompt: no open notes (same as before this change)", () => {
  assert.equal(
    carryForwardNoteText([], []),
    PLAN_LINE + "Notes already written (including closed and checked-out ones) are not changed.",
  );
});

console.log(`\n${pass} passed`);

/**
 * Fill Treatment Plan: which visits may be filled (decideFillVisit, unchanged)
 * and the ONE prompt shown before anything is written (fillPromptText).
 * Pure functions only: no network, no database.
 *
 * Run:  npx tsx scripts/tests/fill-plan-rules.test.ts
 */
import assert from "node:assert/strict";
import { decideFillVisit, fillDateSpan, fillPromptText } from "../../src/lib/fill-plan-rules";

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

// ── Which visits get filled (same safety rules as PR #22) ──
type In = Parameters<typeof decideFillVisit>[0];
const decide = (input: Omit<In, "sourceIso" | "todayIso">) => {
  const got = decideFillVisit({ sourceIso: "2026-10-01", todayIso: "2026-10-09", ...input });
  return got && { action: got.action, kind: "kind" in got ? got.kind : undefined };
};
const cases: Array<[string, Omit<In, "sourceIso" | "todayIso">, ReturnType<typeof decide>]> = [
  ["before source date: ignored", { dateIso: "2026-09-30", status: "Check In", note: null }, null],
  ["same day as source: ignored", { dateIso: "2026-10-01", status: "Check In", note: null }, null],
  ["checked out, no note: done", { dateIso: "2026-10-03", status: "Check Out", note: null }, { action: "skip", kind: "done" }],
  ["checked out with open note: done", { dateIso: "2026-10-12", status: "Check Out", note: { signed: false } }, { action: "skip", kind: "done" }],
  ["checked in, closed note: done", { dateIso: "2026-10-12", status: "Check In", note: { signed: true } }, { action: "skip", kind: "done" }],
  ["scheduled with closed note: done", { dateIso: "2026-10-20", status: "Scheduled", note: { signed: true } }, { action: "skip", kind: "done" }],
  ["past checked in, no note: fillPast", { dateIso: "2026-10-03", status: "Check In", note: null }, { action: "fillPast", kind: undefined }],
  ["yesterday checked in, no note: fillPast", { dateIso: "2026-10-08", status: "Check In", note: null }, { action: "fillPast", kind: undefined }],
  ["future checked in, no note: fill", { dateIso: "2026-10-12", status: "Check In", note: null }, { action: "fill", kind: undefined }],
  ["today checked in, no note: fill", { dateIso: "2026-10-09", status: "Check In", note: null }, { action: "fill", kind: undefined }],
  ["past checked in, open note: left alone", { dateIso: "2026-10-03", status: "Check In", note: { signed: false } }, { action: "skip", kind: "past" }],
  ["today checked in, open note: refresh", { dateIso: "2026-10-09", status: "Check In", note: { signed: false } }, { action: "refresh", kind: undefined }],
  ["future scheduled, no note: not filled", { dateIso: "2026-10-20", status: "Scheduled", note: null }, { action: "skip", kind: "notCheckedIn" }],
  ["canceled", { dateIso: "2026-10-20", status: "Canceled", note: null }, { action: "skip", kind: "inactive" }],
  ["no show", { dateIso: "2026-10-05", status: "No Show", note: null }, { action: "skip", kind: "inactive" }],
];
for (const [name, input, want] of cases) test(name, () => assert.deepEqual(decide(input), want));

test("date span", () => {
  assert.equal(fillDateSpan(["10/02/2026", "10/06/2026", "10/30/2026"]), "10/02–10/30");
  assert.equal(fillDateSpan(["10/02/2026"]), "10/02");
  assert.equal(fillDateSpan([]), "");
});

// ── The one prompt ──
test("past only: one prompt, exact dates", () => {
  const p = fillPromptText({
    upcomingDatesUs: [],
    pastDatesUs: ["09/03/2026", "09/09/2026", "09/10/2026", "09/16/2026", "09/23/2026"],
  });
  assert.equal(p.kind, "confirm");
  assert.equal(
    p.text,
    "Fill 5 visits from the treatment plan?\n09/03, 09/09, 09/10, 09/16, 09/23\nChecked-out visits won't change.",
  );
});

test("upcoming plus past: two short lines", () => {
  const p = fillPromptText({
    upcomingDatesUs: ["10/12/2026", "10/14/2026"],
    pastDatesUs: ["09/03/2026", "09/09/2026"],
  });
  assert.equal(p.kind, "confirm");
  assert.equal(p.title, "Fill 4 visits from the treatment plan?");
  assert.deepEqual(p.lines, [
    "Upcoming: 10/12, 10/14",
    "Past, checked in with no note: 09/03, 09/09",
    "Checked-out visits won't change.",
  ]);
});

test("upcoming only, single visit: singular", () => {
  const p = fillPromptText({ upcomingDatesUs: ["10/12/2026"], pastDatesUs: [] });
  assert.equal(p.text, "Fill 1 visit from the treatment plan?\n10/12\nChecked-out visits won't change.");
});

test("nothing qualifies: short notice", () => {
  const p = fillPromptText({ upcomingDatesUs: [], pastDatesUs: [] });
  assert.equal(p.kind, "nothing");
  assert.equal(p.text, "Nothing to fill. All visits are already done or checked out.");
  assert.deepEqual(p.lines, []);
});

test("no zero counts or old jargon anywhere", () => {
  for (const p of [
    fillPromptText({ upcomingDatesUs: ["10/12/2026"], pastDatesUs: [] }),
    fillPromptText({ upcomingDatesUs: [], pastDatesUs: ["09/03/2026"] }),
    fillPromptText({ upcomingDatesUs: ["10/12/2026"], pastDatesUs: ["09/03/2026"] }),
    fillPromptText({ upcomingDatesUs: [], pastDatesUs: [] }),
  ]) {
    assert.doesNotMatch(p.text, /Skipping|\b0\b|OK =|closed \+ checked out|Only Checked In/);
  }
});

console.log(`\n${pass} passed`);

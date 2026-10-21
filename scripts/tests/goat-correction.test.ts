/** Typed corrections ("no I wanted you to book it") → right action, redo, and name-free learned wording. */
import assert from "node:assert/strict";
import { detectCorrection, phraseTemplate, understand, type UContext } from "../../src/lib/goat-understand";
import { emptyLearned, learnedMap, safeTemplate, withMiss, withPhrase } from "../../src/lib/goat-learned";

const ctx: UContext = {
  today: "2026-10-20",
  patients: [{ id: "P1", fullName: "Smith, John" }, { id: "P2", fullName: "Rivera, Ana" }, { id: "P3", fullName: "Kim, Cara" }],
  attorneys: ["Test Legal LLP", "Mock Injury Lawyers"],
  names: ["Mike Daniels", "Dana Fox", "Test Legal LLP"],
};

const C: Array<[string, string | null]> = [
  ["no I wanted you to book it", "book"], ["not a note, a to-do", "todo"], ["I meant reschedule", "reschedule"],
  ["no, move it to friday", "reschedule"], ["nope, make it a to-do", "todo"], ["no i meant a note", "note"],
  ["thats not what i meant, book him", "book"], ["no check her in", "checkIn"], ["no I wanted to check him out", "checkOut"],
  ["not a to-do, a note", "note"], ["no mark him no show", "noShow"], ["wrong, cancel his appt", "cancel"],
  ["i wanted the attorney changed", "attorney"], ["no open his case", "open"], ["actually reschedule to monday 3pm", "reschedule"],
  ["no a reminder", "todo"], ["i said book", "book"], ["nah resched it", "reschedule"], ["no his date of injury", "doi"],
  ["no", null], ["no thanks", null], ["not now", null], ["nope", null], ["notes look good", null], ["book john friday", null], ["now what", null],
];
let ok = 0;
const bad: string[] = [];
for (const [q, a] of C) {
  const got = detectCorrection(q)?.action ?? null;
  if (got === a) ok++;
  else bad.push(`  "${q}" → ${got} (want ${a})`);
}
console.log(`Corrections: ${ok}/${C.length} (${Math.round((ok / C.length) * 1000) / 10}%)`);
if (bad.length) console.log(bad.join("\n"));
assert.ok(ok / C.length >= 0.95, "corrections under 95%");

// Detail carries over: "no, move it to friday" after "john smith thursday 10".
assert.equal(detectCorrection("no, move it to friday")?.detail, "to friday");
const redo = understand("john smith thursday 10 to friday", { ...ctx, force: "reschedule" });
assert.equal(redo?.action, "reschedule");
assert.equal(redo?.patient?.id, "P1");
assert.equal(redo?.date?.iso, "2026-10-23");
// "not a note, a to-do" after "smith call the adjuster tmrw" → to-do.
const td = understand("call the adjuster for smith tmrw", { ...ctx, force: "todo" });
assert.equal(td?.action, "todo");
assert.match(td?.canonical ?? "", /^remind me to /);

// Saved wording has no names: patients (any case, misspelled), contacts and attorneys.
const tpl = phraseTemplate("tell Mike at test legal that jon smth called tmrw at 3", ctx.patients, ctx.today, [...ctx.names!, ...ctx.attorneys!]);
assert.ok(!/mike|test|smith|smth|jon|3/.test(tpl), tpl);
assert.ok(safeTemplate(tpl), tpl);
const tpl2 = phraseTemplate("dana fox said cara kim can't come", ctx.patients, ctx.today, ctx.names);
assert.ok(!/dana|fox|cara|kim/.test(tpl2), tpl2);

// Saved correction is used first next time (same wording, other patient).
const orig = "ana rivera friday 9 the usual";
const t1 = phraseTemplate(orig, ctx.patients, ctx.today);
const L = withPhrase(withMiss(emptyLearned(), t1, "reply"), t1, "book");
const again = understand("john smith monday 2 the usual", { ...ctx, learned: learnedMap(L) });
assert.equal(again?.action, "book");
assert.equal(again?.learned, true);
assert.equal(L.misses.length, 1);

// kara → Cara (sound-alike first letter), without loosening other names.
assert.equal(understand("kara kim re exam 10/30 at 3", ctx)?.patient?.id, "P3");
assert.equal(understand("book cara kim friday 3", ctx)?.patient?.id, "P3");
assert.equal(understand("book kim tomorrow 3", ctx)?.patient?.id, "P3");

console.log("goat-correction ok");

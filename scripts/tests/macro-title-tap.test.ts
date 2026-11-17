/**
 * Title tap on multi-choice SOAP checkbox groups.
 * Mock answers only. Run: npx tsx scripts/tests/macro-title-tap.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  macroOptionChecked,
  macroOtherEditText,
  toggleAllMacroCheckboxes,
  toggleMacroCheckbox,
} from "../../src/lib/macro-multiselect";
import { formatMacroAnswerValue, renderMacroTemplate, type MacroAnswerMap, type MacroAnswerValue } from "../../src/lib/macro-templates";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const MUSCLES = ["suboccipital", "sternocleidomastoid", "levator scapulae", "cervical paraspinal"];
const LUMBAR = ["quadratus lumborum", "lumbar paraspinal", "gluteal", "piriformis"];

/** Check every option that is not already stored, in option order. */
function checkEachMissing(current: MacroAnswerValue | undefined, options: readonly string[]): string[] {
  let next: MacroAnswerValue | undefined = current;
  for (const option of options) {
    const raw = Array.isArray(next) ? next : [];
    if (!raw.includes(option)) next = toggleMacroCheckbox(next, option, options);
  }
  return Array.isArray(next) ? next : [];
}

function uncheckEach(current: string[], options: readonly string[]): string[] {
  let next: MacroAnswerValue = current;
  for (const option of options) {
    if (Array.isArray(next) && next.includes(option)) next = toggleMacroCheckbox(next, option, options);
  }
  return Array.isArray(next) ? next : [];
}

test("title tap selects every cervical muscle in option order", () => {
  const selected = toggleAllMacroCheckboxes(undefined, MUSCLES);
  assert.deepEqual(selected, MUSCLES);
  assert.equal(macroOtherEditText(selected), MUSCLES.join(", "));
  assert.equal(macroOtherEditText(selected), checkEachMissing(undefined, MUSCLES).join(", "));
});

test("click order does not change the Other / edit text", () => {
  let manual: MacroAnswerValue | undefined = [];
  for (const option of [...MUSCLES].reverse()) manual = toggleMacroCheckbox(manual, option, MUSCLES);
  const tapped = toggleAllMacroCheckboxes([], MUSCLES);
  assert.deepEqual(tapped, manual);
  assert.equal(macroOtherEditText(tapped), "suboccipital, sternocleidomastoid, levator scapulae, cervical paraspinal");
});

test("a partial group finishes in the same order as checking the rest", () => {
  const partial = toggleMacroCheckbox(
    toggleMacroCheckbox([], "cervical paraspinal", MUSCLES),
    "suboccipital",
    MUSCLES,
  );
  assert.deepEqual(partial, ["suboccipital", "cervical paraspinal"]);
  const tapped = toggleAllMacroCheckboxes(partial, MUSCLES);
  assert.deepEqual(tapped, checkEachMissing(partial, MUSCLES));
  assert.equal(macroOtherEditText(tapped), MUSCLES.join(", "));
  for (const option of MUSCLES) assert.equal(macroOptionChecked(tapped, option), true);
});

test("tapping again clears every option and the Other / edit box", () => {
  const all = toggleAllMacroCheckboxes([], MUSCLES);
  const cleared = toggleAllMacroCheckboxes(all, MUSCLES);
  assert.deepEqual(cleared, []);
  assert.deepEqual(cleared, uncheckEach(all, MUSCLES));
  assert.equal(macroOtherEditText(cleared), "");
  const again = toggleAllMacroCheckboxes(cleared, MUSCLES);
  assert.deepEqual(again, MUSCLES);
});

test("a typed Other / edit value is replaced by the full list, same as checking boxes", () => {
  const typed = "suboccipital, sternocleidomastoid — worse on the right";
  const tapped = toggleAllMacroCheckboxes(typed, MUSCLES);
  assert.deepEqual(tapped, checkEachMissing(typed, MUSCLES));
  assert.equal(macroOtherEditText(tapped), MUSCLES.join(", "));
});

test("an extra free-text entry stays at the end and survives a clear of the boxes", () => {
  const withNote = [...MUSCLES, "worse at night"];
  assert.deepEqual(toggleAllMacroCheckboxes(withNote, MUSCLES), uncheckEach(withNote, MUSCLES));
  assert.deepEqual(toggleAllMacroCheckboxes(withNote, MUSCLES), ["worse at night"]);
  assert.equal(macroOtherEditText(toggleAllMacroCheckboxes(withNote, MUSCLES)), "worse at night");
  const partialNote = ["levator scapulae", "worse at night"];
  assert.deepEqual(toggleAllMacroCheckboxes(partialNote, MUSCLES), checkEachMissing(partialNote, MUSCLES));
  assert.equal(
    macroOtherEditText(toggleAllMacroCheckboxes(partialNote, MUSCLES)),
    "suboccipital, sternocleidomastoid, levator scapulae, cervical paraspinal, worse at night",
  );
});

test("each group keeps its own answer", () => {
  const tap = (answers: MacroAnswerMap, id: string, options: readonly string[]): MacroAnswerMap => ({
    ...answers,
    [id]: toggleAllMacroCheckboxes(answers[id], options),
  });
  let answers: MacroAnswerMap = {};
  answers = tap(answers, "tenderness", MUSCLES);
  answers = tap(answers, "trigger", MUSCLES);
  answers = tap(answers, "spasms", LUMBAR);
  assert.deepEqual(answers.tenderness, MUSCLES);
  assert.deepEqual(answers.trigger, MUSCLES);
  assert.deepEqual(answers.spasms, LUMBAR);
  answers = tap(answers, "trigger", MUSCLES);
  assert.deepEqual(answers.trigger, []);
  assert.deepEqual(answers.tenderness, MUSCLES);
  assert.deepEqual(answers.spasms, LUMBAR);
});

test("the saved SOAP sentence matches checking each box", () => {
  const body = "Palpation: tenderness of the [[tenderness]]. Trigger points: [[trigger]].";
  const tapped: MacroAnswerMap = {
    tenderness: toggleAllMacroCheckboxes([], MUSCLES),
    trigger: toggleAllMacroCheckboxes(["sternocleidomastoid"], MUSCLES),
  };
  const manual: MacroAnswerMap = {
    tenderness: checkEachMissing([], MUSCLES),
    trigger: checkEachMissing(["sternocleidomastoid"], MUSCLES),
  };
  assert.equal(renderMacroTemplate(body, tapped, {}), renderMacroTemplate(body, manual, {}));
  assert.equal(
    formatMacroAnswerValue(tapped.tenderness),
    "suboccipital, sternocleidomastoid, levator scapulae, and cervical paraspinal",
  );
  assert.match(renderMacroTemplate(body, tapped, {}), /tenderness of the suboccipital, sternocleidomastoid, levator scapulae, and cervical paraspinal/);
});

test("a one-option group toggles on and off", () => {
  assert.deepEqual(toggleAllMacroCheckboxes(undefined, ["spasm"]), ["spasm"]);
  assert.deepEqual(toggleAllMacroCheckboxes("spasm", ["spasm"]), []);
});

test("the encounter picker wires the title and keeps the gesture hidden", () => {
  const card = readFileSync(new URL("../../src/components/macro-prompt-question.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
  assert.match(card, /canToggleAll = Boolean\(question\.multiSelect\) && !singlePick && selectableOptions\.length > 0/);
  assert.match(card, /cursor-pointer/);
  assert.match(card, /toggleAllMacroCheckboxes\(current\[question\.id\], question\.options\)/);
  assert.match(card, /toggleMacroCheckbox\(current\[question\.id\], option, question\.options\)/);
  assert.match(card, /type="checkbox"/);
  assert.match(card, /Other \/ edit:/);
  assert.match(card, /macroOtherEditText\(answerValue\)/);
  assert.doesNotMatch(card, /Select all|select all|Tap the title|secret tap/i);
  assert.match(workspace, /<MacroPromptQuestion/);
  assert.match(workspace, /setAnswers=\{setRunMacroAnswers\}/);
  assert.match(workspace, /applyMacroTemplate\(runMacro, runMacroAnswers, editingMacroRun\)/);
});

console.log(`${passed} passed`);

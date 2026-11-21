/**
 * SOAP macro "show only if" rules. Fictional questions only.
 * Run: npx tsx scripts/tests/macro-show-if.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  answersOmittingHidden,
  isMacroQuestionVisible,
  questionsHaveShowIf,
  sanitizeMacroShowIf,
  templateOmittingHidden,
  visibleMacroQuestions,
} from "../../src/lib/macro-show-if";
import {
  insertMissingVisibleMacroSpans,
  macroInsertParts,
  normalizeMacroLibrary,
  removeHiddenPromptSpan,
  renderMacroTemplate,
  renderMacroTemplateWithPromptSpans,
  type MacroQuestion,
} from "../../src/lib/macro-templates";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const q = (partial: MacroQuestion): MacroQuestion => partial;

const er = q({
  id: "er",
  label: "Did you go to the emergency room / urgent care?",
  options: ["Yes", "No"],
});
const ambulance = q({
  id: "ambulance",
  label: "Were you taken by ambulance?",
  options: ["DELETE", "were taken by the ambulance from the scene of the accident."],
  showIf: { questionId: "er", answers: ["Yes"] },
});
const meds = q({
  id: "meds",
  label: "Were medications prescribed?",
  options: ["DELETE", "prescribed during the hospital visit."],
  showIf: { questionId: "er", answers: ["Yes"] },
});
const imaging = q({
  id: "imaging",
  label: "Was diagnostic imaging taken?",
  options: ["has not yet been taken.", "was taken at the time of their visit."],
  showIf: { questionId: "meds", answers: ["prescribed during the hospital visit."] },
});
const questions = [er, ambulance, meds, imaging];

const body =
  "<p>Seen at emergency/urgent care: [[er]]</p><p>[[ambulance]]</p><p>[[meds]]</p><p>[[imaging]]</p>";

test("a macro with no rules is unchanged", () => {
  const plain = [q({ id: "a", label: "Where were you seated?", options: ["driver"] })];
  const answers = { a: "driver" };
  const template = "Seated as [[a]].";
  assert.equal(questionsHaveShowIf(plain), false);
  const parts = macroInsertParts(template, plain, answers);
  assert.equal(parts.template, template);
  assert.equal(parts.answers, answers);
  assert.equal(
    renderMacroTemplateWithPromptSpans(parts.template, parts.answers, { FIRST_NAME: "Ada" }, "run"),
    renderMacroTemplateWithPromptSpans(template, answers, { FIRST_NAME: "Ada" }, "run"),
  );
  assert.equal(renderMacroTemplate(parts.template, parts.answers, {}), renderMacroTemplate(template, answers, {}));
});

test("No hides ambulance, meds, and a child of meds; their text is not inserted", () => {
  const answers = {
    er: "No",
    ambulance: "DELETE",
    meds: "prescribed during the hospital visit.",
    imaging: "was taken at the time of their visit.",
  };
  assert.deepEqual(
    visibleMacroQuestions(questions, answers).map((question) => question.id),
    ["er"],
  );
  assert.equal(isMacroQuestionVisible(imaging, questions, answers), false);
  const parts = macroInsertParts(body, questions, answers);
  const text = renderMacroTemplate(parts.template, parts.answers, {});
  assert.match(text, /No/);
  assert.doesNotMatch(text, /DELETE/);
  assert.doesNotMatch(text, /ambulance/i);
  assert.doesNotMatch(text, /prescribed/);
  assert.doesNotMatch(text, /imaging|taken at the time/i);
  const html = renderMacroTemplateWithPromptSpans(parts.template, parts.answers, {}, "run-1");
  assert.doesNotMatch(html, /data-prompt-id="ambulance"|data-prompt-id="meds"|data-prompt-id="imaging"/);
  assert.match(html, /data-prompt-id="er"/);
});

test("Yes shows ambulance and meds, and imaging only when meds matches", () => {
  const answers = {
    er: "Yes",
    ambulance: "were taken by the ambulance from the scene of the accident.",
    meds: "DELETE",
    imaging: "was taken at the time of their visit.",
  };
  assert.deepEqual(
    visibleMacroQuestions(questions, answers).map((question) => question.id),
    ["er", "ambulance", "meds"],
  );
  const shown = { ...answers, meds: "prescribed during the hospital visit." };
  assert.equal(isMacroQuestionVisible(imaging, questions, shown), true);
  const parts = macroInsertParts(body, questions, shown);
  const text = renderMacroTemplate(parts.template, parts.answers, {});
  assert.match(text, /Yes/);
  assert.match(text, /were taken by the ambulance from the scene of the accident/);
  assert.match(text, /prescribed during the hospital visit/);
  assert.match(text, /was taken at the time of their visit/);
});

test("several allowed answers, multi-select, and a typed edit that is not the option", () => {
  const parent = q({ id: "p", label: "Parent", options: ["Yes", "No"], multiSelect: true });
  const child = q({
    id: "c",
    label: "Child",
    options: ["kept"],
    showIf: { questionId: "p", answers: ["Yes", "No"] },
  });
  assert.equal(isMacroQuestionVisible(child, [parent, child], { p: ["No"] }), true);
  assert.equal(isMacroQuestionVisible(child, [parent, child], { p: "Yes - Glendale" }), false);
  assert.equal(isMacroQuestionVisible(child, [parent, child], { p: "" }), false);
});

test("a forward or circular rule is dropped; an earlier parent is kept", () => {
  const cleaned = sanitizeMacroShowIf([
    q({ id: "a", label: "A", options: ["Yes"], showIf: { questionId: "b", answers: ["Yes"] } }),
    q({ id: "b", label: "B", options: ["Yes", "No"], showIf: { questionId: "a", answers: ["Yes", "Maybe"] } }),
  ]);
  assert.equal(cleaned[0].showIf, undefined);
  assert.deepEqual(cleaned[1].showIf, { questionId: "a", answers: ["Yes"] });
});

test("normalize keeps a valid rule and drops a broken one", () => {
  const library = normalizeMacroLibrary({
    setName: "Test",
    templates: [
      {
        id: "macro-1",
        section: "objective",
        buttonName: "ER Visit",
        body,
        active: true,
        questions: [
          { id: "too_soon", label: "Too soon", options: ["x"], showIf: { questionId: "er", answers: ["Yes"] } },
          { id: "er", label: "Did you go?", options: ["Yes", "No"] },
          { id: "ambulance", label: "Ambulance?", options: ["DELETE", "taken"], showIf: { questionId: "er", answers: ["Yes"] } },
        ],
      },
    ],
  });
  const saved = library.templates[0].questions;
  assert.equal(saved[0].showIf, undefined);
  assert.equal(saved[1].showIf, undefined);
  assert.deepEqual(saved[2].showIf, { questionId: "er", answers: ["Yes"] });
  const again = normalizeMacroLibrary(JSON.parse(JSON.stringify(library)));
  assert.deepEqual(again.templates[0].questions[2].showIf, { questionId: "er", answers: ["Yes"] });
});

test("old question JSON without a rule normalizes to the same question", () => {
  const library = normalizeMacroLibrary({
    setName: "Test",
    templates: [
      {
        id: "macro-1",
        section: "subjective",
        buttonName: "Pain",
        body: "Pain [[pain]].",
        questions: [{ id: "pain", label: "Pain scale", options: ["0", "1"], multiSelect: false }],
      },
    ],
  });
  assert.deepEqual(library.templates[0].questions[0], {
    id: "pain",
    label: "Pain scale",
    options: ["0", "1"],
    multiSelect: false,
  });
});

test("hidden answer pills are removed and a newly shown one is placed beside its sibling", () => {
  const html =
    '<p>Seen: <span class="macro-prompt" contenteditable="false" data-macro-run-id="run-1" data-prompt-id="er">No</span></p>' +
    '<p><span class="macro-prompt" contenteditable="false" data-macro-run-id="run-1" data-prompt-id="ambulance">DELETE</span></p>';
  const removed = removeHiddenPromptSpan(html, "run-1", "ambulance");
  assert.doesNotMatch(removed, /ambulance|DELETE/);
  assert.match(removed, /data-prompt-id="er"/);
  const placed = insertMissingVisibleMacroSpans(removed, "run-1", questions, {
    er: "Yes",
    ambulance: "were taken by the ambulance from the scene of the accident.",
  });
  assert.match(placed, /data-prompt-id="ambulance"/);
  assert.match(placed, /were taken by the ambulance/);
});

test("omitting a hidden token leaves the original template when every question shows", () => {
  const answers = { er: "Yes", ambulance: "DELETE", meds: "DELETE", imaging: "has not yet been taken." };
  const plain = [er, { ...ambulance, showIf: undefined }];
  assert.equal(templateOmittingHidden(body, plain, answers), body);
  const stored = { er: "No" };
  assert.equal(answersOmittingHidden([er], stored), stored);
});

test("the editor, the fill-out popup, and the cloud save all use the rule", () => {
  const panel = readFileSync(new URL("../../src/components/macro-settings-panel.tsx", import.meta.url), "utf8");
  const encounter = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
  const save = readFileSync(new URL("../../src/lib/macro-templates.ts", import.meta.url), "utf8");
  assert.match(panel, /Show only if/);
  assert.match(panel, /isMacroQuestionVisible/);
  assert.match(panel, /macroInsertParts/);
  assert.doesNotMatch(panel, /This question appears|only when the answer/);
  assert.match(encounter, /isMacroQuestionVisible\(question, runMacro\.questions, runMacroAnswers\)/);
  assert.match(encounter, /macroInsertParts\(macro\.body, macro\.questions, answers\)/);
  assert.match(encounter, /Insert Into SOAP/);
  assert.match(save, /dualWriteKv\(STORAGE_KEY, "macros", config\)/);
});

console.log(`macro-show-if ok (${passed})`);

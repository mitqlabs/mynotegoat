/**
 * Narrative Inputs: decompression gate, blank sentences, amount typos.
 * Mock template text only. Run: npx tsx scripts/tests/narrative-inputs.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_TOKEN_MARK } from "../../src/lib/report-html-cleanup";
import {
  applyNarrativeAnswers,
  correctNarrativeAmountTypos,
  mergeNarrativeInputDefaults,
  narrativeAnswerSkipsToReport,
  omitInactivePromptSentences,
  RECOMMEND_DECOMPRESSION_TOKEN,
  visibleNarrativePrompts,
} from "../../src/lib/narrative-inputs";
import { normalizeLibrary } from "../../src/lib/report-templates";
import type { NarrativeReportLibrary, NarrativeReportPrompt } from "../../src/lib/report-templates";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const SAVED = [
  "$2,000.00 to $2,5000.00",
  "$3,000.00 to $3,5000.00",
  "$4,250.00 to $5,5000.00",
  "$4,000.00 to $5,0000.00 ($2,000.00 to $2,500.00 per region)",
  "$6,000.00 to $7,0000.00 ($3,000.00 to $3,500.00 per region)",
  "$8,500.00 to $11,0000.00 ($4,250.00 to $5,500.00 per region)",
];
const FIXED = [
  "$2,000.00 to $2,500.00",
  "$3,000.00 to $3,500.00",
  "$4,250.00 to $5,500.00",
  "$4,000.00 to $5,000.00 ($2,000.00 to $2,500.00 per region)",
  "$6,000.00 to $7,000.00 ($3,000.00 to $3,500.00 per region)",
  "$8,500.00 to $11,000.00 ($4,250.00 to $5,500.00 per region)",
];

test("corrects each saved future-care typo and leaves a correct amount alone", () => {
  assert.deepEqual(SAVED.map(correctNarrativeAmountTypos), FIXED);
  assert.equal(correctNarrativeAmountTypos(FIXED[0]), FIXED[0]);
});

const pi = (over: Partial<NarrativeReportPrompt> = {}): NarrativeReportPrompt[] => [
  { id: "t", label: "How many treatments?", token: "PROMPT_HOW_MANY_TREATMENTS", options: ["six to eight", "ten to twelve"], required: false },
  { id: "r", label: "Which region of the spine?", token: "PROMPT_WHICH_REGION_OF_THE_SPINE", options: ["cervical", "lumbar"], required: false },
  { id: "f", label: "Future Care Amount", token: "PROMPT_FUTURE_CARE_AMOUNT", options: SAVED, required: false, ...over },
];

const library = (name: string, prompts: NarrativeReportPrompt[]): NarrativeReportLibrary => ({
  templates: [{ id: "pi", name, body: "Body", fontFamily: "Georgia", active: true, prompts }],
});

test("adds Recommend Decompression? before Future Care and shows that question only for Yes", () => {
  const merged = mergeNarrativeInputDefaults(library("Personal Injury Discharge", pi()));
  const prompts = merged.templates[0].prompts;
  assert.deepEqual(prompts.map((prompt) => prompt.label), [
    "How many treatments?",
    "Which region of the spine?",
    "Recommend Decompression?",
    "Future Care Amount",
  ]);
  const gate = prompts[2];
  assert.equal(gate.input, "yesno");
  assert.deepEqual(gate.options, ["Yes", "No"]);
  assert.deepEqual(prompts[3].showWhen, { promptId: gate.id, answers: ["Yes"] });
  assert.equal(prompts[3].options[0], SAVED[0], "saved option text is not rewritten");
  const no = visibleNarrativePrompts(prompts, { [RECOMMEND_DECOMPRESSION_TOKEN]: "No" }).map((prompt) => prompt.token);
  assert.ok(!no.includes("PROMPT_FUTURE_CARE_AMOUNT"));
  const yes = visibleNarrativePrompts(prompts, { [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes" }).map((prompt) => prompt.token);
  assert.ok(yes.includes("PROMPT_FUTURE_CARE_AMOUNT"));
  assert.equal(narrativeAnswerSkipsToReport(prompts, { [RECOMMEND_DECOMPRESSION_TOKEN]: "No" }, gate.id), true);
  assert.equal(narrativeAnswerSkipsToReport(prompts, { [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes" }, gate.id), false);
});

test("a renamed Yes/No still controls whichever follow-up the office attached", () => {
  const prompts: NarrativeReportPrompt[] = [
    { id: "g", label: "Include future care?", token: "PROMPT_INCLUDE_FUTURE_CARE", options: ["Recommend", "Skip"], required: false, input: "yesno" },
    { id: "f", label: "Amount", token: "PROMPT_FUTURE_CARE_AMOUNT", options: ["$2,500.00"], required: false, showWhen: { promptId: "g", answers: ["Recommend"] } },
  ];
  assert.equal(visibleNarrativePrompts(prompts, { PROMPT_INCLUDE_FUTURE_CARE: "Skip" }).length, 1);
  assert.equal(narrativeAnswerSkipsToReport(prompts, { PROMPT_INCLUDE_FUTURE_CARE: "Skip" }, "g"), true);
  assert.equal(visibleNarrativePrompts(prompts, { PROMPT_INCLUDE_FUTURE_CARE: "Recommend" }).length, 2);
});

test("does not add the gate to other reports, twice, or after the office removes it", () => {
  const other = mergeNarrativeInputDefaults(library("Spinal Decompression Discharge", [
    { id: "m", label: "How many more treatments?", token: "PROMPT_HOW_MANY_MORE_TREATMENTS", options: ["six to eight"], required: false },
    { id: "f", label: "Future Care Amount", token: "PROMPT_FUTURE_CARE_AMOUNT", options: FIXED, required: false },
  ]));
  assert.equal(other.templates[0].prompts.length, 2);
  const once = mergeNarrativeInputDefaults(library("Personal Injury Discharge", pi()));
  const twice = mergeNarrativeInputDefaults(once);
  assert.equal(twice.templates[0].prompts.filter((prompt) => prompt.token === RECOMMEND_DECOMPRESSION_TOKEN).length, 1);
  const removed = mergeNarrativeInputDefaults({
    templates: [{ ...once.templates[0], prompts: once.templates[0].prompts.filter((prompt) => prompt.token !== RECOMMEND_DECOMPRESSION_TOKEN), skippedDefaultTokens: [RECOMMEND_DECOMPRESSION_TOKEN] }],
  });
  assert.ok(!removed.templates[0].prompts.some((prompt) => prompt.token === RECOMMEND_DECOMPRESSION_TOKEN));
});

test("normalize keeps a saved show-when and yes/no type", () => {
  const raw = {
    templates: [{
      id: "pi",
      name: "Personal Injury Discharge",
      body: "Body",
      prompts: [{ id: "g", label: "Recommend Decompression?", token: RECOMMEND_DECOMPRESSION_TOKEN, options: ["Yes", "No"], required: false, input: "yesno", showWhen: { promptId: "g", answers: ["Yes"] } }],
    }],
  };
  const normalized = normalizeLibrary(raw).templates[0].prompts[0];
  assert.equal(normalized.input, "yesno");
  assert.equal(normalized.showWhen, undefined, "a question cannot show itself");
});

const paragraph = `<div><b><u>Future Non-Surgical Spinal Decompression</u></b></div><div>{{MR_MRS_MS_LAST_NAME}} would benefit from future non-surgical spinal decompression treatments. A consideration should be made for {{PROMPT_HOW_MANY_TREATMENTS}} treatments of the {{PROMPT_WHICH_REGION_OF_THE_SPINE}} region. This treatment plan of non-surgical spinal decompression therapy will require an additional {{PROMPT_FUTURE_CARE_AMOUNT}}. This amount is inclusive of two examinations.</div>`;

const prompts = mergeNarrativeInputDefaults(library("Personal Injury Discharge", pi())).templates[0].prompts;

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(EMPTY_TOKEN_MARK, "").replace(/\s+/g, " ").trim();
}

test("No drops the decompression paragraph, including the future-care sentences", () => {
  const html = omitInactivePromptSentences(paragraph, prompts, {
    PROMPT_HOW_MANY_TREATMENTS: "six to eight",
    PROMPT_WHICH_REGION_OF_THE_SPINE: "cervical",
    [RECOMMEND_DECOMPRESSION_TOKEN]: "No",
    PROMPT_FUTURE_CARE_AMOUNT: "$2,000.00 to $2,500.00",
  });
  assert.ok(html.includes(EMPTY_TOKEN_MARK));
  assert.ok(!html.includes("{{PROMPT_"));
  assert.ok(!html.includes("would benefit"));
  assert.ok(!html.includes("inclusive of two examinations"));
  assert.match(html, /Future Non-Surgical Spinal Decompression/, "the heading stays for the empty-section cleanup");
});

test("a blank amount drops that sentence and the one that follows it", () => {
  const html = omitInactivePromptSentences(paragraph, prompts, {
    PROMPT_HOW_MANY_TREATMENTS: "ten to twelve",
    PROMPT_WHICH_REGION_OF_THE_SPINE: "lumbar",
    [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes",
    PROMPT_FUTURE_CARE_AMOUNT: "",
  });
  const text = textOf(html);
  assert.match(text, /would benefit from future non-surgical spinal decompression treatments\./);
  assert.match(html, /\{\{PROMPT_HOW_MANY_TREATMENTS\}\}/);
  assert.match(html, /\{\{PROMPT_WHICH_REGION_OF_THE_SPINE\}\}/);
  assert.doesNotMatch(html, /\{\{PROMPT_FUTURE_CARE_AMOUNT\}\}/);
  assert.doesNotMatch(text, /additional/);
  assert.doesNotMatch(text, /inclusive of two examinations/);
  assert.doesNotMatch(text, /\s[.,]/);
});

test("a blank treatment question drops its sentence and leaves the others", () => {
  const html = omitInactivePromptSentences(paragraph, prompts, {
    PROMPT_HOW_MANY_TREATMENTS: "   ",
    PROMPT_WHICH_REGION_OF_THE_SPINE: "cervical",
    [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes",
    PROMPT_FUTURE_CARE_AMOUNT: "$3,000.00 to $3,500.00",
  });
  const text = textOf(html);
  assert.match(text, /would benefit from future non-surgical spinal decompression treatments\./);
  assert.doesNotMatch(text, /consideration should be made/);
  assert.doesNotMatch(html, /\{\{PROMPT_HOW_MANY_TREATMENTS\}\}/);
  assert.match(html, /\{\{PROMPT_FUTURE_CARE_AMOUNT\}\}/);
  assert.match(text, /inclusive of two examinations/);
});

test("filled answers stay, and a chosen typo amount is corrected in the report value", () => {
  const html = omitInactivePromptSentences(paragraph, prompts, {
    PROMPT_HOW_MANY_TREATMENTS: "fifteen to twenty",
    PROMPT_WHICH_REGION_OF_THE_SPINE: "cervical and lumbar",
    [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes",
    PROMPT_FUTURE_CARE_AMOUNT: SAVED[0],
  });
  assert.match(html, /\{\{PROMPT_HOW_MANY_TREATMENTS\}\}/);
  assert.match(html, /\{\{PROMPT_FUTURE_CARE_AMOUNT\}\}/);
  assert.match(textOf(html), /inclusive of two examinations/);
  const answers = applyNarrativeAnswers(prompts, { PROMPT_FUTURE_CARE_AMOUNT: SAVED[0], [RECOMMEND_DECOMPRESSION_TOKEN]: "Yes" });
  assert.equal(answers.PROMPT_FUTURE_CARE_AMOUNT, FIXED[0]);
  assert.equal(applyNarrativeAnswers(prompts, { [RECOMMEND_DECOMPRESSION_TOKEN]: "No", PROMPT_FUTURE_CARE_AMOUNT: SAVED[0] }).PROMPT_FUTURE_CARE_AMOUNT, "");
});

test("cancel reports a failed save instead of ignoring it", () => {
  const composer = readFileSync("src/components/message-patients-composer.tsx", "utf8");
  assert.match(composer, /\/api\/reminders\/cancel-broadcast/);
  assert.match(composer, /Couldn't cancel that message/);
  assert.match(composer, /Message canceled\. Waiting texts will not be sent\./);
  const route = readFileSync("src/app/api/reminders/cancel-broadcast/route.ts", "utf8");
  assert.match(route, /canceled_at/);
  assert.match(route, /status: "canceled"/);
  assert.match(route, /workspace_members/);
  const migration = readFileSync("supabase/migrations/20261125220000_demo_outbound_guard_definer.sql", "utf8");
  assert.match(migration, /function public\.demo_outbound_blocked\(\)[\s\S]*security definer/);
});

console.log(`narrative-inputs: ${passed} passed`);

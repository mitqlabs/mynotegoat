/**
 * Forms "Connect answer to": custom + macro questions mapped to a macro field,
 * an option, Subjective, or patient-file fields. Fictional data only.
 * Run:  npx tsx scripts/tests/patient-forms-connect.test.ts
 */
import assert from "node:assert/strict";
import type { MacroTemplate } from "../../src/lib/macro-templates";
import {
  answersToMacroFills,
  answersToPatientInfo,
  customAnswersHtml,
  formDateToIso,
  normalizeFormTemplate,
  patientInfoPatch,
  resolveForm,
  validateSnapshot,
  type FormTemplate,
} from "../../src/lib/patient-forms";
import { unionMerge } from "../../src/lib/kv-merge";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const mk = (id: string, section: "objective" | "subjective", buttonName: string, questions: MacroTemplate["questions"]): MacroTemplate => ({ id, section, buttonName, body: "", questions, active: true });
const MACROS: MacroTemplate[] = [
  mk("mx-vitals", "objective", "Vitals", [
    { id: "height", label: "Height", options: [] },
    { id: "weight", label: "Weight", options: [] },
  ]),
  mk("mx-mvc", "objective", "MVC HX", [
    { id: "airbag", label: "Airbags?", options: ["did not deploy", "deployed"] },
    { id: "impact", label: "Impact", options: ["rear end", "front end"], multiSelect: true },
  ]),
  mk("mx-cc", "subjective", "Chief Complaints", [{ id: "cc", label: "Complaints", options: ["neck", "low back"], multiSelect: true }]),
];

const FORM: FormTemplate = normalizeFormTemplate({
  id: "f1",
  name: "Test form",
  intro: "",
  createdAt: "2026-10-19T00:00:00.000Z",
  sections: [
    {
      id: "own",
      kind: "custom",
      macroName: "",
      title: "About you",
      enabled: true,
      includeWhen: "always",
      customQuestions: [
        { id: "q-h", label: "How tall are you?", type: "short", enabled: true, connect: { to: "macro", section: "objective", macroName: "vitals", questionId: "height" } },
        { id: "q-bag", label: "Did the airbags go off?", type: "yesno", enabled: true, connect: { to: "macro", section: "objective", macroName: "MVC HX", questionId: "airbag", option: "deployed" } },
        { id: "q-imp", label: "Where were you hit?", type: "multi", options: ["Rear End", "Side"], enabled: true, connect: { to: "macro", section: "objective", macroName: "MVC HX", questionId: "impact" } },
        { id: "q-cc", label: "What hurts?", type: "short", enabled: true, connect: { to: "macro", section: "subjective", macroName: "Chief Complaints", questionId: "cc" } },
        { id: "q-ph", label: "Best phone?", type: "short", enabled: true, connect: { to: "patient", field: "phone" } },
        { id: "q-dob", label: "Birthday?", type: "short", enabled: true, connect: { to: "patient", field: "dob" } },
        { id: "q-plain", label: "Anything else?", type: "long", enabled: true },
        { id: "q-gone", label: "Ghost", type: "short", enabled: true, connect: { to: "macro", section: "objective", macroName: "Nope", questionId: "x" } },
      ],
    },
    { id: "vit", kind: "macro", macroName: "Vitals", title: "Vitals", enabled: true, includeWhen: "always", questions: { weight: { connect: { to: "none" } } } },
  ],
})!;

test("connections survive normalize; bad ones dropped", () => {
  const qs = FORM.sections[0].customQuestions!;
  assert.deepEqual(qs[0].connect, { to: "macro", section: "objective", macroName: "vitals", questionId: "height" });
  assert.equal(qs[1].connect?.to === "macro" && qs[1].connect.option, "deployed");
  assert.equal(qs[6].connect, undefined);
  const bad = normalizeFormTemplate({ id: "x", name: "x", sections: [{ id: "s", kind: "custom", customQuestions: [{ id: "a", label: "a", type: "short", connect: { to: "patient", field: "ssn" } }] }] })!;
  assert.equal(bad.sections[0].customQuestions![0].connect, undefined);
  assert.deepEqual(FORM.sections[1].questions?.weight.connect, { to: "none" });
});

const { snapshot, missing } = resolveForm(FORM, MACROS, { decompression: false });
const answers = {
  "own.q-h": { other: "5'9\"" },
  "own.q-bag": { picks: ["Yes"] },
  "own.q-imp": { picks: ["Rear End", "Side"] },
  "own.q-cc": { other: "neck" },
  "own.q-ph": { other: "(555) 010-0101" },
  "own.q-dob": { other: "01/26/1990" },
  "own.q-plain": { other: "Mock note" },
  "own.q-gone": { other: "ghost answer" },
  "vit.height": { other: "6'0\"" },
  "vit.weight": { other: "180" },
};

test("missing macro target is reported; question becomes a plain line", () => {
  assert.equal(missing.length, 1);
  assert.match(missing[0], /Nope/);
  const html = customAnswersHtml(snapshot, answers);
  assert.match(html, /Ghost: ghost answer/);
});

test("snapshot connections survive server validation", () => {
  const v = validateSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
  assert.deepEqual(v.sections[0].questions[0].connect, snapshot.sections[0].questions[0].connect);
  assert.deepEqual(v, snapshot);
});

test("fills: custom → Vitals height, yes → exact option, multi mapped to option text, subjective macro", () => {
  const fills = answersToMacroFills(snapshot, answers);
  const vit = fills.find((f) => f.macroId === "mx-vitals")!;
  // The Vitals section's own height question and the connected custom one both target height (later wins).
  assert.equal(vit.answers.height, "6'0\"");
  assert.equal(vit.answers.weight, undefined, "weight set to None → text line, not the macro");
  const mvc = fills.find((f) => f.macroId === "mx-mvc")!;
  assert.equal(mvc.answers.airbag, "deployed");
  assert.deepEqual(mvc.answers.impact, ["rear end", "Side"]);
  const cc = fills.find((f) => f.macroId === "mx-cc")!;
  assert.equal(cc.section, "subjective");
  assert.deepEqual(cc.answers.cc, ["neck"]);
  assert.ok(!fills.some((f) => JSON.stringify(f).includes("555")), "patient fields never go to a macro");
});

test("a No to an option connection fills nothing", () => {
  const fills = answersToMacroFills(snapshot, { "own.q-bag": { picks: ["No"] } });
  assert.equal(fills.length, 0);
});

test("plain lines: unconnected + None only (connected answers not repeated)", () => {
  const html = customAnswersHtml(snapshot, answers);
  assert.match(html, /Anything else\?: Mock note/);
  assert.match(html, /Weight: 180/);
  assert.doesNotMatch(html, /How tall|Best phone|airbags/);
});

test("patient info: fills blanks only, never overwrites, normalizes DOB/sex", () => {
  const info = answersToPatientInfo(snapshot, answers);
  assert.deepEqual(info, { phone: "(555) 010-0101", dob: "01/26/1990" });
  const r = patientInfoPatch({ phone: "-", dob: "" }, info);
  assert.deepEqual(r.patch, { phone: "(555) 010-0101", dob: "1990-01-26" });
  const kept = patientInfoPatch({ phone: "(555) 999-0000", dob: "1990-01-26" }, info);
  assert.deepEqual(kept.patch, {});
  assert.deepEqual(kept.skipped, ["phone"]);
  assert.deepEqual(patientInfoPatch({}, { sex: "F", maritalStatus: "married", dob: "soon" }).patch, { sex: "Female", maritalStatus: "Married" });
  assert.equal(formDateToIso("13/40/1990"), "");
});

test("merge-safe: connection edits on two computers union by form id", () => {
  const a = { ...FORM, updatedAt: "2026-10-19T01:00:00.000Z" };
  const b = { ...FORM, id: "f2", updatedAt: "2026-10-19T02:00:00.000Z" };
  const merged = unionMerge([a], [b]) as FormTemplate[];
  assert.equal(merged.length, 2);
});

console.log(`\n${passed} passed`);
